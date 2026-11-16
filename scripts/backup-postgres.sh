#!/bin/sh
# Backup do PostgreSQL do GastroTag. Roda DENTRO de um container com as ferramentas do
# PostgreSQL (serviço "backup" do docker-compose.yml, imagem postgres).
#
#   backup-postgres.sh loop   -> faz um dump ao iniciar e depois um por dia em BACKUP_HORARIO
#   backup-postgres.sh agora  -> faz um único dump e sai
#
# Conexão pelas variáveis padrão do libpq: PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE.
# A senha nunca vai na linha de comando (o pg_dump lê PGPASSWORD do ambiente).
# Outras variáveis: BACKUP_DIR (/backups), BACKUP_RETENCAO (14), BACKUP_HORARIO (03:00).
set -eu

MODO="${1:-agora}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_RETENCAO="${BACKUP_RETENCAO:-14}"
BACKUP_HORARIO="${BACKUP_HORARIO:-03:00}"
: "${PGDATABASE:?Defina PGDATABASE}"
: "${PGUSER:?Defina PGUSER}"
PREFIXO="${PGDATABASE}"
LOCK="/tmp/gastrotag-backup.lock"

log() { echo "[backup $(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# O volume nasce com dono root: ajusta e continua como o usuário "postgres" (sem root).
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$BACKUP_DIR"
  chown postgres:postgres "$BACKUP_DIR"
  chmod 700 "$BACKUP_DIR"
  exec su-exec postgres sh "$0" "$@"
fi

case "$BACKUP_RETENCAO" in
  ''|*[!0-9]*|0) log "BACKUP_RETENCAO inválido: '$BACKUP_RETENCAO' (use um inteiro >= 1)."; exit 1 ;;
esac
case "$BACKUP_HORARIO" in
  [0-2][0-9]:[0-5][0-9]) ;;
  *) log "BACKUP_HORARIO inválido: '$BACKUP_HORARIO' (use HH:MM)."; exit 1 ;;
esac

umask 077

erro() { echo "[backup $(date '+%Y-%m-%d %H:%M:%S')] ERRO: $*" >&2; }

# Trava: diretório com o PID do dono. Uma trava cujo processo não existe mais
# (container morto com SIGKILL, queda de energia) é considerada velha e removida.
TEM_LOCK=0
liberar_lock() { if [ "$TEM_LOCK" = "1" ]; then rm -rf "$LOCK"; TEM_LOCK=0; fi; }
pegar_lock() {
  if mkdir "$LOCK" 2>/dev/null; then
    echo "$$" > "$LOCK/pid"; TEM_LOCK=1; return 0
  fi
  dono=$(cat "$LOCK/pid" 2>/dev/null || true)
  if [ -n "$dono" ] && [ "$dono" != "$$" ] && kill -0 "$dono" 2>/dev/null; then
    return 1
  fi
  log "trava velha encontrada (PID ${dono:-desconhecido} não existe mais); removendo."
  rm -rf "$LOCK"
  if mkdir "$LOCK" 2>/dev/null; then
    echo "$$" > "$LOCK/pid"; TEM_LOCK=1; return 0
  fi
  return 1
}
trap 'liberar_lock' EXIT
# Como PID 1 do container, o shell só encerra no "docker stop" se tratar o sinal.
trap 'log "encerrando."; liberar_lock; exit 0' INT TERM

limpar_antigos() {
  # Nomes com data/hora ordenam cronologicamente; mantém os BACKUP_RETENCAO mais novos.
  total=$(ls -1 "$BACKUP_DIR" 2>/dev/null | grep -E "^${PREFIXO}_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}\.dump$" | wc -l)
  excesso=$((total - BACKUP_RETENCAO))
  if [ "$excesso" -gt 0 ]; then
    ls -1 "$BACKUP_DIR" | grep -E "^${PREFIXO}_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}\.dump$" | sort | head -n "$excesso" |
      while read -r antigo; do
        rm -f "$BACKUP_DIR/$antigo"
        log "removido (retenção de $BACKUP_RETENCAO): $antigo"
      done
  fi
}

fazer_dump() {
  if ! pegar_lock; then
    erro "outro backup está em andamento (PID $(cat "$LOCK/pid" 2>/dev/null || echo '?')); este dump foi PULADO."
    return 1
  fi

  nome="${PREFIXO}_$(date +%Y-%m-%d_%H%M%S).dump"
  parcial="$BACKUP_DIR/.$nome.parcial"
  log "iniciando dump de '$PGDATABASE' em ${PGHOST:-socket local} -> $nome"
  if pg_dump -Fc -f "$parcial" && pg_restore --list "$parcial" >/dev/null; then
    mv "$parcial" "$BACKUP_DIR/$nome"
    tamanho=$(du -h "$BACKUP_DIR/$nome" | cut -f1)
    log "ok: $BACKUP_DIR/$nome ($tamanho)"
    limpar_antigos
    status=0
  else
    rm -f "$parcial"
    erro "FALHA no dump de '$PGDATABASE'; nenhum backup antigo foi removido."
    status=1
  fi

  liberar_lock
  return "$status"
}

case "$MODO" in
  agora)
    fazer_dump
    ;;
  loop)
    log "serviço iniciado: dump diário às $BACKUP_HORARIO (fuso ${TZ:-UTC}), retenção de $BACKUP_RETENCAO arquivos em $BACKUP_DIR"
    # O loop é o primeiro processo do container: qualquer trava que exista agora sobrou de
    # uma execução anterior (o /tmp sobrevive ao "docker restart"; o PID pode até repetir).
    if [ -d "$LOCK" ]; then
      log "removendo trava de uma execução anterior."
      rm -rf "$LOCK"
    fi
    # Restos de um dump interrompido (container parado no meio) não são backups válidos.
    rm -f "$BACKUP_DIR"/.*.dump.parcial
    # Dump ao subir; uma falha aqui não derruba o serviço (tenta de novo no horário).
    fazer_dump || erro "o dump inicial não foi feito; próxima tentativa às $BACKUP_HORARIO."
    ultimo_dia=""
    while true; do
      agora=$(date +%H:%M)
      hoje=$(date +%Y-%m-%d)
      if [ "$agora" = "$BACKUP_HORARIO" ] && [ "$ultimo_dia" != "$hoje" ]; then
        ultimo_dia="$hoje"
        fazer_dump || erro "o dump agendado de $hoje às $BACKUP_HORARIO não foi feito; próxima tentativa amanhã. Use scripts/backup-agora.sh."
      fi
      sleep 30 &
      wait $! || true
    done
    ;;
  *)
    echo "Uso: $0 [agora|loop]" >&2
    exit 2
    ;;
esac

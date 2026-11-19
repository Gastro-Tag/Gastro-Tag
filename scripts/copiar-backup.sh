#!/bin/sh
# Copia os backups do volume para uma pasta fora dele (HD externo, pendrive, outro disco).
#
#   ./scripts/copiar-backup.sh <pasta> [manter]
#
# <pasta>:  destino, ex.: F:/GastroTag-backups (Git Bash aceita F:/... ou /f/...). É criada se não existir.
# [manter]: quantos dumps ficam na pasta de destino (padrão 30; os mais antigos saem).
#           Só arquivos com o nome dos backups (<banco>_AAAA-MM-DD_HHMMSS.dump) são apagados.
#
# Só lê o volume: não para nem altera containers. Copia apenas o que ainda não está no destino
# (ou está com tamanho diferente) e confere o tamanho de cada arquivo depois da cópia.
# Requer o serviço "backup" do docker-compose.yml em execução.
set -eu

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "Uso: $0 <pasta> [manter]" >&2
  exit 2
fi

DESTINO="$1"
MANTER="${2:-30}"
case "$MANTER" in
  ''|*[!0-9]*) echo "ERRO: [manter] deve ser um número inteiro maior que zero." >&2; exit 2 ;;
esac
if [ "$MANTER" -lt 1 ]; then
  echo "ERRO: [manter] deve ser maior que zero." >&2
  exit 2
fi

mkdir -p "$DESTINO"
DESTINO="$(cd "$DESTINO" && pwd)"
# Git Bash (Windows): o docker precisa do caminho do Windows.
DESTINO_DOCKER="$DESTINO"
if command -v cygpath >/dev/null 2>&1; then
  DESTINO_DOCKER="$(cygpath -w "$DESTINO")"
fi

cd "$(dirname "$0")/.."
PADRAO='^[A-Za-z0-9_]+_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}\.dump$'

# Nome e tamanho de cada backup do volume ("nome tamanho" por linha).
lista="$(MSYS_NO_PATHCONV=1 docker compose exec -T backup sh -c \
  'cd /backups && for f in *.dump; do [ -f "$f" ] && echo "$f $(stat -c %s "$f")"; done; true' | tr -d '\r')"
lista="$(printf '%s\n' "$lista" | grep -E "${PADRAO%\$} [0-9]+$" || true)"
if [ -z "$lista" ]; then
  echo "ERRO: nenhum backup encontrado no volume. Rode ./scripts/backup-agora.sh antes." >&2
  exit 1
fi

copiados=0
iguais=0
falhas=0
printf '%s\n' "$lista" | {
  while read -r nome tamanho; do
    local_arq="$DESTINO/$nome"
    if [ -f "$local_arq" ] && [ "$(wc -c < "$local_arq" | tr -d ' ')" = "$tamanho" ]; then
      iguais=$((iguais + 1))
      continue
    fi
    MSYS_NO_PATHCONV=1 docker compose cp "backup:/backups/$nome" "$DESTINO_DOCKER" >/dev/null 2>&1 || true
    if [ -f "$local_arq" ] && [ "$(wc -c < "$local_arq" | tr -d ' ')" = "$tamanho" ]; then
      echo "Copiado: $nome ($tamanho bytes)"
      copiados=$((copiados + 1))
    else
      echo "ERRO: $nome não foi copiado inteiro." >&2
      rm -f "$local_arq"
      falhas=$((falhas + 1))
    fi
  done
  echo "Novos: $copiados. Já estavam lá: $iguais. Falhas: $falhas."
  [ "$falhas" -eq 0 ]
}

# Retenção no destino: só os dumps com o nome dos backups; os mais antigos saem.
total=$(ls -1 "$DESTINO" | grep -cE "$PADRAO" || true)
if [ "$total" -gt "$MANTER" ]; then
  ls -1 "$DESTINO" | grep -E "$PADRAO" | sort | head -n "$((total - MANTER))" | while read -r antigo; do
    rm -f "$DESTINO/$antigo"
    echo "Removido do destino (mais antigo que os $MANTER mais recentes): $antigo"
  done
fi

echo
echo "Backups em $DESTINO:"
ls -lh "$DESTINO" | grep -E '_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}.dump$' || true

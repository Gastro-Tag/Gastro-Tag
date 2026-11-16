#!/bin/sh
# Restaura um backup do GastroTag num banco indicado, com confirmação explícita.
#
#   ./scripts/restaurar.sh <arquivo> <banco>
#
# <arquivo>: nome de um arquivo do volume de backups (ex.: gastrotag_2026-11-15_030000.dump)
#            ou caminho de um .dump nesta máquina (é copiado para o container antes).
# <banco>:   banco de destino. Recomendado restaurar primeiro num banco novo
#            (ex.: gastrotag_restaurado) para conferir; para substituir o banco da API,
#            pare a API antes (docker compose stop api).
# Requer o serviço "backup" do docker-compose.yml em execução.
set -eu

if [ "$#" -ne 2 ]; then
  echo "Uso: $0 <arquivo> <banco>" >&2
  exit 2
fi

ARQUIVO="$1"
BANCO="$2"
# Caminho relativo à pasta de onde o script foi chamado, antes do cd.
if [ -f "$ARQUIVO" ]; then
  ARQUIVO_LOCAL="$(cd "$(dirname "$ARQUIVO")" && pwd)/$(basename "$ARQUIVO")"
else
  ARQUIVO_LOCAL=""
fi

cd "$(dirname "$0")/.."
# Git Bash (Windows): o docker precisa do caminho do Windows para o arquivo local, e
# MSYS_NO_PATHCONV=1 (nos comandos abaixo) impede que /backups/... seja convertido.
if [ -n "$ARQUIVO_LOCAL" ] && command -v cygpath >/dev/null 2>&1; then
  ARQUIVO_LOCAL="$(cygpath -w "$ARQUIVO_LOCAL")"
fi

if [ -n "$ARQUIVO_LOCAL" ]; then
  DESTINO="/tmp/restaurar.dump"
  echo "Copiando $ARQUIVO_LOCAL para o container de backup..."
  MSYS_NO_PATHCONV=1 docker compose cp "$ARQUIVO_LOCAL" "backup:$DESTINO"
else
  DESTINO="/backups/$(basename "$ARQUIVO")"
fi

echo
echo "ATENÇÃO: o arquivo $DESTINO será restaurado no banco '$BANCO'."
echo "Se o banco já existir, as tabelas dele serão SUBSTITUÍDAS pelo conteúdo do backup."
printf "Para confirmar, digite o nome do banco (%s): " "$BANCO"
read -r RESPOSTA || RESPOSTA=""
if [ "$RESPOSTA" != "$BANCO" ]; then
  echo "Confirmação diferente. Nada foi feito."
  exit 3
fi

STATUS=0
MSYS_NO_PATHCONV=1 docker compose exec -T -e CONFIRMA_BANCO="$BANCO" backup sh -c \
  'tr -d "\r" < /scripts/restaurar-postgres.sh > /tmp/restaurar-postgres.sh && sh /tmp/restaurar-postgres.sh "$1" "$2"' \
  sh "$DESTINO" "$BANCO" </dev/null || STATUS=$?

# Remove de dentro do container a cópia temporária do arquivo local.
if [ -n "$ARQUIVO_LOCAL" ]; then
  MSYS_NO_PATHCONV=1 docker compose exec -T backup rm -f "$DESTINO" </dev/null || true
fi
exit "$STATUS"

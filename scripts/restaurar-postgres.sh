#!/bin/sh
# Restaura um dump (pg_dump -Fc) num banco indicado. Roda DENTRO de um container com as
# ferramentas do PostgreSQL (serviço "backup"). Use pelo scripts/restaurar.sh no servidor.
#
#   CONFIRMA_BANCO=<banco> restaurar-postgres.sh <arquivo.dump> <banco>
#
# Nunca é automático: sem CONFIRMA_BANCO igual ao nome do banco, nada é feito.
# Banco inexistente: é criado e o dump é restaurado nele.
# Banco existente: os objetos do dump são recriados (--clean); recusa se houver conexões
# abertas (pare a API antes: docker compose stop api).
# Conexão pelas variáveis do libpq (PGHOST, PGPORT, PGUSER, PGPASSWORD).
set -eu

ARQUIVO="${1:-}"
BANCO="${2:-}"

log() { echo "[restaurar] $*"; }

if [ -z "$ARQUIVO" ] || [ -z "$BANCO" ]; then
  echo "Uso: CONFIRMA_BANCO=<banco> $0 <arquivo.dump> <banco>" >&2
  exit 2
fi
if ! echo "$BANCO" | grep -Eq '^[A-Za-z_][A-Za-z0-9_]{0,62}$'; then
  log "nome de banco inválido: '$BANCO' (use letras, números e _)."
  exit 2
fi
if [ "${CONFIRMA_BANCO:-}" != "$BANCO" ]; then
  log "confirmação ausente ou diferente do banco '$BANCO'. Nada foi feito."
  exit 3
fi
if [ ! -r "$ARQUIVO" ]; then
  log "arquivo não encontrado: $ARQUIVO"
  exit 4
fi
if ! pg_restore --list "$ARQUIVO" >/dev/null 2>&1; then
  log "o arquivo não é um dump válido do pg_dump -Fc: $ARQUIVO"
  exit 4
fi

existe=$(psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$BANCO'")

if [ "$existe" = "1" ]; then
  conexoes=$(psql -d postgres -tAc "SELECT count(*) FROM pg_stat_activity WHERE datname = '$BANCO' AND pid <> pg_backend_pid()")
  if [ "$conexoes" != "0" ]; then
    log "o banco '$BANCO' tem $conexoes conexão(ões) aberta(s). Pare a API (docker compose stop api) e tente de novo."
    exit 5
  fi
  log "banco '$BANCO' existe: os objetos do dump serão substituídos."
  LIMPAR="--clean --if-exists"
else
  log "criando o banco '$BANCO'."
  createdb --maintenance-db=postgres -T template0 "$BANCO"
  LIMPAR=""
fi

log "restaurando $ARQUIVO em '$BANCO' (uma transação; para no primeiro erro)."
# shellcheck disable=SC2086
pg_restore $LIMPAR --no-owner --no-privileges --exit-on-error --single-transaction -d "$BANCO" "$ARQUIVO"
log "ok: restauração concluída em '$BANCO'."

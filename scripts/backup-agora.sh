#!/bin/sh
# Faz um backup imediato do banco do GastroTag (além do diário automático).
# Rode no servidor, na pasta do projeto ou de qualquer lugar: ./scripts/backup-agora.sh
# Requer o serviço "backup" do docker-compose.yml em execução.
set -eu

cd "$(dirname "$0")/.."
# MSYS_NO_PATHCONV: no Git Bash (Windows), impede que /scripts/... vire caminho do Windows.
# tr remove um eventual CR (arquivo com fim de linha do Windows) antes de executar.
MSYS_NO_PATHCONV=1 docker compose exec -T backup sh -c \
  'tr -d "\r" < /scripts/backup-postgres.sh > /tmp/backup-postgres.sh && sh /tmp/backup-postgres.sh agora'

echo
echo "Backups disponíveis (volume backups_data):"
MSYS_NO_PATHCONV=1 docker compose exec -T backup ls -lh /backups

#!/bin/sh
# Liga o túnel gratuito da Cloudflare (link HTTPS público *.trycloudflare.com) e mostra o link.
#   ./scripts/tunel.sh         liga (sobe o sistema, se ainda não estiver no ar) e mostra o link
#   ./scripts/tunel.sh parar   desliga o túnel (o sistema continua no ar pela rede local)
# Qualquer pessoa com o link vê a tela de login: use senhas fortes e desligue ao terminar.
# O link muda a cada vez que o túnel liga.
set -eu

cd "$(dirname "$0")/.."

acao="${1:-ligar}"

case "$acao" in
  parar)
    docker compose --profile tunel rm --stop --force tunel
    echo "Túnel desligado."
    exit 0
    ;;
  ligar) ;;
  *)
    echo "Uso: $0 [parar]" >&2
    exit 2
    ;;
esac

# Link do quick tunnel no log. api.trycloudflare.com é o endereço do serviço que cria o túnel
# (aparece em mensagens de erro), não o link de acesso.
extrair_link() {
  grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | grep -vx 'https://api\.trycloudflare\.com' | head -n 1
}

echo "Se o código do sistema foi atualizado, rode antes: docker compose up -d --build"
echo "(sem isso, o túnel pode responder 502)."
echo

# Remove um túnel anterior: o log antigo teria o link de antes, que não vale mais.
docker compose --profile tunel rm --stop --force tunel >/dev/null 2>&1 || true
docker compose --profile tunel up -d tunel

echo "Aguardando o link do túnel..."
tentativas=0
while [ "$tentativas" -lt 60 ]; do
  link=$(docker compose --profile tunel logs tunel 2>/dev/null | extrair_link || true)
  if [ -z "$(docker compose --profile tunel ps --status running -q tunel 2>/dev/null)" ]; then
    echo "ERRO: o túnel parou (o container não está rodando). Veja: docker compose --profile tunel logs tunel" >&2
    exit 1
  fi
  if [ -n "$link" ]; then
    echo
    echo "Túnel ligado: $link"
    echo "Totem: $link/totem/login"
    echo "Desligar: ./scripts/tunel.sh parar"
    exit 0
  fi
  tentativas=$((tentativas + 1))
  sleep 2
done

echo "ERRO: o link não apareceu em 2 minutos. Veja: docker compose --profile tunel logs tunel" >&2
exit 1

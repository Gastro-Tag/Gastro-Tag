# Backup e restauração do banco (GastroTag)

O `docker-compose.yml` tem um serviço `backup` (imagem `postgres:16.16-alpine3.24`) que
faz cópias do banco com `pg_dump -Fc` (formato custom, comprimido):

- **um dump ao subir** o serviço e **um por dia** no horário `BACKUP_HORARIO`
  (padrão `03:00`, fuso `America/Manaus`);
- os arquivos ficam no volume Docker `backups_data` (dentro do container: `/backups`),
  com nome `gastrotag_AAAA-MM-DD_HHMMSS.dump`;
- mantém os **últimos `BACKUP_RETENCAO`** arquivos (padrão 14) e apaga os mais antigos,
  só depois de um dump bem-sucedido;
- cada dump é conferido com `pg_restore --list` antes de entrar na lista; um dump
  interrompido nunca substitui os anteriores;
- a senha do banco não aparece em comandos nem em logs: vai só pela variável
  `PGPASSWORD` do container (vinda de `POSTGRES_PASSWORD` do `.env`).

Ajuste `BACKUP_HORARIO` e `BACKUP_RETENCAO` no `.env` (veja `.env.example`).

Os scripts abaixo rodam no servidor, com o projeto já no ar
(`docker compose up -d`), a partir de qualquer pasta. No Windows, use o Git Bash.

## Ver os logs e os backups existentes

```sh
docker compose logs --tail 20 backup
docker compose exec backup ls -lh /backups
docker compose logs backup | grep ERRO   # dumps que falharam ou foram pulados
```

## Backup manual (agora)

```sh
./scripts/backup-agora.sh
```

Faz um dump imediato (mesmas regras do diário) e lista os arquivos. Faça um antes de
qualquer atualização do sistema.

## Copiar os backups para fora do servidor

O volume fica no mesmo disco do servidor: **um backup que só existe ali se perde junto
com o servidor**. Copie com regularidade para outro lugar (outro computador, pendrive,
armazenamento em nuvem).

```sh
# 1) do volume para uma pasta do servidor
mkdir -p ~/backups-gastrotag
docker compose cp backup:/backups/gastrotag_2026-11-15_030000.dump ~/backups-gastrotag/

# ou todos de uma vez
docker compose cp backup:/backups/. ~/backups-gastrotag/

# 2) do servidor para o seu computador (rode no seu computador)
scp usuario@servidor:~/backups-gastrotag/*.dump .
```

Os arquivos contêm todos os dados do sistema (inclusive usuários e hashes de senha):
guarde-os em local com acesso restrito.

## Restaurar

```sh
./scripts/restaurar.sh <arquivo> <banco>
```

- `<arquivo>`: o nome de um arquivo do volume (ex.: `gastrotag_2026-11-15_030000.dump`)
  ou o caminho de um `.dump` nesta máquina (é copiado para o container antes);
- `<banco>`: o banco de destino. O script pede para **digitar o nome do banco** para
  confirmar; sem isso, nada é feito. Nunca roda sozinho.

Se o banco não existir, ele é criado. Se existir, as tabelas dele são substituídas pelo
conteúdo do backup (`pg_restore --clean`), tudo numa transação: se algo falhar, o banco
fica como estava. O script recusa um banco com conexões abertas.

### Conferir antes (recomendado)

Restaure primeiro num banco novo e confira:

```sh
./scripts/restaurar.sh gastrotag_2026-11-15_030000.dump gastrotag_restaurado
docker compose exec db psql -U gastrotag -d gastrotag_restaurado -c "select count(*) from labels"
```

Depois, para apagar o banco de conferência:
`docker compose exec db dropdb -U gastrotag gastrotag_restaurado`.

### Substituir o banco do sistema

```sh
./scripts/backup-agora.sh                 # guarda o estado atual, por garantia
docker compose stop api                   # ninguém usando o banco
./scripts/restaurar.sh gastrotag_2026-11-15_030000.dump gastrotag
docker compose start api                  # aplica migrations pendentes ao subir
```

O nome do banco do sistema é o `POSTGRES_DB` do `.env` (padrão `gastrotag`).

## Arquivos

- `backup-postgres.sh` — roda dentro do serviço `backup` (`loop` ou `agora`);
- `restaurar-postgres.sh` — roda dentro do serviço `backup`; exige `CONFIRMA_BANCO`
  igual ao nome do banco;
- `backup-agora.sh`, `restaurar.sh` — atalhos para usar no servidor;
- `tunel.sh` — liga o túnel gratuito da Cloudflare (perfil `tunel` do Compose) e mostra o
  link `https://...trycloudflare.com`; `tunel.sh parar` desliga (guia no README da raiz);
- `.gitattributes` — mantém os `.sh` com fim de linha LF (os containers são Linux).

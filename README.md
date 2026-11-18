 # Gastro-Tag

Sistema web para identificar alimentos, acompanhar validade após abertura e gerar etiquetas com data de descarte.

## Tecnologias

| Camada | Tecnologia |
|---|---|
| Frontend | React 18, TypeScript, Vite e Tailwind CSS 3.4 |
| API | Node.js, Express e TypeScript |
| Banco e ORM | PostgreSQL 16 e Prisma |
| Infraestrutura | Docker Compose |
| Autenticação | JWT de acesso e refresh, com segredos separados |

## Estrutura

- `backend/`: API Express, regras de aplicação, Prisma e seed.
- `frontend/`: interface React, páginas e chamadas à API.
- `docs/`: documentação local de planejamento e arquitetura; o diretório é ignorado pelo Git; apenas `docs/TOTEM.md` é versionado.
- `docker-compose.yml`: banco, API e frontend para execução conjunta.

## Executar com Docker Compose

1. Copie `.env.example` para `.env`.
2. Configure `POSTGRES_PASSWORD` e gere dois segredos JWT aleatórios e diferentes, cada um com pelo menos 32 caracteres.
3. Configure `ADMIN_EMAIL` e `ADMIN_PASSWORD` (mínimo de 12 caracteres) para provisionar o administrador. Ao iniciar, a API só cria o administrador quando ele ainda não existe; não altera a senha nem o papel de uma conta existente. Para ressincronizar senha, papel e situação ativa (revogando as sessões da conta), use `ADMIN_SYNC_ON_BOOT=true` temporariamente (as sessões da conta só são revogadas se a senha ou o papel mudarem). Sem ambas, não cria administrador automaticamente.
4. Inicie os serviços:

```bash
docker compose up -d --build
```

A API aplica as migrations automaticamente ao iniciar. Acesse `http://localhost`. O PostgreSQL e a API ficam disponíveis apenas na rede interna do Compose; somente o frontend publica a porta 80.

Para incluir os produtos de demonstração, execute:

```bash
docker compose exec api npm run seed
```

Os produtos de seed usam datas relativas à execução. Registros existentes são preservados. O seed cria um administrador somente quando `ADMIN_EMAIL` e `ADMIN_PASSWORD` estão configurados.

Para parar os serviços sem apagar os dados do banco:

```bash
docker compose down
```

Os dados do PostgreSQL ficam no volume `postgres_data`.

Os logs dos containers ficam limitados a cerca de 30 MB por serviço (driver `json-file`, 3 arquivos de 10 MB com rotação), e `docker compose logs` continua funcionando normalmente. A mudança vale para cada container quando ele é recriado (`docker compose up -d` recria os que mudaram).

## Executar em desenvolvimento local

O modo local conecta o backend ao PostgreSQL em `localhost:5432` e usa a API em `localhost:3333`.

### Backend

```bash
cd backend
cp .env.example .env
npm install
npx prisma migrate dev
npm run dev
```

Configure `DATABASE_URL`, `JWT_ACCESS_SECRET` e `JWT_REFRESH_SECRET` no `backend/.env`. Use segredos distintos de pelo menos 32 caracteres. Para criar um administrador inicial, informe também `ADMIN_EMAIL` e `ADMIN_PASSWORD`.

### Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

O frontend usa `/api` como URL base. No desenvolvimento, o Vite encaminha `/api` para `http://localhost:3333` por padrão; se a API estiver em outro endereço, configure `VITE_API_URL` em `frontend/.env`. No Docker, o Nginx encaminha `/api` ao backend e nenhuma URL de API é embutida no bundle.

## Endpoints principais

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/auth/login` | Entrar |
| POST | `/api/auth/refresh` | Renovar tokens (cada renovação troca o refresh token) |
| POST | `/api/auth/logout` | Encerrar a sessão deste aparelho (recebe o refresh token) |
| PATCH | `/api/auth/password` | Trocar a própria senha e encerrar as outras sessões |
| GET | `/api/auth/me` | Consultar usuário autenticado |
| POST | `/api/auth/verify-admin` | Confirmar credenciais de administrador (usada pelo totem) |
| GET | `/api/users` | Listar usuários (ADMIN) |
| POST | `/api/users` | Criar usuário (ADMIN) |
| PUT | `/api/users/:id` | Atualizar, desativar ou reativar usuário (ADMIN) |
| PATCH | `/api/users/:id/password` | Redefinir senha (ADMIN) |
| GET | `/api/products` | Listar produtos com filtros |
| GET | `/api/products/categories` | Listar categorias |
| POST | `/api/products` | Cadastrar produto (ADMIN) |
| GET | `/api/products/:id` | Buscar produto |
| PUT | `/api/products/:id` | Atualizar produto (ADMIN) |
| DELETE | `/api/products/:id` | Desativar produto (ADMIN) |
| GET | `/api/labels` | Consultar histórico |
| POST | `/api/labels/preview` | Pré-visualizar o cálculo de descarte |
| POST | `/api/labels` | Gerar etiqueta (`requestId` opcional: reenviar o mesmo pedido devolve a mesma etiqueta) |
| GET | `/api/labels/:id` | Consultar etiqueta |
| PATCH | `/api/labels/:id/print` | Registrar impressão |
| GET | `/api/dashboard/stats` | Consultar indicadores |
| GET | `/health` | Verificar disponibilidade da API |

### Filtros de produtos

`GET /api/products` aceita `status=all|valid|expiring|expired|recent`, `search`, `storage=refrigerado|congelado`, `category`, `sort=name|brand|date|created`, `order=asc|desc` e paginação com `page` e `limit`.

## Testes

Os testes unitários de datas e cálculo podem ser executados sem banco:

```bash
cd backend
npm install
npm test
```

Os testes de integração da API também precisam de um PostgreSQL com as migrations aplicadas. Use um banco descartável dedicado aos testes; a suíte cria e remove registros nesse banco. No PowerShell, por exemplo:

```powershell
cd backend
$env:DATABASE_URL = "postgresql://gastrotag:senha_local@localhost:5432/gastrotag_test"
npx prisma migrate deploy
npm test
Remove-Item Env:DATABASE_URL
```

Sem `DATABASE_URL`, o Vitest executa os testes unitários e ignora `tests/api.test.ts`. Não aponte a suíte para um banco de produção ou para o banco com dados que deseja preservar.

## Rodar no notebook (demonstração)

Guia para usar o notebook (Windows + Docker Desktop) como servidor, com tablet ou celular operando pela mesma rede. Sem custo de hospedagem. Os comandos são para o PowerShell, na pasta do projeto.

### 1. Pré-requisitos e `.env`

1. Docker Desktop instalado e **ligado** (ícone da baleia sem aviso de erro).
2. Crie o `.env` **uma única vez** (o comando não sobrescreve um `.env` existente) e preencha `POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ADMIN_EMAIL` e `ADMIN_PASSWORD` (mínimo de 12 caracteres). Use senhas fortes: com o túnel, qualquer pessoa com o link vê a tela de login.

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

3. Para gerar um valor aleatório (pode rodar quantas vezes quiser, uma vez para cada segredo; os dois segredos JWT devem ser diferentes, com pelo menos 32 caracteres):

```powershell
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 40 | ForEach-Object { [char]$_ })
```

Nunca compartilhe nem versione o `.env`.

Atenção: trocar `POSTGRES_PASSWORD` depois da primeira subida **não** muda a senha do banco que já existe (o volume guarda a senha antiga). E `ADMIN_PASSWORD` só vale na criação do administrador; para sincronizá-la depois é preciso `ADMIN_SYNC_ON_BOOT=true` (e voltar a `false` em seguida).

### 2. Subir e conferir

```powershell
docker compose up -d --build
docker compose ps
```

Espere os serviços `db`, `api` e `frontend` ficarem `healthy` (a primeira subida demora). Teste no próprio notebook em `http://localhost`. Para dados de demonstração (opcional): `docker compose exec api npm run seed`.

### 3. Descobrir o IP do notebook

```powershell
ipconfig
```

No adaptador **Wi-Fi**, anote o **Endereço IPv4** (por exemplo `192.168.0.15`). Se trocar de rede ou usar o hotspot do celular, o IP muda: rode o comando de novo.

### 4. Firewall do Windows (ação sua, como administrador)

Por padrão o Windows bloqueia a entrada de outros aparelhos. Libere a porta 80 **somente para o perfil Privado**; a rede Wi-Fi precisa estar marcada como **Privada** (Configurações → Rede e Internet → Wi-Fi → propriedades da rede → Tipo de perfil de rede). Em um PowerShell **aberto como administrador**:

```powershell
New-NetFirewallRule -DisplayName "GastroTag demo (porta 80)" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow -Profile Private
```

Para remover a regra quando terminar:

```powershell
Remove-NetFirewallRule -DisplayName "GastroTag demo (porta 80)"
```

Este guia não altera o firewall por você: o comando acima é executado por quem administra o notebook. Não use perfil Público (redes de terceiros).

Se o celular ainda não abrir a página, confira em Firewall do Windows → Permitir um aplicativo → se o Docker Desktop está liberado em **Privada**. O hotspot do celular costuma entrar como rede **Pública**: marque-o como Privada.

### 5. Abrir no celular ou tablet

Conecte o aparelho na mesma Wi-Fi (ou ligue o notebook no hotspot do celular) e abra:

- Painel: `http://<IP>` (por exemplo `http://192.168.0.15`)
- Totem: `http://<IP>/totem/login`

Para imprimir em PDF pelo aparelho (sem impressora):

- **Android (Chrome):** menu do navegador → Compartilhar → Imprimir → Salvar como PDF.
- **iPhone (Safari):** botão Compartilhar → Imprimir; na prévia, abra o PDF (afastando os dedos sobre a miniatura) e salve ou compartilhe.

O botão de impressão do sistema abre a janela de impressão do navegador; as etiquetas continuam sendo impressas pelo navegador, sem integração direta com impressora térmica.

### 6. Túnel gratuito com HTTPS (opcional)

O túnel da Cloudflare (sem conta) gera um link `https://...trycloudflare.com` para acessar de fora da rede, por exemplo por amigos que vão testar. Cada pessoa precisa de uma conta própria, criada por um ADMIN em **Usuários**.

Depois de atualizar o código, rode `docker compose up -d --build` antes de ligar o túnel. Ligar e mostrar o link (no Git Bash, que acompanha o Git para Windows):

```bash
./scripts/tunel.sh
```

Equivalente no PowerShell (o link aparece nos logs):

```powershell
docker compose --profile tunel rm --stop --force tunel   # apaga o link antigo dos logs
docker compose --profile tunel up -d tunel
docker compose --profile tunel logs tunel | Select-String "trycloudflare.com"   # repita se ainda não aparecer
```

O totem fica em `<link>/totem/login`. Para desligar (o sistema continua no ar pela rede local):

```bash
./scripts/tunel.sh parar
```

```powershell
docker compose --profile tunel rm --stop --force tunel
```

Avisos:

- O link **muda a cada vez** que o túnel liga.
- Só funciona com o notebook ligado, acordado e com internet.
- Qualquer pessoa com o link vê a tela de login: mantenha senhas fortes e **desligue o túnel quando não estiver usando**.
- Se aparecer `https://api.trycloudflare.com` em uma linha de erro dos logs, esse **não** é o seu link.
- Antes de `docker compose down`, desligue o túnel (`./scripts/tunel.sh parar`) ou use `docker compose --profile tunel down`.
- Depois de reiniciar o notebook ou o Docker, o túnel fica desligado até você ligar de novo.

### 7. Backup antes e depois de usar

Rode antes e depois da demonstração. **Estes comandos são para o Git Bash** (não para o PowerShell), com o sistema no ar, e copie o arquivo para **fora** do notebook (pendrive ou nuvem pessoal), pois o volume fica no mesmo disco:

```bash
./scripts/backup-agora.sh
mkdir -p ~/backups-gastrotag
docker compose cp backup:/backups/. ~/backups-gastrotag/
```

Detalhes e restauração em [`scripts/README.md`](scripts/README.md). Os backups contêm usuários e hashes de senha: guarde em local restrito.

### 8. Limitações

- **Sem HTTPS na rede local:** `http://<IP>` trafega sem criptografia na Wi-Fi; use apenas em rede de confiança. Só o link do túnel tem HTTPS.
- **O notebook precisa ficar ligado e sem suspender.** Enquanto estiver na tomada, ajuste em Configurações → Sistema → Energia e bateria → Tela e suspensão para "Nunca" na opção "conectado" (e confira a ação ao fechar a tampa). Depois da demonstração, volte à configuração anterior.
- **Limite de login por IP:** no Docker Desktop, aparelhos da rede local podem chegar à API com o mesmo IP, então tentativas de login falhas de um aparelho podem bloquear outros temporariamente.
- O IP do notebook pode mudar entre redes; refaça o passo 3.

## Modo totem

A interface de totem para a bancada fica em `http://localhost/totem`: grade de produtos, data de descarte já calculada e impressão em 4 toques no caso simples. Detalhes de uso, instalação em modo quiosque e limitações em [`docs/TOTEM.md`](docs/TOTEM.md).

## Roteiro da demonstração

1. Entrar com a conta ADMIN configurada no `.env`.
2. Cadastrar ou localizar um produto e, em **Lotes**, registrar o lote recebido com a validade do fabricante.
3. Abrir a criação de etiqueta, escolher o lote ou informar a validade da embalagem, e preencher responsável, armazenamento e temperatura.
4. Conferir a prévia, o prazo aplicado e a data de descarte.
5. Gerar e imprimir a etiqueta pelo navegador.
6. Conferir o registro no histórico e os indicadores no dashboard.

## Escopo e limitações atuais

- O cálculo usa os prazos cadastrados no produto ou, quando houver, uma regra de validade versionada, cadastrada na tela `/rules` (somente ADMIN), com fonte e responsável pela validação. Ainda não existe um catálogo normativo validado; os valores precisam ser confirmados pelo responsável técnico antes de uso operacional.
- O dia da abertura conta como dia 1: um prazo de 3 dias com abertura em 01/09 vai até 03/09. O servidor recusa abertura futura e etiqueta que já nasceria vencida.
- A impressão é feita pelo navegador, com quatro modelos de etiqueta: folha A4 / papel comum (9 cm de largura) e 100×60 mm, ambos com todas as informações; térmica 60×40 mm, resumida (sem logo, marca e assinatura; mostra a validade do fabricante e o prazo com o tipo da fonte, ou SEM REGRA VALIDADA); e térmica 50×30 mm, mínima (produto, descarte, abertura, lote, validade do fabricante, responsável e código, com S/ REGRA quando não há regra; armazenamento e temperatura só se couberem). A validade do fabricante sai em todos os modelos quando existe. Nas térmicas os textos diminuem sozinhos (nunca abaixo de 6 pt); a data de descarte é o maior elemento nos modelos pequenos e só cai a um piso (18 pt no 60×40, 14 pt no 50×30) quando, sem isso, não caberia. Se mesmo assim não couber, o texto continua na etiqueta seguinte, sem cortar nada. O modelo é escolhido por aparelho na tela de gerar etiqueta ou no menu do administrador do totem (guardado em `localStorage`, chave `gastrotag_label_template`) e o totem usa o modelo salvo no aparelho; sem escolha, a impressão sai em A4 e as telas avisam. Na térmica, o `@page` define o tamanho; o papel configurado no driver da impressora deve ter o mesmo tamanho. **Ainda não houve teste em impressora térmica física**; o modelo térmico não foi validado em papel. Integração direta com impressoras térmicas não faz parte do TCC atual.
- O sistema não envia e-mail: o "Esqueci minha senha" dos logins do painel e do totem apenas orienta que a senha seja redefinida por um administrador em **Usuários → Senha**. A senha da conta de `ADMIN_EMAIL` só é sincronizada na inicialização com `ADMIN_SYNC_ON_BOOT=true`. Os campos de senha têm botão de olho para mostrar o que foi digitado.
- O sistema está direcionado a uma cozinha/unidade; multiempresa, multiunidade e operação SaaS ficam para uma etapa futura.
- O seed é opcional e cria dados demonstrativos com datas relativas à execução. A inicialização normal não exige executar o seed.

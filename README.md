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
3. Configure `ADMIN_EMAIL` e `ADMIN_PASSWORD` (mínimo de 12 caracteres) para provisionar o administrador. A API sincroniza a senha e o papel dessa conta com essas variáveis ao iniciar. Sem ambas, não cria administrador automaticamente.
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
| POST | `/api/auth/refresh` | Renovar tokens |
| GET | `/api/auth/me` | Consultar usuário autenticado |
| GET | `/api/products` | Listar produtos com filtros |
| GET | `/api/products/categories` | Listar categorias |
| POST | `/api/products` | Cadastrar produto |
| GET | `/api/products/:id` | Buscar produto |
| PUT | `/api/products/:id` | Atualizar produto |
| DELETE | `/api/products/:id` | Desativar produto (ADMIN) |
| GET | `/api/labels` | Consultar histórico |
| POST | `/api/labels/preview` | Pré-visualizar o cálculo de descarte |
| POST | `/api/labels` | Gerar etiqueta |
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

## Modo totem

A interface de totem para a bancada fica em `http://localhost/totem`: grade de produtos, data de descarte já calculada e impressão em 2 toques. Detalhes de uso, instalação em modo quiosque e limitações em [`docs/TOTEM.md`](docs/TOTEM.md).

## Roteiro da demonstração

1. Entrar com a conta ADMIN configurada no `.env`.
2. Cadastrar ou localizar um produto.
3. Abrir a criação de etiqueta e informar lote, responsável, armazenamento e temperatura.
4. Conferir a prévia, o prazo aplicado e a data de descarte.
5. Gerar e imprimir a etiqueta pelo navegador.
6. Conferir o registro no histórico e os indicadores no dashboard.

## Escopo e limitações atuais

- O cálculo usa os prazos cadastrados no produto. A matriz de regras sanitárias ainda não está centralizada como um catálogo normativo validado; os valores precisam ser confirmados pelo responsável técnico antes de uso operacional.
- A impressão é feita pelo navegador. Integração direta com impressoras térmicas não faz parte do TCC atual.
- O sistema está direcionado a uma cozinha/unidade; multiempresa, multiunidade e operação SaaS ficam para uma etapa futura.
- O seed é opcional e cria dados demonstrativos com datas relativas à execução. A inicialização normal não exige executar o seed.

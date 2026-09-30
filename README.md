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
- `docs/ESCOPO_TCC.md`: escopo da entrega acadêmica e limites do MVP.
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
| POST | `/api/labels` | Gerar etiqueta |
| GET | `/api/labels/:id` | Consultar etiqueta |
| PATCH | `/api/labels/:id/print` | Registrar impressão |
| GET | `/api/dashboard/stats` | Consultar indicadores |
| GET | `/health` | Verificar disponibilidade da API |

### Filtros de produtos

`GET /api/products` aceita `status=valid|expiring|expired|recent`, `search`, `storage=refrigerado|congelado`, `sort=name|date|brand`, `order=asc|desc` e paginação com `page` e `limit`.

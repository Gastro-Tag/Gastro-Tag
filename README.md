# Gastro-Tag 🏷

Sistema de Identificação e Rotulagem de Alimentos — versão produção.

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS v4 + Shadcn/UI |
| Backend | Node.js + Express + TypeScript |
| ORM | Prisma |
| Banco | PostgreSQL 16 |
| Infra | Docker + Docker Compose |
| Auth | JWT (access + refresh token) |

## Estrutura

```
gastrotag/
├── backend/          # API REST Express
│   ├── src/
│   │   ├── controllers/
│   │   ├── middlewares/
│   │   ├── routes/
│   │   ├── services/
│   │   └── utils/
│   └── prisma/       
├── frontend/         
│   └── src/
│       ├── components/
│       ├── pages/
│       ├── services/  
│       ├── hooks/
│       ├── store/     
│       └── types/
└── docker-compose.yml
```

## Como rodar (produção)

```bash
# 1. Copie e edite as variáveis de ambiente
cp .env.example .env
nano .env

# 2. Suba tudo
docker compose up -d --build

# 3. Execute as migrations (primeira vez)
docker compose exec api npx prisma migrate deploy

# 4. (Opcional) Seed de dados iniciais
docker compose exec api npm run seed
```

Acesse: http://localhost

## Como rodar (desenvolvimento local)

### Backend
```bash
cd backend
cp .env.example .env   # ajuste DATABASE_URL
npm install
npx prisma migrate dev
npm run dev            # porta 3333
```

### Frontend
```bash
cd frontend
cp .env.example .env
npm install
npm run dev            # porta 5173
```

## Endpoints da API

| Método | Rota | Descrição |
|---|---|---|
| POST | /api/auth/login | Login |
| POST | /api/auth/refresh | Renovar token |
| GET | /api/products | Listar com filtros |
| POST | /api/products | Cadastrar produto |
| GET | /api/products/:id | Buscar por ID |
| PUT | /api/products/:id | Atualizar produto |
| DELETE | /api/products/:id | Remover produto |
| POST | /api/labels | Registrar geração de etiqueta |
| GET | /api/labels | Histórico de etiquetas |
| GET | /api/labels/:id | Etiqueta específica |
| POST | /api/upload/logo | Upload do logo |
| GET | /api/dashboard/stats | Estatísticas gerais |

## Filtros disponíveis (GET /api/products)

```
?status=valid          # válidos
?status=expiring       # vencem em até 7 dias
?status=expired        # vencidos
?status=recent         # cadastrados nos últimos 7 dias
?search=leite          # busca por nome ou marca
?storage=refrigerado   # filtra por tipo de armazenamento
?sort=name|date|brand  # ordenação
?order=asc|desc
?page=1&limit=20       # paginação
```

FROM node:22.23.5-alpine3.24 AS builder

WORKDIR /app

RUN apk add --no-cache openssl

COPY package*.json ./

RUN npm ci

COPY . .

RUN npx prisma generate

RUN npm run build


FROM node:22.23.5-alpine3.24 AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

RUN apk add --no-cache openssl

# Os arquivos ficam com dono root (somente leitura para o processo); a API roda como "node".
COPY --from=builder /app/dist ./dist

COPY --from=builder /app/node_modules ./node_modules

COPY --from=builder /app/package.json ./

COPY --from=builder /app/prisma ./prisma

USER node

EXPOSE 3333

CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/server.js"]

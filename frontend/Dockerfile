FROM node:22.23.5-alpine3.24 AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# nginx sem root: roda como usuário "nginx" (uid 101) e escuta 8080 dentro do container.
FROM nginxinc/nginx-unprivileged:1.30.6-alpine3.24 AS runner
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]

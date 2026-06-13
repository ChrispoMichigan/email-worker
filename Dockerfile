FROM node:24-slim

WORKDIR /app

# Habilitar pnpm con la versión exacta del proyecto
RUN corepack enable && corepack prepare pnpm@10.27.0 --activate

# Instalar dependencias primero (capa cacheada si no cambia package.json)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# Copiar código fuente y plantillas
COPY src/ ./src/
COPY templates/ ./templates/

EXPOSE 3000

CMD ["node", "src/index.js"]

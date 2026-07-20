# creavy-quote stage-1/1½ service (Phase 2a). Node 24 runs TypeScript natively (type
# stripping) — no build step. Single runtime dependency: pg (#34).
FROM node:24-alpine
WORKDIR /app

# deps first for layer caching (only pg)
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

ENV NODE_ENV=staging
EXPOSE 8080

# index.ts loads config (hard-fail on missing), runs migrations, starts the server.
CMD ["npm", "start"]

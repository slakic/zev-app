# ZEV upravnik — application image.
# Single-stage on purpose: the runtime keeps full node_modules so that the
# WASM migration tool (scripts/migrate.mjs) and tsx seed work inside the
# container. Image size is traded for reliability, which is right for a
# self-hosted MVP.
FROM node:22-alpine

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Application source (generated Prisma client is committed in src/generated,
# so no engine downloads are needed at build time)
COPY . .

# Build the production bundle. No database access happens during build:
# all pages are dynamic (cookie-based auth) — the URL below is a placeholder.
ENV NEXT_TELEMETRY_DISABLED=1
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" npm run build

# Generated PDFs and uploads live here — mount a volume in compose.
RUN mkdir -p var/storage && chown -R node:node /app
USER node

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
EXPOSE 3000

ENTRYPOINT ["sh", "./docker-entrypoint.sh"]

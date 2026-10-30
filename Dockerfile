# syntax=docker/dockerfile:1
# Common Ground: the game server (REST + SSE API, Claude or Demo AI, grounding) serving the built
# web client. The server runs its TypeScript directly on Node's built-in type stripping.

ARG NODE_VERSION=24

# ---- build: the web client is static, so build it once on the runner's native platform ---------
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json ./
COPY public public
COPY shared shared
COPY src src
RUN npm run build

# ---- runtime dependencies, installed for each target platform ----------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- runtime ------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends tini ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
  PORT=8787 \
  DATA_DIR=/app/data
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY package.json ./
COPY shared shared
COPY server server
# A new settings-page key when the one printed at first start is lost: docker exec <container> node scripts/settings-key.ts
COPY scripts/settings-key.ts scripts/
COPY --from=build /app/dist/client dist/client
# Settings saved on the settings page, and classes, are kept here: mount a volume to keep them.
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME /app/data
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["tini", "--"]
CMD ["node", "server/index.ts"]

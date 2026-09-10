# =============================================================================
# FlowForge multi-stage build
#
#   target: api     -> NestJS application server            (apps/api, port 3000)
#   target: worker  -> outbox-relay + step-execution worker (apps/worker)
#   target: web     -> built React SPA served by vite preview
#
# Build order matters: @flowforge/shared is consumed via dist/ by every
# consumer (@flowforge/engine, @flowforge/api, @flowforge/worker).
# =============================================================================

FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /app
COPY . .
# Lockfile is committed, so builds are deterministic. corepack (enabled above)
# uses the pnpm version pinned in packageManager.
RUN pnpm install --frozen-lockfile

# -----------------------------------------------------------------------------
# API + worker must both consume a compiled @flowforge/shared.
# -----------------------------------------------------------------------------
FROM base AS build-api
RUN pnpm --filter @flowforge/shared build \
 && pnpm --filter @flowforge/engine build \
 && pnpm --filter @flowforge/api build

FROM base AS build-worker
RUN pnpm --filter @flowforge/shared build \
 && pnpm --filter @flowforge/engine build \
 && pnpm --filter @flowforge/worker build

FROM base AS build-web
ARG VITE_API_URL=http://localhost:3000
ENV VITE_API_URL=$VITE_API_URL
ARG VITE_DEMO_CREDENTIALS=false
ENV VITE_DEMO_CREDENTIALS=$VITE_DEMO_CREDENTIALS
RUN pnpm --filter @flowforge/web build

# -----------------------------------------------------------------------------
# API runtime
# -----------------------------------------------------------------------------
FROM node:20-alpine AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build-api /app/node_modules ./node_modules
COPY --from=build-api /app/packages/shared/package.json ./packages/shared/
COPY --from=build-api /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=build-api /app/packages/shared/dist ./packages/shared/dist
COPY --from=build-api /app/packages/engine/package.json ./packages/engine/
COPY --from=build-api /app/packages/engine/node_modules ./packages/engine/node_modules
COPY --from=build-api /app/packages/engine/dist ./packages/engine/dist
COPY --from=build-api /app/apps/api ./apps/api
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["node", "dist/main.js"]

# -----------------------------------------------------------------------------
# Worker runtime
# -----------------------------------------------------------------------------
FROM node:20-alpine AS worker
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build-worker /app/node_modules ./node_modules
COPY --from=build-worker /app/packages/shared/package.json ./packages/shared/
COPY --from=build-worker /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=build-worker /app/packages/shared/dist ./packages/shared/dist
COPY --from=build-worker /app/packages/engine/package.json ./packages/engine/
COPY --from=build-worker /app/packages/engine/node_modules ./packages/engine/node_modules
COPY --from=build-worker /app/packages/engine/dist ./packages/engine/dist
COPY --from=build-worker /app/apps/worker ./apps/worker
WORKDIR /app/apps/worker
CMD ["node", "dist/index.js"]

# -----------------------------------------------------------------------------
# Web runtime
# -----------------------------------------------------------------------------
FROM node:20-alpine AS web
ENV NODE_ENV=production
COPY --from=build-web /app/node_modules /app/node_modules
COPY --from=build-web /app/apps/web/package.json /app/apps/web/
COPY --from=build-web /app/apps/web/node_modules /app/apps/web/node_modules
COPY --from=build-web /app/apps/web /app/apps/web
WORKDIR /app/apps/web
EXPOSE 5173
CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "5173"]
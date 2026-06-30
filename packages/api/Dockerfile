# ============================================
# NovaCortex API - Multi-stage Dockerfile
# ============================================

FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat wget curl
WORKDIR /app

# ============================================
# Dependencies stage
# ============================================
FROM base AS deps

# Copy workspace root package files
COPY package.json package-lock.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/api/package.json ./packages/api/

# Install all workspace dependencies
RUN npm ci

# ============================================
# Development stage (hot-reload via tsx watch)
# ============================================
FROM deps AS development

COPY tsconfig.base.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/core/tsconfig.json ./packages/core/
COPY packages/core/src ./packages/core/src
COPY packages/api/package.json ./packages/api/
COPY packages/api/tsconfig.json ./packages/api/
COPY packages/api/src ./packages/api/src

# Build core so the API can import it at runtime
RUN npm run build --workspace=packages/core

ENV NODE_ENV=development
ENV PORT=3001

EXPOSE 3001 9229

CMD ["npm", "run", "dev", "--workspace=packages/api"]

# ============================================
# Builder stage
# ============================================
FROM base AS builder

WORKDIR /app

# Copy hoisted node_modules and package structure
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./

# Copy source code
COPY tsconfig.base.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/core/tsconfig.json ./packages/core/
COPY packages/core/src ./packages/core/src
COPY packages/api/package.json ./packages/api/
COPY packages/api/tsconfig.json ./packages/api/
COPY packages/api/src ./packages/api/src

# Build core first, then API
RUN npm run build --workspace=packages/core && \
    npm run build --workspace=packages/api

# ============================================
# Production stage
# ============================================
FROM node:20-alpine AS production

# Security: run as non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 novacortex

RUN apk add --no-cache wget curl dumb-init

WORKDIR /app
RUN chown novacortex:nodejs /app

# Copy workspace structure for module resolution
COPY --from=builder --chown=novacortex:nodejs /app/package.json ./
COPY --from=builder --chown=novacortex:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=novacortex:nodejs /app/packages/core/package.json ./packages/core/
COPY --from=builder --chown=novacortex:nodejs /app/packages/core/dist ./packages/core/dist
COPY --from=builder --chown=novacortex:nodejs /app/packages/api/package.json ./packages/api/
COPY --from=builder --chown=novacortex:nodejs /app/packages/api/dist ./packages/api/dist

ENV NODE_ENV=production
ENV PORT=3001
ENV NODE_OPTIONS="--max-old-space-size=2048"

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

USER novacortex

EXPOSE 3001

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "packages/api/dist/index.js"]

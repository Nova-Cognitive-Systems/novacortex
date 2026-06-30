# ============================================
# NovaCortex Web - Multi-stage Dockerfile
# Optimized for Next.js standalone output
# ============================================

FROM node:26-alpine AS base
RUN apk add --no-cache libc6-compat wget curl
WORKDIR /app

# ============================================
# Dependencies stage
# ============================================
FROM base AS deps

# Copy workspace root package files
COPY package.json package-lock.json ./
COPY packages/web/package.json ./packages/web/

# Install all workspace dependencies
RUN npm ci

# ============================================
# Development stage (hot-reload via next dev)
# ============================================
FROM deps AS development

COPY tsconfig.base.json ./
COPY packages/web ./packages/web

# Ensure node_modules are available within the web package for Next.js resolution
RUN cp -al /app/node_modules /app/packages/web/node_modules 2>/dev/null || \
    cp -r /app/node_modules /app/packages/web/node_modules

ENV NODE_ENV=development
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

EXPOSE 3000

CMD ["npm", "run", "dev", "--workspace=packages/web"]

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
COPY packages/web ./packages/web

# Build-time env vars
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL
ARG API_INTERNAL_URL=http://api:3001
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL}
ENV API_INTERNAL_URL=${API_INTERNAL_URL}
ENV NEXT_TELEMETRY_DISABLED=1

# Copy node_modules into web package for Turbopack resolution (no symlinks)
RUN cp -al /app/node_modules /app/packages/web/node_modules 2>/dev/null || \
    cp -r /app/node_modules /app/packages/web/node_modules
WORKDIR /app/packages/web
RUN npx next build

# ============================================
# Production stage
# ============================================
FROM node:26-alpine AS production

# Security: run as non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

RUN apk add --no-cache wget curl dumb-init

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV NEXT_TELEMETRY_DISABLED=1

# Copy standalone build (server.js lands at /app/server.js)
COPY --from=builder --chown=nextjs:nodejs /app/packages/web/.next/standalone ./
# Static files must be at .next/static relative to server.js
COPY --from=builder --chown=nextjs:nodejs /app/packages/web/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/packages/web/public ./public

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

USER nextjs

EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]

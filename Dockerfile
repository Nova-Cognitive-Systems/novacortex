FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages/core/package.json ./packages/core/
COPY packages/api/package.json ./packages/api/

RUN npm install

COPY tsconfig.base.json ./
COPY packages/core ./packages/core
COPY packages/api ./packages/api

RUN npm run build --workspace=packages/core && npm run build --workspace=packages/api

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/api/package.json ./packages/api/
COPY --from=builder /app/packages/api/dist ./packages/api/dist

EXPOSE 3001

CMD ["node", "packages/api/dist/index.js"]

FROM node:22-alpine AS base

# ── 의존성 설치 ──
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── 빌드 ──
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ── 런타임 ──
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN apk add --no-cache caddy

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY Caddyfile /etc/caddy/Caddyfile
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

RUN mkdir -p /data/caddy /config/caddy && \
    chown -R nextjs:nodejs /data/caddy /config/caddy

EXPOSE 80 443

CMD ["sh", "entrypoint.sh"]

# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# deps — dependencies only, so this layer is rebuilt only when a lockfile moves
# ---------------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app

# Prisma's query engine links against OpenSSL 3, which the alpine base does not
# carry. Without it the engine fails to load at runtime with an error that
# names no missing library.
RUN apk add --no-cache openssl

# `COPY package*.json prisma ./` — the obvious spelling — copies the *contents*
# of prisma/ into /app, so schema.prisma lands at /app/schema.prisma and
# `prisma generate` reports no schema found. Two COPYs, naming the destination
# directory explicitly.
COPY package.json package-lock.json ./
COPY prisma ./prisma

RUN npm ci && npx prisma generate

# ---------------------------------------------------------------------------
# builder — compiles the app against those dependencies
# ---------------------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Re-run generate: `COPY . .` above may have replaced prisma/ with the build
# context's copy, and the client must match the schema being shipped.
RUN npx prisma generate && npm run build

# ---------------------------------------------------------------------------
# migrator — the only stage with the Prisma CLI. Used by the `migrate` service
# in docker-compose to run `prisma migrate deploy` before the app rolls over.
# The runner below deliberately has no CLI and no migration privileges.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS migrator
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY package.json ./
CMD ["npx", "prisma", "migrate", "deploy"]

# ---------------------------------------------------------------------------
# runner — what actually ships
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache openssl

ENV NODE_ENV=production
# The standalone server binds 127.0.0.1 by default, which inside a container
# means nothing outside it can connect — including Caddy.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# A compromise in a Node process should not also be root in the container.
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs

# output: "standalone" emits a server.js plus only the traced dependencies.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Belt and braces: Next's file tracing usually picks the generated Prisma client
# up, but it misses the platform engine binary often enough that copying it
# explicitly is cheaper than debugging it on the box.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]

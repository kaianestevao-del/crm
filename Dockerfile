FROM node:20-bookworm-slim

# python3/make/g++ are needed to build native deps pulled in by Baileys
# (msgpackr-extract, protobufjs) during `pnpm install`. openssl is required by
# Prisma's query engine binary — Alpine/musl was tried first and hit missing
# libssl.so.1.1, so this uses a Debian base instead.
# postgresql-client provides pg_dump, used by the worker's daily database backup.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ openssl ca-certificates postgresql-client \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN corepack enable

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @crm/db prisma:generate
RUN pnpm -r build

ENV NODE_ENV=production
EXPOSE 4000

CMD ["sh", "scripts/start-combined.sh"]

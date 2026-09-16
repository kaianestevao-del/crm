FROM node:20-bookworm-slim

# python3/make/g++ are needed to build native deps pulled in by Baileys
# (msgpackr-extract, protobufjs) during `pnpm install`. openssl is required by
# Prisma's query engine binary — Alpine/musl was tried first and hit missing
# libssl.so.1.1, so this uses a Debian base instead.
# pg_dump is used by the worker's daily database backup. Debian bookworm's own
# postgresql-client package is stuck on PG 15, but pg_dump refuses to dump from a
# server whose major version is newer than itself — Railway's managed Postgres runs
# 18. The PGDG apt repo is added here so postgresql-client-18 (a matching pg_dump)
# can be installed instead.
# ffmpeg is used by the API to transcode recorded/uploaded audio to OGG/Opus — the WhatsApp
# Cloud API's audio message type rejects the webm the browser's MediaRecorder produces.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ openssl ca-certificates gnupg lsb-release wget ffmpeg \
  && wget --quiet -O /usr/share/keyrings/postgresql.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  && gpg --dearmor -o /usr/share/keyrings/postgresql.gpg /usr/share/keyrings/postgresql.asc \
  && echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update && apt-get install -y --no-install-recommends postgresql-client-18 \
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

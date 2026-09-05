# CRM WhatsApp

CRM multi-tenant (SaaS) para atendimento via WhatsApp, com funil de leads (Kanban), múltiplos atendentes e disparo em massa. A conexão com o WhatsApp usa [Baileys](https://github.com/WhiskeySockets/Baileys) (API não-oficial, via QR Code — como o WhatsApp Web).

## Arquitetura

Monorepo pnpm com 3 aplicações + 2 pacotes compartilhados:

- **apps/api** — API REST (Express + Prisma), autenticação JWT, multi-tenancy, realtime via Socket.IO.
- **apps/worker** — processo Node separado que mantém as conexões Baileys vivas (uma por número conectado), consome filas (BullMQ) para enviar mensagens e campanhas.
- **apps/web** — frontend (React + Vite + Tailwind): login, inbox, funil (Kanban), campanhas, conexão do WhatsApp (QR Code).
- **packages/db** — schema Prisma (fonte única da verdade do banco) + client compartilhado.
- **packages/shared** — tipos e enums compartilhados entre os 3 apps.

API e worker se comunicam por **Postgres** (dados) e **Redis** (filas BullMQ + pub/sub de eventos em tempo real, que a API repassa ao frontend via Socket.IO).

## Pré-requisitos

- Node.js 20+ e pnpm (já instalados nesta máquina via `nvm`)
- Docker (para rodar Postgres e Redis localmente) — **instale o Docker Desktop** antes do próximo passo
- Uma conexão de internet (o worker precisa acessar os servidores do WhatsApp)

## Setup local

```bash
# 1. instalar dependências
pnpm install

# 2. subir Postgres + Redis
pnpm docker:up

# 3. copiar os .env de exemplo
cp packages/db/.env.example packages/db/.env
cp apps/api/.env.example apps/api/.env
cp apps/worker/.env.example apps/worker/.env
cp apps/web/.env.example apps/web/.env
# edite apps/api/.env e troque JWT_SECRET por um valor aleatório longo

# 4. gerar o client do Prisma e criar as tabelas (cria o histórico de migrations)
pnpm db:generate
pnpm db:migrate

# 5. rodar cada app em um terminal separado
pnpm dev:api
pnpm dev:worker
pnpm dev:web
```

Acesse `http://localhost:5173`, crie uma conta (isso já cria sua organização e um funil padrão), vá em **Conexão WhatsApp**, clique em conectar um número e escaneie o QR Code com o WhatsApp do celular (Configurações → Aparelhos conectados).

## O que já funciona

- Cadastro/login com organização própria (multi-tenant, um JWT por organização)
- Conectar múltiplos números de WhatsApp por organização via QR Code
- Caixa de entrada: conversas em tempo real, envio/recebimento de mensagens de texto
- Funil de leads (Kanban) com drag-and-drop entre colunas
- Atribuição de conversas a atendentes (múltiplos usuários por organização)
- Campanhas de envio em massa com template (`{{name}}`) e atraso aleatório entre envios

## Avisos importantes

- **Baileys não é oficial.** A Meta pode banir números usados de forma muito agressiva (volume alto, muitos envios em pouco tempo). Use com moderação, principalmente em campanhas. Para uso comercial mais sério, considere migrar depois para a API oficial da Meta.
- O estado de autenticação de cada sessão do WhatsApp fica salvo em `apps/worker/sessions/<id>` — **não é git-tracked** (está no `.gitignore`). Faça backup dessa pasta em produção, ou você precisará escanear o QR Code de novo a cada deploy.
- Em produção, `apps/worker` deve rodar como processo persistente (ex: `pm2`) em uma VPS — não funciona bem em ambientes serverless, pois mantém sockets abertos o tempo todo.

## Testado neste ambiente

Rodei um teste end-to-end completo (Postgres + Redis temporários, sem Docker) durante o desenvolvimento: registro, login, criação de sessão, e o worker de fato conectou aos servidores do WhatsApp e gerou um QR Code real. O Docker não está instalado nesta máquina — instale-o para o fluxo de setup acima funcionar exatamente como descrito.

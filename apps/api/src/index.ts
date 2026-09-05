import "./env";
import { createServer } from "http";
import express from "express";
import cors from "cors";
import { env } from "./env";
import { errorHandler } from "./middleware/errorHandler";
import { setupRealtime } from "./realtime";
import { authRouter } from "./modules/auth/auth.routes";
import { whatsappSessionsRouter } from "./modules/whatsapp-sessions/whatsapp-sessions.routes";
import { conversationsRouter } from "./modules/conversations/conversations.routes";
import { pipelinesRouter } from "./modules/pipelines/pipelines.routes";
import { contactsRouter } from "./modules/contacts/contacts.routes";
import { campaignsRouter } from "./modules/campaigns/campaigns.routes";

const app = express();
app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRouter);
app.use("/whatsapp-sessions", whatsappSessionsRouter);
app.use("/conversations", conversationsRouter);
app.use("/pipelines", pipelinesRouter);
app.use("/contacts", contactsRouter);
app.use("/campaigns", campaignsRouter);

app.use(errorHandler);

const httpServer = createServer(app);
setupRealtime(httpServer);

httpServer.listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`);
});

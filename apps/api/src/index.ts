import "./env";
import path from "path";
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
import { quickRepliesRouter } from "./modules/quick-replies/quick-replies.routes";
import { notesRouter } from "./modules/notes/notes.routes";
import { tagsRouter } from "./modules/tags/tags.routes";
import { organizationsRouter } from "./modules/organizations/organizations.routes";
import { whatsappLabelsRouter } from "./modules/whatsapp-labels/whatsapp-labels.routes";
import { scheduledMessagesRouter } from "./modules/scheduled-messages/scheduled-messages.routes";
import { autoTagRulesRouter } from "./modules/auto-tag-rules/auto-tag-rules.routes";
import { teamRouter } from "./modules/team/team.routes";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes";
import { webhooksRouter } from "./modules/webhooks/webhooks.routes";
import { templatesRouter } from "./modules/templates/templates.routes";
import { campaignsRouter } from "./modules/campaigns/campaigns.routes";

const app = express();
app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(
  express.json({
    // Meta signs the exact bytes it sent (X-Hub-Signature-256) — keep the raw buffer around so
    // the webhook route can verify against it instead of a re-serialized (and possibly
    // byte-different) copy of the parsed body.
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);
app.use("/uploads", express.static(path.resolve(env.UPLOADS_DIR)));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/webhooks", webhooksRouter);

app.use("/auth", authRouter);
app.use("/whatsapp-sessions", whatsappSessionsRouter);
app.use("/conversations", conversationsRouter);
app.use("/pipelines", pipelinesRouter);
app.use("/contacts", contactsRouter);
app.use("/quick-replies", quickRepliesRouter);
app.use("/notes", notesRouter);
app.use("/tags", tagsRouter);
app.use("/organizations", organizationsRouter);
app.use("/whatsapp-labels", whatsappLabelsRouter);
app.use(scheduledMessagesRouter);
app.use("/auto-tag-rules", autoTagRulesRouter);
app.use("/team", teamRouter);
app.use("/dashboard", dashboardRouter);
app.use("/templates", templatesRouter);
app.use("/campaigns", campaignsRouter);

app.use(errorHandler);

const httpServer = createServer(app);
setupRealtime(httpServer);

httpServer.listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`);
});

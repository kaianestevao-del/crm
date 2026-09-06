import { Request, Response } from "express";
import crypto from "crypto";
import { prisma } from "../../prisma";
import { inboundCloudMessagesQueue } from "../../queues";

// Meta's subscription handshake: it calls this once when the webhook URL is saved in the
// App dashboard, and expects the raw `hub.challenge` value echoed back verbatim if (and only
// if) `hub.verify_token` matches what we generated for this session.
export async function verifyCloudWebhook(req: Request, res: Response) {
  const session = await prisma.whatsappSession.findFirst({
    where: { id: req.params.sessionId, provider: "CLOUD_API" },
  });
  if (!session) return res.sendStatus(404);

  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === session.cloudApiWebhookVerifyToken) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
}

// Meta signs every webhook POST with the App Secret — verifying this before touching the body
// is what stops anyone else from posting fake messages into a contact's history.
function isValidSignature(rawBody: Buffer, signatureHeader: string | undefined, appSecret: string): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const provided = signatureHeader.slice("sha256=".length);
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

// Must respond fast — Meta retries (and eventually gives up) if this hangs — so this only
// verifies the request and hands the raw payload to the worker's queue. The actual
// Contact/Conversation/Message writes happen there, same as everything from Baileys.
export async function receiveCloudWebhook(req: Request, res: Response) {
  const session = await prisma.whatsappSession.findFirst({
    where: { id: req.params.sessionId, provider: "CLOUD_API" },
  });
  if (!session?.cloudApiAppSecret) return res.sendStatus(404);

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody || !isValidSignature(rawBody, req.header("X-Hub-Signature-256"), session.cloudApiAppSecret)) {
    return res.sendStatus(401);
  }

  res.sendStatus(200);

  const entries = (req.body?.entry ?? []) as { changes?: { value?: unknown }[] }[];
  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      if (!change.value) continue;
      await inboundCloudMessagesQueue
        .add("process", { sessionId: session.id, organizationId: session.organizationId, payload: change.value })
        .catch((err) => console.error("enqueue_inbound_cloud_message_failed", err));
    }
  }
}

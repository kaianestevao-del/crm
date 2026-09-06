import crypto from "crypto";
import { Request, Response } from "express";
import { z } from "zod";
import { WHATSAPP_PROVIDERS } from "@crm/shared";
import { prisma } from "../../prisma";
import { env } from "../../env";
import { HttpError } from "../../utils/httpError";
import { sessionCommandsQueue } from "../../queues";

const createSchema = z.object({
  name: z.string().min(2),
  provider: z.enum(WHATSAPP_PROVIDERS).default("BAILEYS"),
  // When set, the worker requests a WhatsApp pairing code for this number instead of showing a
  // scannable QR code — for a team member linking their own number remotely. BAILEYS only.
  pairingPhoneNumber: z.string().min(8).optional(),
  // CLOUD_API only — credentials the org already has from their own Meta for Developers app.
  cloudApiPhoneNumberId: z.string().min(1).optional(),
  cloudApiAccessToken: z.string().min(1).optional(),
  cloudApiAppSecret: z.string().min(1).optional(),
});

// Cloud API sessions never go through the QR/pairing handshake that fills in phoneNumber for
// Baileys sessions — the Phone Number ID the org pastes in is Meta's internal id, not the
// actual WhatsApp number. Fetching it from the Graph API is what lets us build wa.me links.
async function fetchCloudApiPhoneNumber(phoneNumberId: string, accessToken: string): Promise<string | null> {
  const res = await fetch(
    `https://graph.facebook.com/v21.0/${phoneNumberId}?fields=display_phone_number`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { display_phone_number?: string };
  return data.display_phone_number ? data.display_phone_number.replace(/\D/g, "") : null;
}

function toSessionResponse(session: { cloudApiAccessToken: string | null; cloudApiAppSecret: string | null; [key: string]: unknown }) {
  const { cloudApiAccessToken, cloudApiAppSecret, ...rest } = session;
  return {
    ...rest,
    hasCloudApiAccessToken: !!cloudApiAccessToken,
    hasCloudApiAppSecret: !!cloudApiAppSecret,
  };
}

export async function listSessions(req: Request, res: Response) {
  const sessions = await prisma.whatsappSession.findMany({
    where: { organizationId: req.auth!.organizationId, archivedAt: null },
    orderBy: { createdAt: "asc" },
  });
  res.json(sessions.map(toSessionResponse));
}

export async function createSession(req: Request, res: Response) {
  const organizationId = req.auth!.organizationId;
  const input = createSchema.parse(req.body);

  // Default product rule: one active WhatsApp connection per organization. An org that
  // genuinely needs more can still be special-cased later, but nothing today asks for it.
  const existing = await prisma.whatsappSession.findFirst({ where: { organizationId, archivedAt: null } });
  if (existing) throw new HttpError(409, "organization_already_has_a_connection");

  if (input.provider === "CLOUD_API") {
    if (!input.cloudApiPhoneNumberId || !input.cloudApiAccessToken || !input.cloudApiAppSecret) {
      throw new HttpError(400, "cloud_api_credentials_required");
    }
    const phoneNumber = await fetchCloudApiPhoneNumber(input.cloudApiPhoneNumberId, input.cloudApiAccessToken).catch(
      () => null,
    );
    const session = await prisma.whatsappSession.create({
      data: {
        organizationId,
        name: input.name,
        provider: "CLOUD_API",
        // No pairing handshake for the Cloud API — valid credentials mean it's connected the
        // moment it's saved; the real test is Meta successfully calling the webhook.
        status: "CONNECTED",
        phoneNumber,
        cloudApiPhoneNumberId: input.cloudApiPhoneNumberId,
        cloudApiAccessToken: input.cloudApiAccessToken,
        cloudApiAppSecret: input.cloudApiAppSecret,
        cloudApiWebhookVerifyToken: crypto.randomBytes(24).toString("hex"),
      },
    });
    return res.status(201).json({
      ...toSessionResponse(session),
      webhookUrl: `${env.PUBLIC_URL}/webhooks/whatsapp-cloud/${session.id}`,
      webhookVerifyToken: session.cloudApiWebhookVerifyToken,
    });
  }

  const pairingPhoneNumber = input.pairingPhoneNumber?.replace(/\D/g, "");
  const session = await prisma.whatsappSession.create({
    data: { organizationId, name: input.name },
  });
  await sessionCommandsQueue.add("start", { sessionId: session.id, command: "START", pairingPhoneNumber });
  res.status(201).json(toSessionResponse(session));
}

async function getOwnedSession(organizationId: string, sessionId: string) {
  const session = await prisma.whatsappSession.findFirst({ where: { id: sessionId, organizationId, archivedAt: null } });
  if (!session) throw new HttpError(404, "session_not_found");
  return session;
}

export async function getSession(req: Request, res: Response) {
  const session = await getOwnedSession(req.auth!.organizationId, req.params.id);
  res.json(toSessionResponse(session));
}

// Cloud API sessions have no live socket to restart/log out — there's nothing running in the
// worker for them to act on, so these become direct status updates instead of queue commands.
export async function restartSession(req: Request, res: Response) {
  const session = await getOwnedSession(req.auth!.organizationId, req.params.id);
  if (session.provider === "CLOUD_API") return res.json({ ok: true });
  await sessionCommandsQueue.add("restart", { sessionId: session.id, command: "RESTART" });
  res.json({ ok: true });
}

export async function logoutSession(req: Request, res: Response) {
  const session = await getOwnedSession(req.auth!.organizationId, req.params.id);
  if (session.provider === "CLOUD_API") {
    await prisma.whatsappSession.update({ where: { id: session.id }, data: { status: "LOGGED_OUT" } });
    return res.json({ ok: true });
  }
  await sessionCommandsQueue.add("logout", { sessionId: session.id, command: "LOGOUT" });
  res.json({ ok: true });
}

// Backfills phoneNumber for a Cloud API session created before we started fetching it at
// creation time — also useful if the number ever changes on Meta's side.
export async function refreshCloudApiPhoneNumber(req: Request, res: Response) {
  const session = await getOwnedSession(req.auth!.organizationId, req.params.id);
  if (session.provider !== "CLOUD_API") throw new HttpError(400, "not_supported_for_baileys");
  if (!session.cloudApiPhoneNumberId || !session.cloudApiAccessToken) {
    throw new HttpError(400, "cloud_api_credentials_missing");
  }
  const phoneNumber = await fetchCloudApiPhoneNumber(session.cloudApiPhoneNumberId, session.cloudApiAccessToken);
  if (!phoneNumber) throw new HttpError(502, "meta_phone_number_lookup_failed");
  const updated = await prisma.whatsappSession.update({ where: { id: session.id }, data: { phoneNumber } });
  res.json(toSessionResponse(updated));
}

export async function resyncLabels(req: Request, res: Response) {
  const session = await getOwnedSession(req.auth!.organizationId, req.params.id);
  if (session.provider === "CLOUD_API") throw new HttpError(400, "not_supported_for_cloud_api");
  await sessionCommandsQueue.add("resync-labels", { sessionId: session.id, command: "RESYNC_LABELS" });
  res.json({ ok: true });
}

// Soft-delete only — the underlying Conversations/Messages that went through this number are
// never touched, so a patient's history stays intact even after the connection linking it is
// removed. Logs the device out first so it stops appearing in the phone's own linked-devices
// list too.
export async function deleteSession(req: Request, res: Response) {
  const session = await getOwnedSession(req.auth!.organizationId, req.params.id);
  if (session.provider !== "CLOUD_API") {
    await sessionCommandsQueue.add("logout", { sessionId: session.id, command: "LOGOUT" });
  }
  await prisma.whatsappSession.update({ where: { id: session.id }, data: { archivedAt: new Date() } });
  res.json({ ok: true });
}

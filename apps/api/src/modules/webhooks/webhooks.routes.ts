import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { verifyCloudWebhook, receiveCloudWebhook } from "./webhooks.controller";

// No requireAuth here on purpose — Meta calls these directly, authenticated only by the
// verify token (GET) / HMAC signature (POST), never by a session JWT.
export const webhooksRouter = Router();

webhooksRouter.get("/whatsapp-cloud/:sessionId", asyncHandler(verifyCloudWebhook));
webhooksRouter.post("/whatsapp-cloud/:sessionId", asyncHandler(receiveCloudWebhook));

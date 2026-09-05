import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { listScheduledMessages, createScheduledMessage, cancelScheduledMessage } from "./scheduled-messages.controller";

export const scheduledMessagesRouter = Router();
scheduledMessagesRouter.use(requireAuth);

scheduledMessagesRouter.get("/conversations/:id/scheduled-messages", asyncHandler(listScheduledMessages));
scheduledMessagesRouter.post("/conversations/:id/scheduled-messages", asyncHandler(createScheduledMessage));
scheduledMessagesRouter.delete("/scheduled-messages/:id", asyncHandler(cancelScheduledMessage));

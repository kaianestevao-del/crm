import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { requireModule } from "../../middleware/requireModule";
import { listScheduledMessages, createScheduledMessage, cancelScheduledMessage } from "./scheduled-messages.controller";

export const scheduledMessagesRouter = Router();
scheduledMessagesRouter.use(requireAuth);
scheduledMessagesRouter.use(asyncHandler(requireModule("inbox")));

scheduledMessagesRouter.get("/conversations/:id/scheduled-messages", asyncHandler(listScheduledMessages));
scheduledMessagesRouter.post("/conversations/:id/scheduled-messages", asyncHandler(createScheduledMessage));
scheduledMessagesRouter.delete("/scheduled-messages/:id", asyncHandler(cancelScheduledMessage));

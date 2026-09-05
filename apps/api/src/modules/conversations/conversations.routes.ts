import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { uploadMessageAttachment } from "../../upload";
import {
  listConversations,
  listMessages,
  sendMessage,
  sendAttachment,
  markAsRead,
  assignConversation,
  exportConversation,
} from "./conversations.controller";

export const conversationsRouter = Router();
conversationsRouter.use(requireAuth);

conversationsRouter.get("/", asyncHandler(listConversations));
conversationsRouter.get("/:id/messages", asyncHandler(listMessages));
conversationsRouter.post("/:id/messages", asyncHandler(sendMessage));
conversationsRouter.post("/:id/attachments", uploadMessageAttachment.single("file"), asyncHandler(sendAttachment));
conversationsRouter.post("/:id/read", asyncHandler(markAsRead));
conversationsRouter.post("/:id/assign", asyncHandler(assignConversation));
conversationsRouter.get("/:id/export", asyncHandler(exportConversation));

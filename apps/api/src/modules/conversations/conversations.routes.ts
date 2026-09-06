import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { requireModule } from "../../middleware/requireModule";
import { uploadMessageAttachment } from "../../upload";
import {
  listConversations,
  listMessages,
  sendMessage,
  sendAttachment,
  markAsRead,
  markAsUnread,
  closeConversation,
  assignConversation,
  exportConversation,
  startConversation,
} from "./conversations.controller";

export const conversationsRouter = Router();
conversationsRouter.use(requireAuth);
conversationsRouter.use(asyncHandler(requireModule("inbox")));

conversationsRouter.get("/", asyncHandler(listConversations));
conversationsRouter.post("/start", asyncHandler(startConversation));
conversationsRouter.get("/:id/messages", asyncHandler(listMessages));
conversationsRouter.post("/:id/messages", asyncHandler(sendMessage));
conversationsRouter.post("/:id/attachments", uploadMessageAttachment.single("file"), asyncHandler(sendAttachment));
conversationsRouter.post("/:id/read", asyncHandler(markAsRead));
conversationsRouter.post("/:id/unread", asyncHandler(markAsUnread));
conversationsRouter.delete("/:id", asyncHandler(closeConversation));
conversationsRouter.post("/:id/assign", asyncHandler(assignConversation));
conversationsRouter.get("/:id/export", asyncHandler(exportConversation));

import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { listConversations, listMessages, sendMessage, markAsRead, assignConversation } from "./conversations.controller";

export const conversationsRouter = Router();
conversationsRouter.use(requireAuth);

conversationsRouter.get("/", asyncHandler(listConversations));
conversationsRouter.get("/:id/messages", asyncHandler(listMessages));
conversationsRouter.post("/:id/messages", asyncHandler(sendMessage));
conversationsRouter.post("/:id/read", asyncHandler(markAsRead));
conversationsRouter.post("/:id/assign", asyncHandler(assignConversation));

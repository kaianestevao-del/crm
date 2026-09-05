import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { uploadQuickReplyMedia } from "../../upload";
import {
  listQuickReplyCategories,
  createQuickReplyCategory,
  deleteQuickReplyCategory,
  listQuickReplies,
  createQuickReply,
  updateQuickReply,
  deleteQuickReply,
} from "./quick-replies.controller";

export const quickRepliesRouter = Router();
quickRepliesRouter.use(requireAuth);

quickRepliesRouter.get("/", asyncHandler(listQuickReplies));
quickRepliesRouter.post("/", uploadQuickReplyMedia.single("file"), asyncHandler(createQuickReply));
quickRepliesRouter.patch("/:id", uploadQuickReplyMedia.single("file"), asyncHandler(updateQuickReply));
quickRepliesRouter.delete("/:id", asyncHandler(deleteQuickReply));

quickRepliesRouter.get("/categories", asyncHandler(listQuickReplyCategories));
quickRepliesRouter.post("/categories", asyncHandler(createQuickReplyCategory));
quickRepliesRouter.delete("/categories/:id", asyncHandler(deleteQuickReplyCategory));

import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { listQuickReplyCategories, listQuickReplies } from "./quick-replies.controller";

export const quickRepliesRouter = Router();
quickRepliesRouter.use(requireAuth);

quickRepliesRouter.get("/", asyncHandler(listQuickReplies));
quickRepliesRouter.get("/categories", asyncHandler(listQuickReplyCategories));

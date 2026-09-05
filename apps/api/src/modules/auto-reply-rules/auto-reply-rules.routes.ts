import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { listAutoReplyRules, createAutoReplyRule, updateAutoReplyRule, deleteAutoReplyRule } from "./auto-reply-rules.controller";

export const autoReplyRulesRouter = Router();
autoReplyRulesRouter.use(requireAuth);

autoReplyRulesRouter.get("/", asyncHandler(listAutoReplyRules));
autoReplyRulesRouter.post("/", asyncHandler(createAutoReplyRule));
autoReplyRulesRouter.patch("/:id", asyncHandler(updateAutoReplyRule));
autoReplyRulesRouter.delete("/:id", asyncHandler(deleteAutoReplyRule));

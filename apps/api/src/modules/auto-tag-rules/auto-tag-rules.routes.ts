import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { requireModule } from "../../middleware/requireModule";
import { listAutoTagRules, createAutoTagRule, updateAutoTagRule, deleteAutoTagRule } from "./auto-tag-rules.controller";

export const autoTagRulesRouter = Router();
autoTagRulesRouter.use(requireAuth);
autoTagRulesRouter.use(asyncHandler(requireModule("autoatendimento")));

autoTagRulesRouter.get("/", asyncHandler(listAutoTagRules));
autoTagRulesRouter.post("/", asyncHandler(createAutoTagRule));
autoTagRulesRouter.patch("/:id", asyncHandler(updateAutoTagRule));
autoTagRulesRouter.delete("/:id", asyncHandler(deleteAutoTagRule));

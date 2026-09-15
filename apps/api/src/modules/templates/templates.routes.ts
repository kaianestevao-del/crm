import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { listTemplates, createTemplate, updateTemplate, submitTemplate, syncTemplateStatus, deleteTemplate } from "./templates.controller";

export const templatesRouter = Router();
templatesRouter.use(requireAuth);

templatesRouter.get("/", asyncHandler(listTemplates));
templatesRouter.post("/", asyncHandler(createTemplate));
templatesRouter.patch("/:id", asyncHandler(updateTemplate));
templatesRouter.post("/:id/submit", asyncHandler(submitTemplate));
templatesRouter.post("/:id/sync-status", asyncHandler(syncTemplateStatus));
templatesRouter.delete("/:id", asyncHandler(deleteTemplate));

import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import {
  getAiSettings,
  updateAiSettings,
  createAiPlan,
  updateAiPlan,
  deleteAiPlan,
  simulateAiReply,
} from "./ai-assistant.controller";

export const aiAssistantRouter = Router();
aiAssistantRouter.use(requireAuth);

aiAssistantRouter.get("/", asyncHandler(getAiSettings));
aiAssistantRouter.patch("/", asyncHandler(updateAiSettings));
aiAssistantRouter.post("/plans", asyncHandler(createAiPlan));
aiAssistantRouter.patch("/plans/:id", asyncHandler(updateAiPlan));
aiAssistantRouter.delete("/plans/:id", asyncHandler(deleteAiPlan));
aiAssistantRouter.post("/simulate", asyncHandler(simulateAiReply));

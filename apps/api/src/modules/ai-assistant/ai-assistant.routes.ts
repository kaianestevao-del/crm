import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import {
  getAiSettings,
  updateAiSettings,
  createAiPlan,
  updateAiPlan,
  deleteAiPlan,
  createAiLink,
  updateAiLink,
  deleteAiLink,
  createAiKeyword,
  updateAiKeyword,
  deleteAiKeyword,
  simulateAiReply,
} from "./ai-assistant.controller";

export const aiAssistantRouter = Router();
aiAssistantRouter.use(requireAuth);

aiAssistantRouter.get("/", asyncHandler(getAiSettings));
aiAssistantRouter.patch("/", asyncHandler(updateAiSettings));
aiAssistantRouter.post("/plans", asyncHandler(createAiPlan));
aiAssistantRouter.patch("/plans/:id", asyncHandler(updateAiPlan));
aiAssistantRouter.delete("/plans/:id", asyncHandler(deleteAiPlan));
aiAssistantRouter.post("/links", asyncHandler(createAiLink));
aiAssistantRouter.patch("/links/:id", asyncHandler(updateAiLink));
aiAssistantRouter.delete("/links/:id", asyncHandler(deleteAiLink));
aiAssistantRouter.post("/keywords", asyncHandler(createAiKeyword));
aiAssistantRouter.patch("/keywords/:id", asyncHandler(updateAiKeyword));
aiAssistantRouter.delete("/keywords/:id", asyncHandler(deleteAiKeyword));
aiAssistantRouter.post("/simulate", asyncHandler(simulateAiReply));

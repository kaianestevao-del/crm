import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { listWhatsappLabels, createWhatsappLabel } from "./whatsapp-labels.controller";

export const whatsappLabelsRouter = Router();
whatsappLabelsRouter.use(requireAuth);

whatsappLabelsRouter.get("/", asyncHandler(listWhatsappLabels));
whatsappLabelsRouter.post("/", asyncHandler(createWhatsappLabel));

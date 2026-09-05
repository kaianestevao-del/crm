import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { listCampaigns, createCampaign, startCampaign, getCampaign } from "./campaigns.controller";

export const campaignsRouter = Router();
campaignsRouter.use(requireAuth);

campaignsRouter.get("/", asyncHandler(listCampaigns));
campaignsRouter.post("/", asyncHandler(createCampaign));
campaignsRouter.get("/:id", asyncHandler(getCampaign));
campaignsRouter.post("/:id/start", asyncHandler(startCampaign));

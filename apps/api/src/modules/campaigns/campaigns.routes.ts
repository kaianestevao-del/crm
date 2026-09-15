import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { uploadSpreadsheet } from "../../upload";
import {
  listCampaigns,
  createCampaign,
  updateCampaign,
  getCampaign,
  sendCampaign,
  cancelScheduledCampaign,
  deleteCampaign,
  importLeadsSpreadsheet,
} from "./campaigns.controller";

export const campaignsRouter = Router();
campaignsRouter.use(requireAuth);

campaignsRouter.get("/", asyncHandler(listCampaigns));
campaignsRouter.post("/", asyncHandler(createCampaign));
campaignsRouter.post("/import-leads", uploadSpreadsheet.single("file"), asyncHandler(importLeadsSpreadsheet));
campaignsRouter.get("/:id", asyncHandler(getCampaign));
campaignsRouter.patch("/:id", asyncHandler(updateCampaign));
campaignsRouter.post("/:id/send", asyncHandler(sendCampaign));
campaignsRouter.post("/:id/cancel-schedule", asyncHandler(cancelScheduledCampaign));
campaignsRouter.delete("/:id", asyncHandler(deleteCampaign));

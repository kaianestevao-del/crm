import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { uploadFlowMedia as uploadFlowMediaFile } from "../../upload";
import { listFlows, getFlowOptions, getFlow, getFlowStats, createFlow, updateFlow, deleteFlow, uploadFlowMedia } from "./flows.controller";

export const flowsRouter = Router();
flowsRouter.use(requireAuth);

flowsRouter.get("/", asyncHandler(listFlows));
flowsRouter.get("/options", asyncHandler(getFlowOptions));
flowsRouter.post("/", asyncHandler(createFlow));
flowsRouter.post("/media", uploadFlowMediaFile.single("file"), asyncHandler(uploadFlowMedia));
flowsRouter.get("/:id", asyncHandler(getFlow));
flowsRouter.get("/:id/stats", asyncHandler(getFlowStats));
flowsRouter.patch("/:id", asyncHandler(updateFlow));
flowsRouter.delete("/:id", asyncHandler(deleteFlow));

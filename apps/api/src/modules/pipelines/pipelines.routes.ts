import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { listPipelines, createDeal, moveDeal, deleteDeal, exportDeals } from "./pipelines.controller";

export const pipelinesRouter = Router();
pipelinesRouter.use(requireAuth);

pipelinesRouter.get("/", asyncHandler(listPipelines));
pipelinesRouter.get("/deals/export", asyncHandler(exportDeals));
pipelinesRouter.post("/deals", asyncHandler(createDeal));
pipelinesRouter.patch("/deals/:id/move", asyncHandler(moveDeal));
pipelinesRouter.delete("/deals/:id", asyncHandler(deleteDeal));

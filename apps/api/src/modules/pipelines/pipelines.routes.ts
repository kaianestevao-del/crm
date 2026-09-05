import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { listPipelines, createDeal, moveDeal, deleteDeal } from "./pipelines.controller";

export const pipelinesRouter = Router();
pipelinesRouter.use(requireAuth);

pipelinesRouter.get("/", asyncHandler(listPipelines));
pipelinesRouter.post("/deals", asyncHandler(createDeal));
pipelinesRouter.patch("/deals/:id/move", asyncHandler(moveDeal));
pipelinesRouter.delete("/deals/:id", asyncHandler(deleteDeal));

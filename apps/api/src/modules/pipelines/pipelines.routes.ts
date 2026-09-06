import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { requireModule } from "../../middleware/requireModule";
import {
  listPipelines,
  createDeal,
  moveDeal,
  deleteDeal,
  exportDeals,
  getContactDealStage,
  setContactDealStage,
} from "./pipelines.controller";

export const pipelinesRouter = Router();
pipelinesRouter.use(requireAuth);
pipelinesRouter.use(asyncHandler(requireModule("kanban")));

pipelinesRouter.get("/", asyncHandler(listPipelines));
pipelinesRouter.get("/deals/export", asyncHandler(exportDeals));
pipelinesRouter.post("/deals", asyncHandler(createDeal));
pipelinesRouter.patch("/deals/:id/move", asyncHandler(moveDeal));
pipelinesRouter.delete("/deals/:id", asyncHandler(deleteDeal));
pipelinesRouter.get("/contacts/:contactId/deal", asyncHandler(getContactDealStage));
pipelinesRouter.put("/contacts/:contactId/deal-stage", asyncHandler(setContactDealStage));

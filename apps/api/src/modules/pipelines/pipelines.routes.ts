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
  getContactDeal,
  setContactDealStage,
  addDealPayment,
  deleteDealPayment,
  updatePipelineStageRole,
  markFollowUpContact,
  unmarkFollowUpContact,
} from "./pipelines.controller";

export const pipelinesRouter = Router();
pipelinesRouter.use(requireAuth);
pipelinesRouter.use(asyncHandler(requireModule("kanban")));

pipelinesRouter.get("/", asyncHandler(listPipelines));
pipelinesRouter.get("/deals/export", asyncHandler(exportDeals));
pipelinesRouter.post("/deals", asyncHandler(createDeal));
pipelinesRouter.patch("/deals/:id/move", asyncHandler(moveDeal));
pipelinesRouter.delete("/deals/:id", asyncHandler(deleteDeal));
pipelinesRouter.get("/contacts/:contactId/deal", asyncHandler(getContactDeal));
pipelinesRouter.put("/contacts/:contactId/deal-stage", asyncHandler(setContactDealStage));
pipelinesRouter.post("/contacts/:contactId/deal-payments", asyncHandler(addDealPayment));
pipelinesRouter.delete("/deals/payments/:paymentId", asyncHandler(deleteDealPayment));
pipelinesRouter.patch("/stages/:id", asyncHandler(updatePipelineStageRole));
pipelinesRouter.put("/stage-history/:stageHistoryId/follow-up-contacts/:index", asyncHandler(markFollowUpContact));
pipelinesRouter.delete("/stage-history/:stageHistoryId/follow-up-contacts/:index", asyncHandler(unmarkFollowUpContact));

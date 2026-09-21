import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { requireModule } from "../../middleware/requireModule";
import { getDashboardSummary, getChannelLeads, getPatientsByRole } from "./dashboard.controller";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);
dashboardRouter.use(asyncHandler(requireModule("dashboard")));

dashboardRouter.get("/summary", asyncHandler(getDashboardSummary));
dashboardRouter.get("/channel-leads", asyncHandler(getChannelLeads));
dashboardRouter.get("/patients", asyncHandler(getPatientsByRole));

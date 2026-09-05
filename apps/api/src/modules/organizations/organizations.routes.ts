import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { getMyOrganization, updateMyOrganization } from "./organizations.controller";

export const organizationsRouter = Router();
organizationsRouter.use(requireAuth);

organizationsRouter.get("/me", asyncHandler(getMyOrganization));
organizationsRouter.patch("/me", asyncHandler(updateMyOrganization));

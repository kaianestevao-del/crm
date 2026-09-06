import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { listTeam, inviteTeamMember, updateTeamMemberRole, removeTeamMember } from "./team.controller";

export const teamRouter = Router();
teamRouter.use(requireAuth);

teamRouter.get("/", asyncHandler(listTeam));
teamRouter.post("/", asyncHandler(inviteTeamMember));
teamRouter.patch("/:id", asyncHandler(updateTeamMemberRole));
teamRouter.delete("/:id", asyncHandler(removeTeamMember));

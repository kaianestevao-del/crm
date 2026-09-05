import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { listSessions, createSession, getSession, restartSession, logoutSession } from "./whatsapp-sessions.controller";

export const whatsappSessionsRouter = Router();
whatsappSessionsRouter.use(requireAuth);

whatsappSessionsRouter.get("/", asyncHandler(listSessions));
whatsappSessionsRouter.post("/", asyncHandler(createSession));
whatsappSessionsRouter.get("/:id", asyncHandler(getSession));
whatsappSessionsRouter.post("/:id/restart", asyncHandler(restartSession));
whatsappSessionsRouter.post("/:id/logout", asyncHandler(logoutSession));

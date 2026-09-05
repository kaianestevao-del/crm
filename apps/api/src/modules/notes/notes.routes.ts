import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { updateNote, deleteNote } from "./notes.controller";

export const notesRouter = Router();
notesRouter.use(requireAuth);

notesRouter.patch("/:id", asyncHandler(updateNote));
notesRouter.delete("/:id", asyncHandler(deleteNote));

import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { listTags, createTag, deleteTag } from "./tags.controller";

export const tagsRouter = Router();
tagsRouter.use(requireAuth);

tagsRouter.get("/", asyncHandler(listTags));
tagsRouter.post("/", asyncHandler(createTag));
tagsRouter.delete("/:id", asyncHandler(deleteTag));

import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { listContacts, createContact, listContactNotes } from "./contacts.controller";

export const contactsRouter = Router();
contactsRouter.use(requireAuth);

contactsRouter.get("/", asyncHandler(listContacts));
contactsRouter.post("/", asyncHandler(createContact));
contactsRouter.get("/:id/notes", asyncHandler(listContactNotes));

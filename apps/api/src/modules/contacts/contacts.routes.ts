import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import {
  listContacts,
  createContact,
  listContactNotes,
  createContactNote,
  addContactTag,
  removeContactTag,
  addContactWhatsappLabel,
  removeContactWhatsappLabel,
} from "./contacts.controller";

export const contactsRouter = Router();
contactsRouter.use(requireAuth);

contactsRouter.get("/", asyncHandler(listContacts));
contactsRouter.post("/", asyncHandler(createContact));
contactsRouter.get("/:id/notes", asyncHandler(listContactNotes));
contactsRouter.post("/:id/notes", asyncHandler(createContactNote));
contactsRouter.post("/:id/tags", asyncHandler(addContactTag));
contactsRouter.delete("/:id/tags/:tagId", asyncHandler(removeContactTag));
contactsRouter.post("/:id/whatsapp-labels", asyncHandler(addContactWhatsappLabel));
contactsRouter.delete("/:id/whatsapp-labels/:labelId", asyncHandler(removeContactWhatsappLabel));

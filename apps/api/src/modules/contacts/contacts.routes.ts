import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { uploadSpreadsheet } from "../../upload";
import {
  listContacts,
  createContact,
  updateContactName,
  updateContactObjective,
  listContactNotes,
  createContactNote,
  addContactTag,
  removeContactTag,
  exportContacts,
  importObjectiveSpreadsheet,
} from "./contacts.controller";

export const contactsRouter = Router();
contactsRouter.use(requireAuth);

contactsRouter.get("/", asyncHandler(listContacts));
contactsRouter.get("/export", asyncHandler(exportContacts));
contactsRouter.post("/import-objective", uploadSpreadsheet.single("file"), asyncHandler(importObjectiveSpreadsheet));
contactsRouter.post("/", asyncHandler(createContact));
contactsRouter.patch("/:id", asyncHandler(updateContactName));
contactsRouter.patch("/:id/objective", asyncHandler(updateContactObjective));
contactsRouter.get("/:id/notes", asyncHandler(listContactNotes));
contactsRouter.post("/:id/notes", asyncHandler(createContactNote));
contactsRouter.post("/:id/tags", asyncHandler(addContactTag));
contactsRouter.delete("/:id/tags/:tagId", asyncHandler(removeContactTag));

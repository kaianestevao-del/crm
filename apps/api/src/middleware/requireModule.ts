import { Request, Response, NextFunction } from "express";
import { ModuleKey, Role } from "@crm/shared";
import { prisma } from "../prisma";
import { HttpError } from "../utils/httpError";

// OWNER/ADMIN always pass regardless of allowedModules — this only ever restricts AGENT
// accounts. Looked up fresh from the DB on every request (not baked into the JWT) so a change
// made in the Equipe page takes effect immediately, without waiting for the agent to log out.
export function requireModule(moduleKey: ModuleKey) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const auth = req.auth!;
    if (auth.role === Role.OWNER || auth.role === Role.ADMIN) return next();

    const membership = await prisma.membership.findUnique({
      where: { userId_organizationId: { userId: auth.sub, organizationId: auth.organizationId } },
    });
    if (!membership?.allowedModules.includes(moduleKey)) {
      throw new HttpError(403, "module_access_denied");
    }
    next();
  };
}

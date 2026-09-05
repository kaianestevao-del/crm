import { NextFunction, Request, Response } from "express";
import { JwtPayload } from "@crm/shared";
import { verifyJwt } from "../utils/jwt";
import { HttpError } from "../utils/httpError";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: JwtPayload;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new HttpError(401, "missing_authorization_header");
  }
  const token = header.slice("Bearer ".length);
  try {
    req.auth = verifyJwt(token);
    next();
  } catch {
    throw new HttpError(401, "invalid_token");
  }
}

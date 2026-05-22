import type { NextFunction, Request, Response } from "express";

import { readAuthCookie } from "../utils/authCookie";
import { AppError } from "../utils/appError";
import { verifyToken } from "../utils/jwt";

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.replace("Bearer ", "").trim()
    : undefined;
  const token = readAuthCookie(req) ?? bearerToken;

  if (!token) {
    return next(new AppError(401, "Authentication required"));
  }

  try {
    req.user = verifyToken(token);
    next();
  } catch {
    next(new AppError(401, "Invalid or expired token"));
  }
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.role !== "admin") {
    return next(new AppError(403, "Admin role required"));
  }

  next();
}

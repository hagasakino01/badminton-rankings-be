import type { Request } from "express";

import { AppError } from "./appError";

export function routeParam(req: Request, name: string) {
  const value = req.params[name];
  const normalized = Array.isArray(value) ? value[0] : value;
  if (!normalized) {
    throw new AppError(400, `Missing route parameter: ${name}`, "ROUTE_PARAMETER_MISSING");
  }
  return normalized;
}

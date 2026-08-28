import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { ZodError } from "zod";

import { AppError } from "../utils/appError";

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction) {
  next(new AppError(404, "Route not found"));
}

export function errorHandler(
  error: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      message: error.message,
      code: error.code,
      details: error.details,
    });
  }

  if (error instanceof ZodError) {
    return res.status(400).json({
      message: "Validation failed",
      code: "VALIDATION_ERROR",
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  if (error instanceof mongoose.Error.ValidationError) {
    return res.status(400).json({ message: error.message, code: "DATABASE_VALIDATION_ERROR" });
  }

  if (error instanceof mongoose.Error.CastError) {
    return res.status(400).json({ message: "Invalid identifier", code: "INVALID_IDENTIFIER" });
  }

  console.error(error);
  return res.status(500).json({ message: "Internal server error", code: "INTERNAL_ERROR" });
}

import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/errors";
import logger from "../utils/logger";
import { Prisma } from "@prisma/client";

export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  logger.error("Error:", err);

  // Prisma errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      res.status(409).json({
        success: false,
        error: "Resource already exists",
        message: "A unique constraint violation occurred",
      });
      return;
    }

    if (err.code === "P2025") {
      res.status(404).json({
        success: false,
        error: "Not found",
        message: "Resource not found",
      });
      return;
    }
  }

  // Body-parser errors (D-15).
  //
  // express.json() throws a SyntaxError with `status: 400` and
  // `type: "entity.parse.failed"` when a request body isn't valid JSON. That
  // error was falling all the way through to the generic 500 below, so **every
  // JSON endpoint in the API answered a malformed body with "Internal server
  // error"** — telling the caller the server broke when in fact their request
  // was bad. `API-TEST-PLAN.md` requires a clean 400 here as one of the five
  // minimum cases on all 93 endpoints, so this single branch is what makes that
  // case passable rather than 93 separate fixes.
  //
  // Also covers `entity.too.large` (413) from the 10mb limit, which had the
  // same problem.
  const bodyParserErr = err as Error & { status?: number; type?: string };
  if (
    typeof bodyParserErr.type === "string" &&
    bodyParserErr.type.startsWith("entity.")
  ) {
    const status =
      typeof bodyParserErr.status === "number" ? bodyParserErr.status : 400;
    res.status(status).json({
      success: false,
      error:
        bodyParserErr.type === "entity.too.large"
          ? "Request body too large"
          : "Malformed request body",
      message:
        bodyParserErr.type === "entity.too.large"
          ? "The request body exceeded the size limit."
          : "The request body could not be parsed as JSON.",
    });
    return;
  }

  // Application errors
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: err.message,
      ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
    });
    return;
  }

  // Validation errors
  if (err.name === "ValidationError") {
    res.status(400).json({
      success: false,
      error: "Validation error",
      message: err.message,
    });
    return;
  }

  // JWT errors
  if (err.name === "JsonWebTokenError") {
    res.status(401).json({
      success: false,
      error: "Invalid token",
    });
    return;
  }

  if (err.name === "TokenExpiredError") {
    res.status(401).json({
      success: false,
      error: "Token expired",
    });
    return;
  }

  // Default error
  res.status(500).json({
    success: false,
    error: "Internal server error",
    ...(process.env.NODE_ENV === "development" && {
      message: err.message,
      stack: err.stack,
    }),
  });
};

export const notFound = (req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    error: "Route not found",
    path: req.originalUrl,
  });
};

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public isOperational = true,
  ) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(400, message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(403, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(404, message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message);
  }
}

/**
 * 410 Gone — the route existed, still resolves, and has been permanently
 * retired. Distinct from 400 (your request was malformed) and 404 (no such
 * route), both of which mislead a caller here: the retired kiosk endpoints
 * previously returned 400, which reads as "you sent something wrong" when the
 * truth is "this capability no longer exists and there is a replacement".
 */
export class GoneError extends AppError {
  constructor(message: string) {
    super(410, message);
  }
}

export class InternalServerError extends AppError {
  constructor(message = "Internal server error") {
    super(500, message, false);
  }
}

import { Request, Response, NextFunction } from "express";
import { errorHandler } from "../errorHandler";
import { AppError, GoneError, ValidationError } from "../../utils/errors";

jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

/** Minimal Express res double that records what was sent. */
function mockRes() {
  const res: Partial<Response> & { statusCode?: number; body?: unknown } = {};
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res as Response;
  }) as unknown as Response["status"];
  res.json = jest.fn((payload: unknown) => {
    res.body = payload;
    return res as Response;
  }) as unknown as Response["json"];
  return res as Response & { statusCode: number; body: any };
}

/** A body-parser parse failure, shaped exactly as express.json() throws it. */
function bodyParserSyntaxError() {
  const e = new SyntaxError(
    "Unexpected token } in JSON at position 1",
  ) as SyntaxError & { status: number; type: string; body: string };
  e.status = 400;
  e.type = "entity.parse.failed";
  e.body = "{,}";
  return e;
}

describe("errorHandler — malformed request bodies (D-15)", () => {
  const req = {} as Request;
  const next = (() => undefined) as NextFunction;

  it("answers a malformed JSON body with 400, not 500", () => {
    const res = mockRes();
    errorHandler(bodyParserSyntaxError(), req, res, next);
    // Before the fix this fell through to the generic handler and every JSON
    // endpoint in the API returned "Internal server error" for a bad body.
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/malformed/i);
  });

  it("does not describe a client mistake as a server failure", () => {
    const res = mockRes();
    errorHandler(bodyParserSyntaxError(), req, res, next);
    expect(JSON.stringify(res.body)).not.toMatch(/internal server error/i);
  });

  it("answers an oversized body with 413", () => {
    const e = new Error("request entity too large") as Error & {
      status: number;
      type: string;
    };
    e.status = 413;
    e.type = "entity.too.large";
    const res = mockRes();
    errorHandler(e, req, res, next);
    expect(res.statusCode).toBe(413);
    expect(res.body.error).toMatch(/too large/i);
  });

  it("leaves a genuine SyntaxError from application code as a 500", () => {
    // No `type` property → not a body-parser error → must not be downgraded to
    // 400, or a real server bug would be reported as the caller's fault.
    const res = mockRes();
    errorHandler(new SyntaxError("bug in a controller"), req, res, next);
    expect(res.statusCode).toBe(500);
  });
});

describe("errorHandler — application errors still route correctly", () => {
  const req = {} as Request;
  const next = (() => undefined) as NextFunction;

  it("preserves an AppError's own status code", () => {
    const res = mockRes();
    errorHandler(new ValidationError("bad input"), req, res, next);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("bad input");
  });

  it("returns 410 for a retired endpoint", () => {
    const res = mockRes();
    errorHandler(new GoneError("this endpoint was retired"), req, res, next);
    expect(res.statusCode).toBe(410);
  });

  it("falls back to 500 for an unrecognised error", () => {
    const res = mockRes();
    errorHandler(new Error("something unexpected"), req, res, next);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe("Internal server error");
  });

  it("does not leak a stack trace outside development", () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const res = mockRes();
    errorHandler(new AppError(418, "teapot"), req, res, next);
    expect(res.body.stack).toBeUndefined();
    process.env.NODE_ENV = prev;
  });
});

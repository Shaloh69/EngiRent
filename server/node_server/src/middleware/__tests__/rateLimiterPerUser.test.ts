/**
 * Rate limit per user (2026-10-12). Found live: one phone looping on /auth/profile
 * used up the per-IP allowance and the admin console on the same IP got 429 on
 * everything. A request with a VERIFIED token now counts against its own user;
 * anything else still counts against the IP.
 */

// The limiter persists its counters to data/rate-limit-store.json. A test must
// never read or write that file: an earlier run left full buckets on disk and
// every later run started already over the limit (found 2026-10-13).
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  readFileSync: jest.fn(() => {
    throw new Error("no persisted store in tests");
  }),
  writeFileSync: jest.fn(),
  mkdirSync: jest.fn(),
}));
jest.mock("../../config/env", () => ({
  __esModule: true,
  default: { RATE_LIMIT_WINDOW_MS: "900000", RATE_LIMIT_MAX_REQUESTS: "3" },
}));
jest.mock("../../utils/jwt", () => ({
  // "token-<id>" verifies as user <id>; anything else is a bad token.
  verifyAccessToken: (token: string) => {
    if (token.startsWith("token-")) return { userId: token.slice(6) };
    throw new Error("invalid token");
  },
}));

import { rateLimiter } from "../rateLimiter";

type Res = { statusCode: number; body: unknown; status: (c: number) => Res; json: (b: unknown) => Res };
const mkRes = (): Res => {
  const r: Res = {
    statusCode: 200,
    body: null,
    status(c) {
      r.statusCode = c;
      return r;
    },
    json(b) {
      r.body = b;
      return r;
    },
  };
  return r;
};

/** Sends one request; returns the status (200 means it was let through). */
function hit(ip: string, token?: string): number {
  const res = mkRes();
  let passed = false;
  rateLimiter(
    {
      headers: { "cf-connecting-ip": ip, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ip: "127.0.0.1",
      method: "GET",
      originalUrl: "/api/v1/x",
    } as never,
    res as never,
    () => {
      passed = true;
    },
  );
  return passed ? 200 : res.statusCode;
}

describe("per-user rate limit", () => {
  it("a user who loops is refused, and another user on the SAME IP is not", () => {
    const ip = "198.51.100.10";
    expect([1, 2, 3].map(() => hit(ip, "token-phone-user"))).toEqual([200, 200, 200]);
    expect(hit(ip, "token-phone-user")).toBe(429); // the looping phone
    expect(hit(ip, "token-admin-user")).toBe(200); // the admin on the same network
    expect(hit(ip, "token-admin-user")).toBe(200);
  });

  it("anonymous requests are still counted by IP (login brute force stays limited)", () => {
    const ip = "198.51.100.20";
    expect([1, 2, 3].map(() => hit(ip))).toEqual([200, 200, 200]);
    expect(hit(ip)).toBe(429);
  });

  it("a forged or invalid token is just an anonymous request: it cannot pick a bucket", () => {
    const ip = "198.51.100.30";
    expect([1, 2, 3].map(() => hit(ip, "forged"))).toEqual([200, 200, 200]);
    expect(hit(ip, "forged")).toBe(429);
    // and it does not use up any real user's allowance
    expect(hit("198.51.100.31", "token-fresh-user")).toBe(200);
  });

  it("a user's allowance follows them across IPs, so rotating address does not reset it", () => {
    expect([1, 2, 3].map((i) => hit(`198.51.100.4${i}`, "token-roaming-user"))).toEqual([200, 200, 200]);
    expect(hit("198.51.100.49", "token-roaming-user")).toBe(429);
  });

  it("authenticated traffic from one IP has a backstop of 5x the limit across all users", () => {
    const ip = "198.51.100.50";
    // the per-user limit is 3, so use many distinct users: the IP ceiling is 15
    const statuses: number[] = [];
    for (let i = 0; i < 16; i++) statuses.push(hit(ip, `token-backstop-user-${i}`));
    expect(statuses.slice(0, 15).every((s) => s === 200)).toBe(true);
    expect(statuses[15]).toBe(429);
  });

  it("a refused request does not count against the other bucket", () => {
    const ip = "198.51.100.60";
    for (let i = 0; i < 3; i++) hit(ip, "token-capped-user");
    for (let i = 0; i < 20; i++) expect(hit(ip, "token-capped-user")).toBe(429); // refused, not counted by IP
    // 3 allowed above + 20 refused did not move the IP-wide ceiling (15): 12 more users still pass
    for (let i = 0; i < 12; i++) expect(hit(ip, `token-other-${i}`)).toBe(200);
  });
});

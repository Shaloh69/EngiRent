import { ConfigError, loadConfig, PAYMONGO_WALLET_BIC } from "../config";

const TOKEN = "t".repeat(32);
const base = { GATEWAY_TOKEN: TOKEN, ENDPOINT_GIST_URL: "https://gist.example/raw" };

describe("startup interlocks: a misconfigured gateway refuses to start", () => {
  it("sandbox with a test key starts", () => {
    const c = loadConfig({ ...base, PAYMENT_ENV: "sandbox", PAYMONGO_SECRET_KEY: "sk_test_abc" });
    expect(c.env).toBe("sandbox");
  });
  it("sandbox with a LIVE key refuses (no real money through the test gateway)", () => {
    expect(() => loadConfig({ ...base, PAYMENT_ENV: "sandbox", PAYMONGO_SECRET_KEY: "sk_live_abc" })).toThrow(ConfigError);
  });
  it("live with a TEST key refuses", () => {
    expect(() => loadConfig({ ...base, PAYMENT_ENV: "live", PAYMONGO_SECRET_KEY: "sk_test_abc", ALLOW_LIVE: "yes" })).toThrow(/LIVE secret key/);
  });
  it("live without ALLOW_LIVE=yes refuses, even with a live key", () => {
    expect(() => loadConfig({ ...base, PAYMENT_ENV: "live", PAYMONGO_SECRET_KEY: "sk_live_abc" })).toThrow(/ALLOW_LIVE/);
    expect(() => loadConfig({ ...base, PAYMENT_ENV: "live", PAYMONGO_SECRET_KEY: "sk_live_abc", ALLOW_LIVE: "true" })).toThrow(/ALLOW_LIVE/);
  });
  it("live with a live key and ALLOW_LIVE=yes starts", () => {
    expect(loadConfig({ ...base, PAYMENT_ENV: "live", PAYMONGO_SECRET_KEY: "sk_live_abc", ALLOW_LIVE: "yes" }).env).toBe("live");
  });
  it("no mode, or an unknown mode, refuses", () => {
    expect(() => loadConfig({ ...base, PAYMONGO_SECRET_KEY: "sk_test_abc" })).toThrow(/PAYMENT_ENV/);
    expect(() => loadConfig({ ...base, PAYMENT_ENV: "production", PAYMONGO_SECRET_KEY: "sk_live_abc" })).toThrow(/PAYMENT_ENV/);
  });
  it("a short or missing gateway token refuses", () => {
    expect(() => loadConfig({ ...base, GATEWAY_TOKEN: "short", PAYMENT_ENV: "sandbox", PAYMONGO_SECRET_KEY: "sk_test_abc" })).toThrow(/GATEWAY_TOKEN/);
    expect(() => loadConfig({ ENDPOINT_GIST_URL: "x", PAYMENT_ENV: "sandbox", PAYMONGO_SECRET_KEY: "sk_test_abc" })).toThrow(/GATEWAY_TOKEN/);
  });
  it("no way to reach the main API refuses", () => {
    expect(() => loadConfig({ GATEWAY_TOKEN: TOKEN, PAYMENT_ENV: "sandbox", PAYMONGO_SECRET_KEY: "sk_test_abc" })).toThrow(/ENDPOINT_GIST_URL/);
  });
  it("transfers are configured only with both wallet fields, always with PayMongo's BIC", () => {
    const e = { ...base, PAYMENT_ENV: "sandbox", PAYMONGO_SECRET_KEY: "sk_test_abc" };
    expect(loadConfig({ ...e, PAYMONGO_SOURCE_ACCOUNT_NUMBER: "123" }).sourceAccount).toBeNull();
    expect(loadConfig({ ...e, PAYMONGO_SOURCE_ACCOUNT_NUMBER: "123", PAYMONGO_SOURCE_ACCOUNT_NAME: "EngiRent" }).sourceAccount).toEqual({
      number: "123",
      name: "EngiRent",
      bic: PAYMONGO_WALLET_BIC,
    });
  });
});

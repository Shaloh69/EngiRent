import { hmacHex, signForward, verifyPaymongoSignature } from "../signature";

const SECRET = "whsk_test_secret";
const body = JSON.stringify({ data: { id: "evt_1", attributes: { type: "checkout_session.payment.paid" } } });
const t = "1700000000";
const sig = hmacHex(SECRET, `${t}.${body}`);

describe("PayMongo webhook signature", () => {
  it("sandbox accepts a valid te signature", () => {
    expect(verifyPaymongoSignature(body, `t=${t},te=${sig},li=`, SECRET, "sandbox")).toBe(true);
  });
  it("live accepts a valid li signature", () => {
    expect(verifyPaymongoSignature(body, `t=${t},te=,li=${sig}`, SECRET, "live")).toBe(true);
  });
  it("a test-mode signature is NOT accepted by the live gateway, nor a live one by sandbox", () => {
    expect(verifyPaymongoSignature(body, `t=${t},te=${sig},li=`, SECRET, "live")).toBe(false);
    expect(verifyPaymongoSignature(body, `t=${t},te=,li=${sig}`, SECRET, "sandbox")).toBe(false);
  });
  it("a changed body, timestamp or secret fails", () => {
    expect(verifyPaymongoSignature(body + " ", `t=${t},te=${sig}`, SECRET, "sandbox")).toBe(false);
    expect(verifyPaymongoSignature(body, `t=1700000001,te=${sig}`, SECRET, "sandbox")).toBe(false);
    expect(verifyPaymongoSignature(body, `t=${t},te=${sig}`, "other", "sandbox")).toBe(false);
  });
  it("missing secret, header, timestamp or malformed hex fails without throwing", () => {
    expect(verifyPaymongoSignature(body, `t=${t},te=${sig}`, "", "sandbox")).toBe(false);
    // An unset secret must not turn into "HMAC with an empty key", which anyone can compute.
    const emptyKeySig = hmacHex("", `${t}.${body}`);
    expect(verifyPaymongoSignature(body, `t=${t},te=${emptyKeySig}`, "", "sandbox")).toBe(false);
    expect(verifyPaymongoSignature(body, undefined, SECRET, "sandbox")).toBe(false);
    expect(verifyPaymongoSignature(body, `te=${sig}`, SECRET, "sandbox")).toBe(false);
    expect(verifyPaymongoSignature(body, `t=${t},te=zz${sig.slice(2)}`, SECRET, "sandbox")).toBe(false);
    expect(verifyPaymongoSignature(body, `t=${t},te=${sig.slice(0, 10)}`, SECRET, "sandbox")).toBe(false);
  });
});

describe("forward signature (gateway -> main API)", () => {
  it("binds the token, the timestamp and the body", () => {
    const s = signForward("tok", '{"a":1}', 1000);
    expect(s).toBe(hmacHex("tok", '1000.{"a":1}'));
    expect(signForward("tok", '{"a":1}', 1001)).not.toBe(s);
    expect(signForward("tok", '{"a":2}', 1000)).not.toBe(s);
    expect(signForward("tok2", '{"a":1}', 1000)).not.toBe(s);
  });
});

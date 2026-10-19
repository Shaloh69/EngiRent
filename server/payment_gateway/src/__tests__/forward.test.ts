import type { AxiosInstance } from "axios";
import type { Config } from "../config";
import { createForwarder, ForwardEvent } from "../forward";
import { signForward } from "../signature";

const TOKEN = "k".repeat(40);
const cfg: Config = {
  env: "sandbox",
  paymongoSecretKey: "sk_test_x",
  webhookSecret: "w",
  gatewayToken: TOKEN,
  endpointGistUrl: "https://gist.example/raw",
  mainApiUrl: "",
  sourceAccount: null,
  port: 0,
};
const ev: ForwardEvent = { mode: "sandbox", eventId: "evt_1", type: "checkout_session.payment.paid", livemode: false, checkoutId: "cs_1" };

/** A fake HTTP client: gist answers come from `gist`, posts from `post`. */
function fakeHttp(gist: () => unknown, post: (url: string) => number | Error) {
  const posts: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
  let gistReads = 0;
  const http = {
    get: jest.fn(async () => {
      gistReads++;
      return { data: gist() };
    }),
    post: jest.fn(async (url: string, body: string, opts: { headers: Record<string, string> }) => {
      posts.push({ url, body, headers: opts.headers });
      const r = post(url);
      if (r instanceof Error) throw r;
      return { status: r };
    }),
  } as unknown as AxiosInstance;
  return { http, posts, gistReads: () => gistReads };
}

describe("forwarding to the main API", () => {
  it("posts to <gist api>/payments/gateway-event, signed over timestamp + body", async () => {
    const h = fakeHttp(() => ({ api: "https://old-tunnel.example/api/v1/" }), () => 200);
    const r = await createForwarder(cfg, h.http, () => 5000).forward(ev);
    expect(r.ok).toBe(true);
    expect(h.posts[0].url).toBe("https://old-tunnel.example/api/v1/payments/gateway-event");
    expect(h.posts[0].headers["X-Gateway-Timestamp"]).toBe("5000");
    expect(h.posts[0].headers["X-Gateway-Signature"]).toBe(signForward(TOKEN, h.posts[0].body, 5000));
    expect(JSON.parse(h.posts[0].body)).toEqual(ev);
  });

  it("the tunnel rotated: a network failure re-reads the gist once and delivers to the new address", async () => {
    let api = "https://old-tunnel.example/api/v1";
    const h = fakeHttp(
      () => ({ api }),
      (url) => (url.startsWith("https://old-tunnel") ? new Error("ENOTFOUND") : 200),
    );
    const f = createForwarder(cfg, h.http, () => 1);
    await f.currentMainApi(); // cache the old address
    api = "https://new-tunnel.example/api/v1";
    const r = await f.forward(ev);
    expect(r.ok).toBe(true);
    expect(h.posts.map((p) => p.url)).toEqual([
      "https://old-tunnel.example/api/v1/payments/gateway-event",
      "https://new-tunnel.example/api/v1/payments/gateway-event",
    ]);
  });

  it("a 4xx from a reachable API is an answer: no retry", async () => {
    const h = fakeHttp(() => ({ api: "https://a.example/api/v1" }), () => 401);
    const r = await createForwarder(cfg, h.http, () => 1).forward(ev);
    expect(r).toMatchObject({ ok: false, status: 401 });
    expect(h.posts).toHaveLength(1);
  });

  it("the gist address is cached for 5 minutes, then re-read", async () => {
    let t = 0;
    const h = fakeHttp(() => ({ api: "https://a.example/api/v1" }), () => 200);
    const f = createForwarder(cfg, h.http, () => t);
    await f.forward(ev);
    t = 4 * 60_000;
    await f.forward(ev);
    expect(h.gistReads()).toBe(1);
    t = 6 * 60_000;
    await f.forward(ev);
    expect(h.gistReads()).toBe(2);
  });

  it("a gist without an https api address is not used", async () => {
    const h = fakeHttp(() => ({ api: "http://plain.example/api/v1" }), () => 200);
    const r = await createForwarder(cfg, h.http, () => 1).forward(ev);
    expect(r).toMatchObject({ ok: false, reason: "main API address unknown" });
    expect(h.posts).toHaveLength(0);
  });

  it("MAIN_API_URL overrides the gist (local testing)", async () => {
    const h = fakeHttp(() => {
      throw new Error("gist must not be read");
    }, () => 200);
    const r = await createForwarder({ ...cfg, mainApiUrl: "https://local.example/api/v1" }, h.http, () => 1).forward(ev);
    expect(r.ok).toBe(true);
    expect(h.posts[0].url).toBe("https://local.example/api/v1/payments/gateway-event");
  });
});

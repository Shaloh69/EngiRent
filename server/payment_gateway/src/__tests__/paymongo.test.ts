import type { AxiosInstance } from "axios";
import { createPayMongo } from "../paymongo";

// What the gateway asks PayMongo for when it creates a checkout (2026-10-21:
// the live account showed "No payment methods are available" because QR Ph,
// the method active by default, was never requested).
describe("createCheckout request body", () => {
  it("asks for QR Ph and the other methods, amount in centavos", async () => {
    const post = jest.fn().mockResolvedValue({ data: { data: { id: "cs_1", attributes: { checkout_url: "https://checkout.paymongo.com/cs_1" } } } });
    const pm = createPayMongo("sk_live_x", { post } as unknown as AxiosInstance);
    await pm.createCheckout({ amount: 1, name: "n", description: "d", successUrl: "https://x/s", cancelUrl: "https://x/c", metadata: {} });
    const attrs = post.mock.calls[0][1].data.attributes;
    expect(attrs.payment_method_types).toEqual(expect.arrayContaining(["qrph", "gcash", "paymaya", "card"]));
    expect(attrs.line_items[0].amount).toBe(100);
  });
});

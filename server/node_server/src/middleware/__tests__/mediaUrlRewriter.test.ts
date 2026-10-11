import { __rewriteForTest } from "../mediaUrlRewriter";
import { signMediaPath } from "../../services/storageService";

/**
 * SECURITY FIX 2026-10-11. The rewriter used to sign ANY string that looked
 * like a private path, so a chat message reading exactly
 * `users/<victim>/id.jpg` came back as a working link to the victim's ID photo.
 */
describe("mediaUrlRewriter", () => {
  it("never signs user-written text, wherever it appears", () => {
    const out = __rewriteForTest({
      messages: [{ body: "users/victim-1/id.jpg" }],
      item: { title: "verifications/r1/a.jpg", description: "users/victim-1/id.jpg" },
      comment: "users/victim-1/face.jpg",
    }) as any;
    expect(out.messages[0].body).toBe("users/victim-1/id.jpg");
    expect(out.item.title).toBe("verifications/r1/a.jpg");
    expect(out.item.description).toBe("users/victim-1/id.jpg");
    expect(out.comment).toBe("users/victim-1/face.jpg");
  });

  it("still rewrites the server-written media columns", () => {
    const out = __rewriteForTest({
      user: { idImageUrl: "users/u1/id.jpg", profileImage: "users/u1/face.jpg" },
      verification: { kioskImages: ["verifications/r1/a.jpg"] },
      item: { images: ["items/b1/1.jpg"] },
    }) as any;
    expect(out.user.idImageUrl).toMatch(/\/media\/secure\//);
    expect(out.user.profileImage).toMatch(/\/media\/users\/u1\/face\.jpg$/);
    expect(out.verification.kioskImages[0]).toMatch(/\/media\/secure\//);
    expect(out.item.images[0]).toMatch(/\/media\/items\/b1\/1\.jpg$/);
  });

  it("re-signs our own EXPIRED stored link, and refuses a forged one", () => {
    const expired = `https://old-host.trycloudflare.com/media/secure/${signMediaPath("verifications/r1/a.jpg", -60)}`;
    const forgedPath = Buffer.from("users/victim-1/id.jpg").toString("base64url");
    const forged = `https://x/media/secure/${forgedPath}.${Buffer.from("9999999999999").toString("base64url")}.AAAA`;
    const out = __rewriteForTest({ verification: { kioskImages: [expired, forged] } }) as any;
    expect(out.verification.kioskImages[0]).not.toBe(expired);
    expect(out.verification.kioskImages[0]).toMatch(/\/media\/secure\//);
    expect(out.verification.kioskImages[1]).toBe(forged);
  });
});

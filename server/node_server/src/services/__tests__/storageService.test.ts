import fs from "fs/promises";
import path from "path";
import os from "os";

// Point STORAGE_DIR at a throwaway temp directory before importing the
// module under test — storageService reads env.STORAGE_DIR once at import
// time to compute its resolved root.
let tmpRoot: string;

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "engirent-storage-test-"));
  process.env.STORAGE_DIR = tmpRoot;
});

afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

// Imported after STORAGE_DIR is set, per the note above.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const storageService = require("../storageService") as typeof import("../storageService");

describe("saveBuffer / readStoredFile / deleteStoredPath — path safety", () => {
  it("writes and reads back a file under the storage root", async () => {
    await storageService.saveBuffer("items/batch1/listing-1.jpg", Buffer.from("hello"));
    const read = await storageService.readStoredFile("items/batch1/listing-1.jpg");
    expect(read.toString()).toBe("hello");
  });

  it("refuses to write outside the storage root via a traversal path", async () => {
    await expect(
      storageService.saveBuffer("../../etc/passwd", Buffer.from("evil")),
    ).rejects.toThrow(/outside storage root/);
  });

  it("refuses to read outside the storage root via a traversal path", async () => {
    await expect(
      storageService.readStoredFile("../../../etc/passwd"),
    ).rejects.toThrow(/outside storage root/);
  });

  it("delete is a no-op (not an error) for a file that doesn't exist", async () => {
    await expect(
      storageService.deleteStoredPath("users/nobody/face.jpg"),
    ).resolves.toBeUndefined();
  });

  it("storedFileExists reflects reality", async () => {
    await storageService.saveBuffer("users/u1/id.jpg", Buffer.from("id-photo"));
    expect(await storageService.storedFileExists("users/u1/id.jpg")).toBe(true);
    expect(await storageService.storedFileExists("users/u1/face.jpg")).toBe(false);
  });
});

describe("signMediaPath / verifyMediaToken — private media access", () => {
  it("round-trips a valid, unexpired token", () => {
    const token = storageService.signMediaPath("users/u1/id.jpg", 60);
    expect(storageService.verifyMediaToken(token)).toBe("users/u1/id.jpg");
  });

  it("rejects a token with a tampered path segment", () => {
    const token = storageService.signMediaPath("users/u1/id.jpg", 60);
    const [, expPart, sig] = token.split(".");
    const forgedPath = Buffer.from("users/u2/id.jpg", "utf8").toString("base64url");
    const forged = `${forgedPath}.${expPart}.${sig}`;
    expect(storageService.verifyMediaToken(forged)).toBeNull();
  });

  it("rejects a token with a tampered signature", () => {
    const token = storageService.signMediaPath("users/u1/id.jpg", 60);
    const tampered = token.slice(0, -4) + "abcd";
    expect(storageService.verifyMediaToken(tampered)).toBeNull();
  });

  it("rejects an expired token", () => {
    const token = storageService.signMediaPath("users/u1/id.jpg", -1); // already expired
    expect(storageService.verifyMediaToken(token)).toBeNull();
  });

  it("rejects a malformed token", () => {
    expect(storageService.verifyMediaToken("not-a-real-token")).toBeNull();
  });
});

describe("URL builders", () => {
  it("publicItemUrl refuses a non-item path", () => {
    expect(() => storageService.publicItemUrl("users/u1/face.jpg")).toThrow();
  });

  it("signedMediaUrl returns null for a null/undefined path", () => {
    expect(storageService.signedMediaUrl(null)).toBeNull();
    expect(storageService.signedMediaUrl(undefined)).toBeNull();
  });

  it("signedMediaUrls maps over an array and drops non-string entries", () => {
    const urls = storageService.signedMediaUrls([
      "verifications/r1/a.jpg",
      null,
      "verifications/r1/b.jpg",
      42,
    ]);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("/media/secure/");
  });

  it("signedMediaUrls returns an empty array for non-array input", () => {
    expect(storageService.signedMediaUrls("not-an-array")).toEqual([]);
  });
});

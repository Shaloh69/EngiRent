import {
  encryptJson,
  decryptJson,
  isEncryptedBlob,
  decryptFaceEncoding,
} from "../crypto";

// Covers the Phase 0 biometric-encryption-at-rest fix (User.faceEncoding was
// previously written as plain unencrypted JSON).

describe("encryptJson / decryptJson", () => {
  it("round-trips a 128-float face encoding", () => {
    const encoding = Array.from({ length: 128 }, (_, i) => i / 128);
    const blob = encryptJson(encoding);
    expect(isEncryptedBlob(blob)).toBe(true);
    expect(decryptJson<number[]>(blob)).toEqual(encoding);
  });

  it("never stores the plaintext value anywhere in the blob", () => {
    const encoding = [0.123456, -0.987654];
    const blob = encryptJson(encoding);
    const serialized = JSON.stringify(blob);
    expect(serialized).not.toContain("0.123456");
    expect(serialized).not.toContain("-0.987654");
  });

  it("fails to decrypt if the ciphertext has been tampered with", () => {
    const blob = encryptJson([1, 2, 3]);
    const tampered = { ...blob, data: blob.data.slice(0, -4) + "abcd" };
    expect(() => decryptJson(tampered)).toThrow();
  });

  it("fails to decrypt if the auth tag has been tampered with", () => {
    const blob = encryptJson([1, 2, 3]);
    const tampered = { ...blob, authTag: blob.authTag.slice(0, -4) + "abcd" };
    expect(() => decryptJson(tampered)).toThrow();
  });
});

describe("decryptFaceEncoding", () => {
  it("decrypts a genuine encrypted blob", () => {
    const encoding = Array.from({ length: 128 }, () => Math.random());
    const blob = encryptJson(encoding);
    expect(decryptFaceEncoding(blob)).toEqual(encoding);
  });

  it("tolerates a legacy plaintext 128-float array (pre-encryption rows)", () => {
    const encoding = Array.from({ length: 128 }, () => 0.5);
    expect(decryptFaceEncoding(encoding)).toEqual(encoding);
  });

  it("returns null for null/undefined", () => {
    expect(decryptFaceEncoding(null)).toBeNull();
    expect(decryptFaceEncoding(undefined)).toBeNull();
  });

  it("returns null for a malformed/wrong-length legacy array", () => {
    expect(decryptFaceEncoding([1, 2, 3])).toBeNull();
  });

  it("returns null (not throw) for a corrupted encrypted blob", () => {
    const blob = encryptJson(Array.from({ length: 128 }, () => 0.1));
    const corrupted = { ...blob, data: "not-valid-base64-ciphertext!!" };
    expect(decryptFaceEncoding(corrupted)).toBeNull();
  });
});

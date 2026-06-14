import { describe, expect, it } from "vitest";

import { encryptSecret, decryptSecret, last4 } from "../lib/execution/crypto";

describe("credential encryption (AES-256-GCM, server-only)", () => {
  const PLAINTEXT = "sk-ant-secret-key-value-9999";

  it("round-trips encrypt -> decrypt", () => {
    const enc = encryptSecret(PLAINTEXT);
    expect(decryptSecret(enc)).toBe(PLAINTEXT);
  });

  it("ciphertext never contains the plaintext and uses a fresh IV each time", () => {
    const a = encryptSecret(PLAINTEXT);
    const b = encryptSecret(PLAINTEXT);
    expect(a.encryptedKey).not.toContain(PLAINTEXT);
    expect(a.encryptedKey).not.toContain("secret");
    // Fresh IV => identical plaintext yields different ciphertext.
    expect(a.encryptedKey).not.toBe(b.encryptedKey);
    expect(a.encryptionIv).not.toBe(b.encryptionIv);
  });

  it("a tampered auth tag fails decryption (integrity)", () => {
    const enc = encryptSecret(PLAINTEXT);
    const tampered = { ...enc, encryptionAuthTag: Buffer.from("0".repeat(16)).toString("base64") };
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("last4 exposes only the final four characters", () => {
    expect(last4(PLAINTEXT)).toBe("9999");
  });
});

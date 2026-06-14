import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

// secrets: server-only, never logged/returned.
// BYO provider keys are encrypted at rest with AES-256-GCM. The encryption key
// comes from CREDENTIAL_ENCRYPTION_KEY (env). We derive a stable 32-byte key by
// SHA-256 over the env value so any sufficiently-long secret works in dev; in
// production set a 32-byte base64/hex secret. There is NO code path that returns
// or logs the plaintext key — callers receive only ciphertext or last4.

const ALGO = "aes-256-gcm";

function encryptionKey(): Buffer {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw || raw.length < 16) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY is not set (need a long server-side secret).");
  }
  // Derive a fixed 32-byte key from the configured secret.
  return createHash("sha256").update(raw).digest();
}

export type EncryptedSecret = {
  encryptedKey: string; // base64 ciphertext
  encryptionIv: string; // base64 IV
  encryptionAuthTag: string; // base64 GCM auth tag
};

export function encryptSecret(plaintext: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encryptedKey: ciphertext.toString("base64"),
    encryptionIv: iv.toString("base64"),
    encryptionAuthTag: authTag.toString("base64")
  };
}

export function decryptSecret(secret: EncryptedSecret): string {
  const decipher = createDecipheriv(ALGO, encryptionKey(), Buffer.from(secret.encryptionIv, "base64"));
  decipher.setAuthTag(Buffer.from(secret.encryptionAuthTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(secret.encryptedKey, "base64")),
    decipher.final()
  ]);
  return plaintext.toString("utf8");
}

// The only displayable fragment of a secret.
export function last4(plaintext: string): string {
  return plaintext.slice(-4);
}

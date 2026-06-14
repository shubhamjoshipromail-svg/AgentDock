import { prisma } from "../prisma";
import { encryptSecret, decryptSecret, last4 } from "./crypto";

// secrets: server-only. These helpers are the ONLY place BYO provider keys are
// encrypted/decrypted. Nothing here returns plaintext to a caller that crosses
// the network boundary — loadActiveProviderKey is used solely by the run engine.

export type CredentialProvider = "anthropic" | "openai";

export type CredentialMetadata = {
  id: string;
  provider: string;
  last4: string | null;
  status: string;
  createdAt: Date;
};

// Stores a BYO key encrypted at rest. Revokes any prior active key for the same
// provider so there is exactly one active key per provider.
export async function storeProviderKey(userId: string, provider: CredentialProvider, key: string): Promise<CredentialMetadata> {
  const enc = encryptSecret(key);
  return prisma.$transaction(async (tx) => {
    // Exactly one active key per provider: retire any prior active key.
    await tx.scopedCredential.updateMany({
      where: { userId, provider, credentialType: "byo_api_key", status: "active" },
      data: { status: "revoked" }
    });
    const cred = await tx.scopedCredential.create({
      data: {
        userId,
        provider,
        credentialType: "byo_api_key",
        scopeDescription: `BYO ${provider} key for running your agents`,
        status: "active",
        encryptedKey: enc.encryptedKey,
        encryptionIv: enc.encryptionIv,
        encryptionAuthTag: enc.encryptionAuthTag,
        last4: last4(key)
      }
    });
    return { id: cred.id, provider: cred.provider, last4: cred.last4, status: cred.status, createdAt: cred.createdAt };
  });
}

export async function listCredentialMetadata(userId: string): Promise<CredentialMetadata[]> {
  const rows = await prisma.scopedCredential.findMany({
    where: { userId, credentialType: "byo_api_key" },
    orderBy: { createdAt: "desc" },
    // Explicit select: the encrypted columns are NEVER selected for client paths.
    select: { id: true, provider: true, last4: true, status: true, createdAt: true }
  });
  return rows;
}

export async function revokeCredential(userId: string, id: string): Promise<boolean> {
  const result = await prisma.scopedCredential.updateMany({
    where: { id, userId, credentialType: "byo_api_key" },
    data: { status: "revoked" }
  });
  return result.count > 0;
}

// Server-only. Returns the decrypted key for the run engine, preferring Anthropic
// then OpenAI (mirrors the env-provider preference). Never crosses to the client.
export async function loadActiveProviderKey(
  userId: string
): Promise<{ provider: CredentialProvider; apiKey: string } | null> {
  const rows = await prisma.scopedCredential.findMany({
    where: { userId, credentialType: "byo_api_key", status: "active" },
    orderBy: { createdAt: "desc" }
  });
  const pick = rows.find((r) => r.provider === "anthropic") ?? rows.find((r) => r.provider === "openai");
  if (!pick || !pick.encryptedKey || !pick.encryptionIv || !pick.encryptionAuthTag) return null;
  const apiKey = decryptSecret({
    encryptedKey: pick.encryptedKey,
    encryptionIv: pick.encryptionIv,
    encryptionAuthTag: pick.encryptionAuthTag
  });
  return { provider: pick.provider as CredentialProvider, apiKey };
}

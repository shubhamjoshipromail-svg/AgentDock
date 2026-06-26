import { prisma } from "../prisma";
import { encryptSecret, decryptSecret, last4 } from "./crypto";

// secrets: server-only. These helpers are the ONLY place BYO provider keys are
// encrypted/decrypted. Nothing here returns plaintext to a caller that crosses
// the network boundary — loadActiveProviderKey is used solely by the run engine.

export type CredentialProvider = "anthropic" | "openai" | "openrouter";

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
  const pick = rows.find((r) => r.provider === "anthropic")
    ?? rows.find((r) => r.provider === "openai")
    ?? rows.find((r) => r.provider === "openrouter");
  if (!pick || !pick.encryptedKey || !pick.encryptionIv || !pick.encryptionAuthTag) return null;
  const apiKey = decryptSecret({
    encryptedKey: pick.encryptedKey,
    encryptionIv: pick.encryptionIv,
    encryptionAuthTag: pick.encryptionAuthTag
  });
  return { provider: pick.provider as CredentialProvider, apiKey };
}

// --- Google OAuth token (Gmail) ---------------------------------------------
// The user's Gmail OAuth token is stored encrypted at rest, exactly like a BYO
// provider key. It is server-only: it is never returned to the client or handed
// to an agent — only the run engine reads it to hand to the first-party Gmail
// MCP server's process environment.

const GOOGLE_OAUTH_TYPE = "oauth_token";
const GOOGLE_PROVIDER = "google";

type GoogleTokenBundle = { accessToken: string; refreshToken?: string | null; expiresAt?: number | null };

// A pluggable refresher so the refresh path is testable without the network.
export type GoogleTokenRefresher = (
  refreshToken: string
) => Promise<{ accessToken: string; expiresAt?: number | null }>;

async function defaultGoogleRefresher(refreshToken: string): Promise<{ accessToken: string; expiresAt?: number | null }> {
  const { google } = await import("googleapis");
  const client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await client.refreshAccessToken();
  if (!credentials.access_token) throw new Error("Google refresh returned no access token.");
  return { accessToken: credentials.access_token, expiresAt: credentials.expiry_date ?? null };
}

// Store (or replace) the user's encrypted Google OAuth token bundle.
export async function storeGoogleOAuthToken(userId: string, bundle: GoogleTokenBundle): Promise<void> {
  if (!bundle.accessToken) return;
  const enc = encryptSecret(JSON.stringify(bundle));
  await prisma.$transaction(async (tx) => {
    await tx.scopedCredential.updateMany({
      where: { userId, provider: GOOGLE_PROVIDER, credentialType: GOOGLE_OAUTH_TYPE, status: "active" },
      data: { status: "revoked" }
    });
    await tx.scopedCredential.create({
      data: {
        userId,
        provider: GOOGLE_PROVIDER,
        credentialType: GOOGLE_OAUTH_TYPE,
        scopeDescription: "Google OAuth token for the first-party Gmail MCP server (gmail.compose/gmail.send)",
        status: "active",
        expiresAt: bundle.expiresAt ? new Date(bundle.expiresAt) : null,
        encryptedKey: enc.encryptedKey,
        encryptionIv: enc.encryptionIv,
        encryptionAuthTag: enc.encryptionAuthTag,
        last4: last4(bundle.accessToken)
      }
    });
  });
}

// Server-only. Returns a currently-valid Google access token for the user,
// refreshing (and re-persisting) it if it is expired and a refresh token exists.
// Never crosses the network boundary to a client.
export async function loadGoogleAccessToken(
  userId: string,
  refresher: GoogleTokenRefresher = defaultGoogleRefresher
): Promise<string | null> {
  const row = await prisma.scopedCredential.findFirst({
    where: { userId, provider: GOOGLE_PROVIDER, credentialType: GOOGLE_OAUTH_TYPE, status: "active" },
    orderBy: { createdAt: "desc" }
  });
  if (!row || !row.encryptedKey || !row.encryptionIv || !row.encryptionAuthTag) return null;

  const bundle = JSON.parse(
    decryptSecret({ encryptedKey: row.encryptedKey, encryptionIv: row.encryptionIv, encryptionAuthTag: row.encryptionAuthTag })
  ) as GoogleTokenBundle;

  const expired = Boolean(bundle.expiresAt && Date.now() >= bundle.expiresAt - 60_000);
  if (!expired || !bundle.refreshToken) return bundle.accessToken;

  const refreshed = await refresher(bundle.refreshToken);
  await storeGoogleOAuthToken(userId, {
    accessToken: refreshed.accessToken,
    refreshToken: bundle.refreshToken,
    expiresAt: refreshed.expiresAt ?? null
  });
  return refreshed.accessToken;
}

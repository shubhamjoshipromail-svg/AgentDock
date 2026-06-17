import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestUser, prisma, resetDatabase } from "./helpers/db";
import {
  listCredentialMetadata,
  loadGoogleAccessToken,
  storeGoogleOAuthToken
} from "../lib/execution/credentials";

describe("Google OAuth token — encrypted at rest, server-only, never leaked", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("stores the token encrypted (no plaintext columns)", async () => {
    const user = await createTestUser();
    await storeGoogleOAuthToken(user.id, {
      accessToken: "ya29.SECRET-ACCESS",
      refreshToken: "1//SECRET-REFRESH",
      expiresAt: Date.now() + 3_600_000
    });

    const row = await prisma.scopedCredential.findFirstOrThrow({
      where: { userId: user.id, provider: "google", credentialType: "oauth_token", status: "active" }
    });
    // The blob is encrypted: no plaintext token anywhere in the stored row.
    expect(row.encryptedKey).toBeTruthy();
    expect(row.encryptedKey).not.toContain("ya29.SECRET-ACCESS");
    expect(JSON.stringify(row)).not.toContain("ya29.SECRET-ACCESS");
    expect(JSON.stringify(row)).not.toContain("1//SECRET-REFRESH");
  });

  it("round-trips the access token server-side for the run engine", async () => {
    const user = await createTestUser();
    await storeGoogleOAuthToken(user.id, {
      accessToken: "ya29.LIVE",
      refreshToken: "1//R",
      expiresAt: Date.now() + 3_600_000
    });
    const token = await loadGoogleAccessToken(user.id, async () => {
      throw new Error("should not refresh a valid token");
    });
    expect(token).toBe("ya29.LIVE");
  });

  it("refreshes (and re-persists) an expired token server-side", async () => {
    const user = await createTestUser();
    await storeGoogleOAuthToken(user.id, {
      accessToken: "ya29.OLD",
      refreshToken: "1//R",
      expiresAt: Date.now() - 1000 // already expired
    });

    const refresher = vi.fn(async (refreshToken: string) => {
      expect(refreshToken).toBe("1//R");
      return { accessToken: "ya29.NEW", expiresAt: Date.now() + 3_600_000 };
    });

    const token = await loadGoogleAccessToken(user.id, refresher);
    expect(refresher).toHaveBeenCalledTimes(1);
    expect(token).toBe("ya29.NEW");

    // A subsequent load uses the refreshed token without refreshing again.
    const again = await loadGoogleAccessToken(user.id, async () => {
      throw new Error("should not refresh a freshly refreshed token");
    });
    expect(again).toBe("ya29.NEW");
  });

  it("never appears in client-facing credential metadata", async () => {
    const user = await createTestUser();
    await storeGoogleOAuthToken(user.id, { accessToken: "ya29.SECRET", refreshToken: "1//R", expiresAt: Date.now() + 1000 });
    const metadata = await listCredentialMetadata(user.id);
    expect(JSON.stringify(metadata)).not.toContain("ya29.SECRET");
    expect(JSON.stringify(metadata)).not.toContain("1//R");
  });
});

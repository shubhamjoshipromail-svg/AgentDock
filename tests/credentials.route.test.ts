import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockAuthUserModule, setCurrentUser } from "./helpers/auth";
import { createTestUser, prisma, resetDatabase } from "./helpers/db";

vi.mock("../lib/auth-user", () => mockAuthUserModule());

import { GET as listCredentials, POST as addCredential } from "../app/api/credentials/route";
import { POST as revokeCredential } from "../app/api/credentials/[id]/revoke/route";
import { getRunProvider } from "../lib/execution/provider";

const SECRET = "sk-ant-super-secret-key-value-1234";

function addRequest(body: unknown) {
  return new Request("http://localhost/api/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("BYO credential intake (server-only, encrypted)", () => {
  beforeEach(async () => {
    await resetDatabase();
    setCurrentUser(null);
  });

  it("401 when signed out", async () => {
    const res = await addCredential(addRequest({ provider: "anthropic", key: SECRET }));
    expect(res.status).toBe(401);
  });

  it("stores a key and returns only metadata — never the secret", async () => {
    const user = await createTestUser();
    setCurrentUser(user);

    const res = await addCredential(addRequest({ provider: "anthropic", key: SECRET }));
    expect(res.status).toBe(201);
    const body = await res.json();

    // Response carries metadata only; the plaintext key appears nowhere.
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(body.credential.last4).toBe("1234");
    expect(body.credential.provider).toBe("anthropic");
    expect(body.credential.encryptedKey).toBeUndefined();

    // The DB row stores ciphertext, not plaintext.
    const row = await prisma.scopedCredential.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.encryptedKey).toBeTruthy();
    expect(JSON.stringify(row)).not.toContain(SECRET);
  });

  it("accepts an OpenRouter key and getRunProvider builds the OpenRouter provider for runs", async () => {
    const user = await createTestUser();
    setCurrentUser(user);

    const OR_KEY = "sk-or-v1-super-secret-router-key-1234";
    const res = await addCredential(addRequest({ provider: "openrouter", key: OR_KEY }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.credential.provider).toBe("openrouter");
    expect(JSON.stringify(body)).not.toContain(OR_KEY);

    // The run engine builds the OpenRouter provider from the user's BYO key.
    const provider = await getRunProvider(user.id);
    expect(provider?.name).toBe("openrouter");
  });

  it("uses the newest active provider key when multiple providers are active", async () => {
    const user = await createTestUser();
    setCurrentUser(user);

    await addCredential(addRequest({ provider: "anthropic", key: SECRET }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await addCredential(addRequest({ provider: "openrouter", key: "sk-or-v1-newer-router-key-5678" }));

    const provider = await getRunProvider(user.id);
    expect(provider?.name).toBe("openrouter");
  });

  it("falls back to an older active provider if it is the only active key", async () => {
    const user = await createTestUser();
    setCurrentUser(user);

    await addCredential(addRequest({ provider: "anthropic", key: SECRET }));

    const provider = await getRunProvider(user.id);
    expect(provider?.name).toBe("anthropic");
  });

  it("rejects an unknown provider with 400", async () => {
    const user = await createTestUser();
    setCurrentUser(user);
    const res = await addCredential(addRequest({ provider: "totally-made-up", key: SECRET }));
    expect(res.status).toBe(400);
  });

  it("GET returns metadata only (no secret columns)", async () => {
    const user = await createTestUser();
    setCurrentUser(user);
    await addCredential(addRequest({ provider: "anthropic", key: SECRET }));

    const res = await listCredentials();
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(body.credentials[0].encryptedKey).toBeUndefined();
    expect(body.credentials[0].last4).toBe("1234");
  });

  it("rejects a too-short key with 400 (no provider call, no store)", async () => {
    const user = await createTestUser();
    setCurrentUser(user);
    const res = await addCredential(addRequest({ provider: "anthropic", key: "short" }));
    expect(res.status).toBe(400);
    const count = await prisma.scopedCredential.count({ where: { userId: user.id } });
    expect(count).toBe(0);
  });

  it("revoke flips status; a second active key for a provider retires the first", async () => {
    const user = await createTestUser();
    setCurrentUser(user);
    await addCredential(addRequest({ provider: "anthropic", key: SECRET }));
    await addCredential(addRequest({ provider: "anthropic", key: "sk-ant-second-key-value-5678" }));

    const active = await prisma.scopedCredential.findMany({ where: { userId: user.id, status: "active" } });
    expect(active).toHaveLength(1);
    expect(active[0].last4).toBe("5678");

    const res = await revokeCredential(new Request("http://localhost/x"), { params: Promise.resolve({ id: active[0].id }) });
    expect(res.status).toBe(200);
    const stillActive = await prisma.scopedCredential.count({ where: { userId: user.id, status: "active" } });
    expect(stillActive).toBe(0);
  });
});

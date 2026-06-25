import { afterEach, describe, expect, it } from "vitest";

import {
  loadBrokeredCredential,
  brokerCredentialForAction,
  hasCredentialBroker,
  registerCredentialProvider,
  type CredentialMandate
} from "../lib/execution/credential-broker";

// Chunk 15 Phase 2: the generic scoped credential broker is the SINGLE, provider-
// agnostic path a credential reaches a server. google is one of N; a second
// provider works through the same mechanism; and the broker refuses to issue a
// credential for an external action outside an authorizing scope/limit/expiry.
describe("generic scoped credential broker", () => {
  const disposers: (() => void)[] = [];
  afterEach(() => {
    while (disposers.length) disposers.pop()!();
  });

  it("a second (mock) provider works through the same broker mechanism — no execution-path change", async () => {
    expect(hasCredentialBroker("acme")).toBe(false);
    disposers.push(registerCredentialProvider("acme", async (userId) => `acme-token-for-${userId}`));
    expect(hasCredentialBroker("acme")).toBe(true);

    // Same loadBrokeredCredential surface routes to the new provider.
    expect(await loadBrokeredCredential("acme", "user-1")).toBe("acme-token-for-user-1");
    // google remains one of N, unchanged.
    expect(hasCredentialBroker("google")).toBe(true);
  });

  it("an unknown provider yields no credential (never throws)", async () => {
    expect(await loadBrokeredCredential("nope", "user-1")).toBeNull();
  });

  const okMandate: CredentialMandate = { scope: null, limitCents: null, expiresAt: null, revokedAt: null };

  it("read-only actions skip the mandate check and are issued", async () => {
    disposers.push(registerCredentialProvider("acme", async () => "tok"));
    const out = await brokerCredentialForAction("acme", "u", { external: false, mandate: null });
    expect(out).toEqual({ ok: true, token: "tok" });
  });

  it("an external action with an authorizing grant is issued the token", async () => {
    disposers.push(registerCredentialProvider("acme", async () => "tok"));
    const out = await brokerCredentialForAction("acme", "u", { external: true, mandate: okMandate });
    expect(out).toEqual({ ok: true, token: "tok" });
  });

  it("an external action with NO grant is refused", async () => {
    disposers.push(registerCredentialProvider("acme", async () => "tok"));
    const out = await brokerCredentialForAction("acme", "u", { external: true, mandate: null });
    expect(out.ok).toBe(false);
  });

  it("an external action is refused when revoked, expired, over-limit, or out-of-scope", async () => {
    disposers.push(registerCredentialProvider("acme", async () => "tok"));

    const revoked = await brokerCredentialForAction("acme", "u", { external: true, mandate: { ...okMandate, revokedAt: new Date() } });
    expect(revoked.ok).toBe(false);

    const expired = await brokerCredentialForAction("acme", "u", { external: true, mandate: { ...okMandate, expiresAt: new Date(Date.now() - 1000) } });
    expect(expired.ok).toBe(false);

    const overLimit = await brokerCredentialForAction("acme", "u", { external: true, mandate: { ...okMandate, limitCents: 100 }, amountCents: 500 });
    expect(overLimit.ok).toBe(false);

    const outOfScope = await brokerCredentialForAction("acme", "u", { external: true, mandate: { ...okMandate, scope: "gmail.send" }, requiredScope: "stripe.charge" });
    expect(outOfScope.ok).toBe(false);
  });

  it("within limit and matching scope is issued", async () => {
    disposers.push(registerCredentialProvider("acme", async () => "tok"));
    const out = await brokerCredentialForAction("acme", "u", {
      external: true,
      mandate: { scope: "gmail.send", limitCents: 1000, expiresAt: new Date(Date.now() + 60_000), revokedAt: null },
      amountCents: 0,
      requiredScope: "gmail.send"
    });
    expect(out).toEqual({ ok: true, token: "tok" });
  });
});

import { loadGoogleAccessToken } from "./credentials";

// The generic, server-side credential broker — the SINGLE path a credential
// reaches an MCP server. An MCP server names a `credentialProvider` (registration
// data); the broker maps that provider to a server-side token loader, loads/
// refreshes the token server-side, and the run engine injects it into the MCP
// server's process env ONLY. The token is NEVER returned to the agent, the
// client, run events, or logs. Adding an OAuth-backed server is a new provider
// entry (or a registerCredentialProvider call) — not a server-specific branch in
// execution.

// A provider loader: returns a currently-valid, minimal-scope token for the user
// (refreshing server-side as needed) or null if none exists.
export type CredentialProviderLoader = (userId: string) => Promise<string | null>;

// Provider registry. `google` is one of N — not a special case. The structure is
// provider-agnostic: every provider flows through the same load/refresh/inject
// mechanism with no execution-path changes.
const PROVIDERS: Record<string, CredentialProviderLoader> = {
  google: loadGoogleAccessToken
};

// Extensibility seam: register an additional OAuth/token provider (used by tests
// for a second mock provider, and by future first-party providers). Returns a
// disposer so a caller can restore the registry.
export function registerCredentialProvider(name: string, loader: CredentialProviderLoader): () => void {
  const prior = PROVIDERS[name];
  PROVIDERS[name] = loader;
  return () => {
    if (prior) PROVIDERS[name] = prior;
    else delete PROVIDERS[name];
  };
}

export function hasCredentialBroker(provider: string): boolean {
  return provider in PROVIDERS;
}

// The mandate authorizing a consequential action (scope + limit + expiry +
// revocation) — mirrors the seeded McpAccessGrant shape. The broker enforces it
// before issuing a credential for an external write. This wires the ENFORCEMENT
// POINT; full signed mandates (money-grade) are the next layer.
export type CredentialMandate = {
  scope: string | null;
  limitCents: number | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
};

export type BrokerScopeContext = {
  // True for an external-write/send action — the broker enforces the mandate.
  // Read-only actions skip the mandate check (no consequential authority needed).
  external: boolean;
  mandate: CredentialMandate | null;
  // The cost about to be incurred, checked against the mandate limit.
  amountCents?: number;
  // The scope label the action requires, checked against the mandate scope.
  requiredScope?: string | null;
};

export type BrokerOutcome =
  | { ok: true; token: string | null }   // issued (or none needed/available)
  | { ok: false; reason: string };        // refused: out of scope/limit/expired/revoked

// Availability check / read-only issuance: maps provider → loader. No mandate
// enforcement (used by the connect flow to verify a credential exists, and by the
// guarded path below once the mandate has cleared).
export async function loadBrokeredCredential(provider: string, userId: string): Promise<string | null> {
  const loader = PROVIDERS[provider];
  if (!loader) return null;
  return loader(userId);
}

// The guarded issuance path used at execution time. For a consequential
// (external-write) action the broker REFUSES unless an active, unexpired,
// in-limit, in-scope grant authorizes it — never handing out a credential for an
// unauthorized external action. Read-only actions skip the check.
export async function brokerCredentialForAction(
  provider: string,
  userId: string,
  scope: BrokerScopeContext
): Promise<BrokerOutcome> {
  if (scope.external) {
    const m = scope.mandate;
    if (!m) return { ok: false, reason: "no active grant authorizes this external action" };
    if (m.revokedAt) return { ok: false, reason: "grant revoked" };
    if (m.expiresAt && Date.now() >= m.expiresAt.getTime()) return { ok: false, reason: "grant expired" };
    if (m.limitCents != null && (scope.amountCents ?? 0) > m.limitCents) {
      return { ok: false, reason: "action cost exceeds grant limit" };
    }
    // Scope is DENY-BY-DEFAULT. A grant that carries no scope authorizes nothing
    // scoped: absence of authority is not authority. (Previously `&& m.scope`
    // short-circuited here, so a scopeless grant satisfied every action.)
    if (scope.requiredScope) {
      const granted = m.scope?.trim();
      if (!granted) {
        return { ok: false, reason: "grant carries no scope, so it cannot authorize this action" };
      }
      if (granted !== scope.requiredScope) {
        return { ok: false, reason: "action is outside the granted scope" };
      }
    }
  }
  const token = await loadBrokeredCredential(provider, userId);
  return { ok: true, token };
}

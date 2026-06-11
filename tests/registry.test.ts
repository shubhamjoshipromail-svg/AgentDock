import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockAuthUserModule, setCurrentUser } from "./helpers/auth";
import { createTestUser, prisma, resetDatabase } from "./helpers/db";

vi.mock("../lib/auth-user", () => mockAuthUserModule());

// ---- normalize.ts unit tests (no DB, no network) ----
import { normalizeExternal, curatedWins } from "../lib/registry/normalize";
import type { RawRegistryEntry } from "../lib/registry/normalize";

describe("normalize.ts", () => {
  it("normalizes a well-formed registry entry with deny-by-default curation", () => {
    const raw: RawRegistryEntry = {
      server: {
        name: "test.org/my-server",
        title: "My Server",
        description: "Does things.",
        version: "1.2.0",
        repository: { url: "https://github.com/test/my-server", source: "github" },
        packages: [{ registryType: "npm", identifier: "@test/my-server", version: "1.2.0" }],
        remotes: [{ type: "streamable-http", url: "https://test.org/mcp" }]
      },
      _meta: {
        "io.modelcontextprotocol.registry/official": { status: "active", isLatest: true }
      }
    };

    const result = normalizeExternal(raw);
    expect(result).not.toBeNull();
    expect(result!.registryId).toBe("test.org/my-server");
    expect(result!.registrySource).toBe("mcp-official-registry");
    expect(result!.displayName).toBe("My Server");
    expect(result!.repositoryUrl).toBe("https://github.com/test/my-server");
    expect(result!.packageName).toBe("@test/my-server");
    expect(result!.packageRegistry).toBe("npm");
    expect(result!.homepageUrl).toBe("https://test.org/mcp");

    // Deny-by-default: external entries must never be verified or given write access
    expect(result!.verificationStatus).toBe("unverified");
    expect(result!.riskLevel).toBe("medium");
    expect(result!.recommendedPermission).toBe("approval_required");
    expect(result!.tools).toHaveLength(0);
  });

  it("returns null for entries without a name", () => {
    const raw = { server: { description: "no name" }, _meta: {} } as unknown as RawRegistryEntry;
    expect(normalizeExternal(raw)).toBeNull();
  });

  it("skips inactive entries", () => {
    const raw: RawRegistryEntry = {
      server: { name: "test.org/inactive" },
      _meta: { "io.modelcontextprotocol.registry/official": { status: "inactive" } }
    };
    expect(normalizeExternal(raw)).toBeNull();
  });

  it("curated entry wins when same npm package", () => {
    const curated = {
      packageName: "@modelcontextprotocol/server-github",
      packageRegistry: "npm",
      repositoryUrl: undefined
    } as Parameters<typeof curatedWins>[0];

    const external = {
      packageName: "@modelcontextprotocol/server-github",
      packageRegistry: "npm",
      repositoryUrl: "https://github.com/modelcontextprotocol/servers"
    } as Parameters<typeof curatedWins>[1];

    expect(curatedWins(curated, external)).toBe(true);
  });

  it("curated entry wins when same repository URL", () => {
    const curated = {
      packageName: undefined,
      packageRegistry: undefined,
      repositoryUrl: "https://github.com/modelcontextprotocol/servers"
    } as Parameters<typeof curatedWins>[0];

    const external = {
      packageName: "@some/other-package",
      packageRegistry: "npm",
      repositoryUrl: "https://github.com/modelcontextprotocol/servers"
    } as Parameters<typeof curatedWins>[1];

    expect(curatedWins(curated, external)).toBe(true);
  });

  it("does not claim win when package names differ", () => {
    const curated = {
      packageName: "@curated/pkg",
      packageRegistry: "npm",
      repositoryUrl: undefined
    } as Parameters<typeof curatedWins>[0];

    const external = {
      packageName: "@external/different",
      packageRegistry: "npm",
      repositoryUrl: undefined
    } as Parameters<typeof curatedWins>[1];

    expect(curatedWins(curated, external)).toBe(false);
  });
});

// ---- Sync route integration tests (mocked network) ----
import { POST as syncRegistry } from "../app/api/mcp/sync-registry/route";

// We mock the officialMcp fetcher so tests never hit the network.
vi.mock("../lib/registry/officialMcp", () => ({
  fetchOfficialRegistry: vi.fn()
}));
import { fetchOfficialRegistry } from "../lib/registry/officialMcp";
const mockFetch = vi.mocked(fetchOfficialRegistry);

describe("POST /api/mcp/sync-registry", () => {
  beforeEach(async () => {
    await resetDatabase();
    setCurrentUser(await createTestUser());
  });

  it("returns 401 when signed out", async () => {
    setCurrentUser(null);
    const response = await syncRegistry();
    expect(response.status).toBe(401);
  });

  it("upserts curated + external servers and returns summary", async () => {
    mockFetch.mockResolvedValueOnce({
      servers: [
        {
          name: "reg:test.org/ext-server",
          displayName: "External Server",
          description: "A real external server.",
          registrySource: "mcp-official-registry",
          registryId: "test.org/ext-server",
          verificationStatus: "unverified",
          riskLevel: "medium",
          recommendedPermission: "approval_required",
          tools: []
        }
      ],
      skipped: 1,
      failed: 0
    });

    const response = await syncRegistry();
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.upserted).toBeGreaterThan(0);
    expect(data.source).toBe("mcp-official-registry");
    expect(typeof data.durationMs).toBe("number");

    // No external entry should ever land as verified
    const externalServers = await prisma.mcpServer.findMany({
      where: { registrySource: "mcp-official-registry" }
    });
    for (const server of externalServers) {
      expect(server.verificationStatus).toBe("unverified");
      expect(["read_only", "approval_required", "draft_only", "blocked"]).toContain(server.recommendedPermission);
      // Deny-by-default: external servers must not have write/execute permissions
      // (checked via recommendedPermission — "approval_required" has no write by design)
      expect(server.verificationStatus).not.toBe("verified");
    }
  });

  it("re-running sync is idempotent (row count stable)", async () => {
    const externalServer = {
      name: "reg:test.org/stable-server",
      displayName: "Stable Server",
      description: "Stable.",
      registrySource: "mcp-official-registry",
      registryId: "test.org/stable-server",
      verificationStatus: "unverified" as const,
      riskLevel: "medium" as const,
      recommendedPermission: "approval_required" as const,
      tools: []
    };

    mockFetch.mockResolvedValue({ servers: [externalServer], skipped: 0, failed: 0 });

    await syncRegistry();
    const countAfterFirst = await prisma.mcpServer.count();

    await syncRegistry();
    const countAfterSecond = await prisma.mcpServer.count();

    expect(countAfterFirst).toBe(countAfterSecond);
  });

  it("returns 502 on fetch failure and leaves catalog unchanged", async () => {
    // Seed one server first
    await prisma.mcpServer.create({
      data: {
        name: "pre-existing-server",
        displayName: "Pre-existing",
        description: "Was here before.",
        registrySource: "agentdock-curated",
        riskLevel: "low",
        verificationStatus: "verified",
        recommendedPermission: "read_only"
      }
    });

    const countBefore = await prisma.mcpServer.count();

    mockFetch.mockRejectedValueOnce(new Error("Network timeout"));

    const response = await syncRegistry();
    expect(response.status).toBe(502);

    // Catalog unchanged
    const countAfter = await prisma.mcpServer.count();
    expect(countAfter).toBe(countBefore);
  });
});

// ---- Deny-by-default enforcement: normalizeExternal is the gate ----
// The sync route trusts fetchOfficialRegistry output. The deny-by-default
// invariant is enforced in normalizeExternal (unit-tested above). This
// integration test verifies the full round-trip: realistic unverified entries
// from the fetcher land with conservative curation in the DB.
describe("deny-by-default curation invariants", () => {
  beforeEach(async () => {
    await resetDatabase();
    setCurrentUser(await createTestUser());
  });

  it("external servers land with unverified status and approval_required permission", async () => {
    mockFetch.mockResolvedValueOnce({
      servers: [
        {
          name: "reg:realistic.org/tool-a",
          displayName: "Tool A",
          description: "Realistic external tool.",
          registrySource: "mcp-official-registry",
          registryId: "realistic.org/tool-a",
          // normalizeExternal always sets these conservatively; mock reflects that
          verificationStatus: "unverified" as const,
          riskLevel: "medium" as const,
          recommendedPermission: "approval_required" as const,
          tools: []
        },
        {
          name: "reg:realistic.org/tool-b",
          displayName: "Tool B",
          description: "Another realistic external tool.",
          registrySource: "mcp-official-registry",
          registryId: "realistic.org/tool-b",
          verificationStatus: "unverified" as const,
          riskLevel: "medium" as const,
          recommendedPermission: "approval_required" as const,
          tools: []
        }
      ],
      skipped: 0,
      failed: 0
    });

    const response = await syncRegistry();
    expect(response.status).toBe(200);

    const externalServers = await prisma.mcpServer.findMany({
      where: { registrySource: "mcp-official-registry" }
    });

    expect(externalServers).toHaveLength(2);

    for (const server of externalServers) {
      // Deny-by-default: all external servers must be unverified
      expect(server.verificationStatus).toBe("unverified");
      // Conservative permission: approval_required by default
      expect(server.recommendedPermission).toBe("approval_required");
    }

    // No external server should have been mistakenly stored as verified
    const badServers = await prisma.mcpServer.findMany({
      where: { registrySource: "mcp-official-registry", verificationStatus: "verified" }
    });
    expect(badServers).toHaveLength(0);
  });
});

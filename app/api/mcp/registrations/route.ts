import { NextResponse } from "next/server";

import { getCurrentUser } from "../../../../lib/auth-user";
import { prisma } from "../../../../lib/prisma";
import { CURATED_SERVER_REGISTRATIONS } from "../../../../lib/registry/server-registrations";

// GET /api/mcp/registrations — the data-driven list of connectable MCP servers.
// Connectability is registration DATA (the ServerRegistration table), merged with
// the curated first-party defaults that bootstrap a fresh DB. Adding a row here
// makes a server appear in the Connect UI with no code change. Returns NON-SECRET
// metadata only (serverKey/displayName/transport/credentialProvider) — never a
// command, url, token env var, or any credential.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  const rows = await prisma.serverRegistration.findMany({
    where: { enabled: true },
    select: { serverKey: true, displayName: true, transport: true, credentialProvider: true }
  }).catch(() => []);

  const byKey = new Map(rows.map((r) => [r.serverKey, {
    serverKey: r.serverKey,
    displayName: r.displayName,
    transport: String(r.transport),
    credentialProvider: r.credentialProvider
  }]));

  // Merge curated first-party defaults so first-party servers always appear even
  // before any rows are seeded (and after a test truncation).
  for (const c of CURATED_SERVER_REGISTRATIONS) {
    if (!byKey.has(c.serverKey)) {
      byKey.set(c.serverKey, {
        serverKey: c.serverKey,
        displayName: c.displayName,
        transport: c.transport,
        credentialProvider: c.credentialProvider ?? null
      });
    }
  }

  const servers = Array.from(byKey.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));
  return NextResponse.json({ servers });
}

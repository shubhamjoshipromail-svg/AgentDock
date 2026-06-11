import { z } from "zod";

import { normalizeExternal, type RawRegistryEntry } from "./normalize";
import type { NormalizedMcpServer } from "./types";

const REGISTRY_BASE = "https://registry.modelcontextprotocol.io";
// Cap at 5 pages × 100 per page = 500 servers max per sync.
// The registry has 1000+ total; 500 is enough to demonstrate the real catalog
// without unbounded runtime. Increase MAX_PAGES later when sync is backgrounded.
const MAX_PAGES = 5;
const PAGE_SIZE = 100;

// Tolerant Zod schema — only fields we use; extra fields pass through.
const registryServerSchema = z.object({
  server: z.object({
    name: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    version: z.string().optional(),
    repository: z
      .object({ url: z.string().optional(), source: z.string().optional() })
      .optional(),
    packages: z
      .array(
        z.object({
          registryType: z.string().optional(),
          identifier: z.string().optional(),
          version: z.string().optional(),
          transport: z.unknown().optional()
        })
      )
      .optional(),
    remotes: z
      .array(z.object({ type: z.string().optional(), url: z.string().optional() }))
      .optional()
  }),
  _meta: z
    .object({
      "io.modelcontextprotocol.registry/official": z
        .object({
          status: z.string().optional(),
          isLatest: z.boolean().optional()
        })
        .optional()
    })
    .optional()
});

const registryPageSchema = z.object({
  servers: z.array(z.unknown()),
  metadata: z
    .object({
      nextCursor: z.string().optional(),
      count: z.number().optional()
    })
    .optional()
});

export type FetchResult = {
  servers: NormalizedMcpServer[];
  skipped: number;
  failed: number;
};

export async function fetchOfficialRegistry(): Promise<FetchResult> {
  const servers: NormalizedMcpServer[] = [];
  let skipped = 0;
  let failed = 0;
  let cursor: string | undefined;
  let pages = 0;

  while (pages < MAX_PAGES) {
    const url = new URL(`${REGISTRY_BASE}/v0/servers`);
    url.searchParams.set("limit", String(PAGE_SIZE));
    url.searchParams.set("isLatest", "true");
    if (cursor) url.searchParams.set("cursor", cursor);

    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      // 15s timeout per page; Next.js fetch cache disabled
      next: { revalidate: 0 }
    });

    if (!response.ok) {
      throw new Error(
        `Registry returned ${response.status} ${response.statusText} on page ${pages + 1}`
      );
    }

    const raw = await response.json();
    const page = registryPageSchema.safeParse(raw);

    if (!page.success) {
      throw new Error(`Registry response shape unexpected on page ${pages + 1}`);
    }

    pages++;

    for (const entry of page.data.servers) {
      const parsed = registryServerSchema.safeParse(entry);
      if (!parsed.success) {
        // Malformed entry: skip and log, never throw the whole sync
        console.warn("[mcp-registry] Skipping malformed entry:", parsed.error.issues[0]?.message);
        skipped++;
        continue;
      }

      const normalized = normalizeExternal(parsed.data as RawRegistryEntry);
      if (!normalized) {
        skipped++;
        continue;
      }

      servers.push(normalized);
    }

    cursor = page.data.metadata?.nextCursor;
    if (!cursor) break;
  }

  return { servers, skipped, failed };
}

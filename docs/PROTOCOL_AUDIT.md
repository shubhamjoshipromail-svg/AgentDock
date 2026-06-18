# Protocol Conformance Audit (Chunk 10)

Governing principle: every boundary speaks its real protocol — **MCP** (tools),
**A2A** (agent↔agent), **A2UI** (agent↔human), **S2S** (server↔server), **NANDA**
(discovery, later). We do not invent glue where a protocol exists, and we never
label bespoke code as a protocol it isn't.

This is the Phase 1 review artifact: findings only, **no code changed in the
phase that introduced this file.** Each finding has a `file:line`, a description,
a **category (A–F)**, and the prescribed action. Categories:

- **A** — invented intermediary where a protocol applies → refactor to the
  generic protocol path; remove the special case.
- **B** — dead/demo/orphaned → delete (prove no live caller first).
- **C** — duplicate/competing systems → consolidate to one (or unify + document).
- **D** — bespoke code mislabeled as a protocol → honest rename + roadmap marker,
  keep behavior. (Real protocol adoption is a future chunk.)
- **E** — already conforms → protect, do not touch.
- **F** — uncertain / behavior-or-architecture-altering / risky → STOP, flag for
  the founder.

> **CLOSED OUT (Phase 6).** The Status column reflects the final outcome of each
> finding: resolved, deferred (with a recorded decision), or flagged for the
> founder. Categories A-1..A-4, C-1, D-1, D-2 are resolved; A-5 (engine half),
> resolved with the catalog/UI half flagged (F-3); A-6 deferred (F-2).

---

## Founder decisions needed (Category F)

These are the items left for you — none block the resolved remediation; each is a
deliberate "stop and decide" rather than a silent change.

- **F-1 — Model-provider keys (C-1): RESOLVED as documented.** Planning uses the
  system env key (so you can plan before adding a key); runs use your BYO key.
  Kept as two deliberate paths and documented in `lib/llm/index.ts`. **Decision
  needed only if** you'd prefer planning to also require a BYO key (removing the
  pre-key planning affordance) — otherwise no action.
- **F-2 — Web-search executor (A-6): DEFERRED.** No vetted MCP search server is
  available without a new dependency + trust surface, so the legacy executor
  stays behind the generic dispatch (not a per-server special-case). Replace it
  with a registered MCP search server in a future chunk. No action needed now.
- **F-3 — Gmail catalog reachability + connect UI (A-5, remaining half): DEFERRED.**
  The engine/grant/identity is now generic and Gmail executes through it (proven
  in tests). What remains for *live UI* reachability is (a) seeding the two Gmail
  tools as catalog `McpServer` rows carrying the new identity columns, and (b) a
  "connect a server → list discovered tools → grant per tool" A2UI surface.
  Deferred this pass to avoid destabilizing the catalog/sync/sanity tests; this is
  the live Gmail-from-UI step. Founder to confirm priority for the next chunk.

---

## Summary table

| # | File:line | Finding | Cat | Action | Status |
|---|-----------|---------|-----|--------|--------|
| A-1 | `lib/execution/run-engine.ts:507` | `if (serverName === "gmail")` injects the Gmail token | A | Generic server-side credential injection (broker pattern), no server name branch | resolved |
| A-2 | `lib/execution/mcp-client.ts:32,35` | `ALLOWLIST = new Set(["gmail"])` | A | Replace with a generic registered-server model | resolved |
| A-3 | `lib/execution/mcp-client.ts:42–55` | `mcp:`-prefix name hack (`isMcpToolServer`/`parseMcpServerName`) | A | One consistent server identity; discover tools via `tools/list`, not name parsing | resolved |
| A-4 | `lib/execution/mcp-client.ts:57` | `if (serverName !== "gmail")` in the stdio transport factory | A | Transport from per-server registration config | resolved |
| A-5 | `lib/mcp-catalog.ts:58`, `lib/registry/curated.ts:42` | Catalog `gmail-draft-mcp` vs engine identity `gmail`/`mcp:gmail:*` — mismatch makes Gmail UI-unreachable | A | One server identity catalog→grant→engine | engine identity resolved; catalog seeding + connect UI deferred (F-3) |
| A-6 | `lib/execution/tools/registry.ts` | Legacy string-input web-search executor — a parallel non-MCP execution path | A→F | Prefer MCP search server; if none, keep behind the generic interface with a recorded F-decision (F-2) | deferred (F-2) |
| C-1 | `lib/llm/index.ts:12–15` (env keys) vs `lib/execution/provider.ts` (BYO keys) | Two model-key systems: planning uses env keys, runs use BYO keys | C | Unify behind one interface + document; see F-1 | resolved (documented) |
| D-1 | `lib/execution/run-engine.ts:196,600`; `components/mock-data.ts:321–335` | `a2a_handoff` event + "A2A handoff" labels — bespoke linear text handoff, **not** the A2A protocol | D | Honest rename of human-facing labels + roadmap marker; keep behavior (DB enum value left in place to avoid a migration; flagged) | resolved |
| D-2 | `components/a2ui/EventCard.tsx`, `components/a2ui/a2ui.css`, `components/control/ControlPlane.tsx` | "A2UI · agent-to-user interface" — bespoke event-card rendering, **not** a real surface protocol | D | Honest naming on human-facing captions + roadmap marker; folder/identifier rename deferred to avoid churn (flagged) | resolved (identifier rename flagged) |
| E-1 | `lib/execution/mcp-client.ts` (`Client`, `initialize → tools/list → tools/call`) | Real MCP client core | E | **Protect.** Do not rewrite. The generic path (A-1..A-5) builds *around* it | n/a |
| E-2 | `app/api/workflow-runs/simulate/route.ts` | Run preview / simulate path | E | **Live caller confirmed**: `components/build/Builder.tsx:241` `runPreview → simulateRun`. Not dead. Keep. | n/a |

---

## Detail

### A-1..A-5 — Gmail special-casing & identity mismatch (the core remediation)

Chunk 9's MCP client core is correct (E-1), but Gmail was bolted on with:
- a token-injection branch keyed on the literal string `"gmail"`
  (`run-engine.ts:507`),
- an `ALLOWLIST` of connectable server names (`mcp-client.ts:32`),
- a `mcp:<server>:<tool>` **name-encoding hack** used to identify MCP tools and
  split server/tool (`mcp-client.ts:42–55`), and
- a stdio transport factory that only knows how to launch `"gmail"`
  (`mcp-client.ts:57`).

Worse, the **catalog identity does not match the engine identity**: the catalog
ships `gmail-draft-mcp` (`mcp-catalog.ts:58`, `curated.ts:42`) while the engine
only executes servers named `mcp:gmail:*`. No live (non-test) code ever creates
`mcp:gmail:*` `McpServer` rows, so **Gmail is reachable only from tests, never
from the UI** — the exact symptom this chunk exists to fix.

**Action (Phase 2):** model an MCP server as a registered, connectable entity
(transport + auth config) whose tools are discovered via `tools/list` and are
each individually grantable under the existing grant model, with **one** server
identity flowing catalog → grant → engine. Gmail becomes the first registered
instance with **zero** Gmail-specific code; a second server requires only
registration, no new execution code. Governance (gate, trifecta, caps, kill,
revoke/re-gate) unchanged.

### A-6 / F-2 — Legacy web-search executor (parallel path) — DECISION RECORDED

`lib/execution/tools/registry.ts` runs web search via a bespoke
`(input: string) => {output, costCents}` executor.

**F-2 decision (Phase 3): keep search behind the generic interface; do not add a
dependency-bearing MCP search server in this pass.** Rationale:

- No first-party or vetted MCP search server is available without introducing a
  new external dependency and a new trust surface (arbitrary third-party MCP
  registration is explicitly out of scope this chunk).
- The legacy path is **not a per-server special-case**: `executeAllowedTool`
  routes by a **registry lookup** (`getExecutor(server.name)`), the same generic
  "is there an executor for this tool" interface — there is no `if name === ...`
  branch. The MCP path and the executor path are two implementations behind one
  dispatch, not a special-cased server.
- Search behavior is unchanged and still green (web-search + red-team tests).

**Follow-up (future chunk):** when a trusted MCP search server exists, register
it like Gmail and delete the bespoke executor so only `tools/call` remains.
Status: **deferred (recorded F-decision).**

### C-1 / F-1 — Two model-key systems — DOCUMENTED (one deliberate design)

`lib/llm/index.ts` `getProvider()` reads **env** keys and powers ONLY flow
*planning* (`POST /api/flows/plan` — confirmed the sole caller);
`lib/execution/provider.ts` `getRunProvider()` reads the user's **BYO** key for
real *runs*. **Phase 5 action taken:** documented the two sources as a deliberate
design at `lib/llm/index.ts` (planning = system env fallback so a user can plan
before adding a key; runs = the user's own key, so inference cost is always
theirs). Not consolidated to a single key, because that would remove
plan-before-BYO onboarding. Status: **resolved (documented); F-1 confirms keeping
env-key planning as the system fallback.**

### B — Dead / demo / orphaned code — INVESTIGATED, no safe deletions this pass

Per the rubric, a candidate is Category B only if it has **no live caller**.
- `app/api/workflow-runs/simulate/route.ts` → **live** (Build → "Run preview" via
  `components/build/Builder.tsx`). Category **E**, kept.
- `components/mock-data.ts` (demo seeds/labels) → **live** (imported by Shell,
  Builder, Store, Library, palette, MemorySection, etc.). Not orphaned; the
  mislabeled strings in it were handled under D-1/D-2.
No export was found with zero live callers that could be deleted safely in this
pass. A dedicated dead-code sweep (cross-file export usage) is a better tool for
this than the conformance audit; recorded as a future cleanup, not forced here.

### D-1 — "A2A handoff" is not A2A

Inter-agent handoff passes the previous agent's final text forward as untrusted
data (`run-engine.ts` handoff path), recorded as `a2a_handoff` and surfaced as
"A2A handoff". This is a bespoke linear handoff, not the A2A protocol (no
AgentCard, no task lifecycle, no transport). **Action (Phase 4):** rename
human-facing labels to honest naming (e.g. "Agent handoff") and add a roadmap
marker that real **A2A** replaces this in a future chunk. Behavior unchanged. The
DB enum value `a2a_handoff` is left in place (renaming it is a migration and
behavior-adjacent) and flagged here.

### D-2 — "A2UI" is bespoke rendering

`components/a2ui/*` render agent-originated events as cards; the UI calls this
"A2UI · agent-to-user interface". It is real, working rendering but not a surface
**protocol**. **Action (Phase 4):** honest naming on human-facing captions +
roadmap marker for real **A2UI** later. A full folder/identifier rename is
deferred to avoid wide churn and is flagged here.

### E-1, E-2 — Conforming / live; do not touch

- **E-1:** the MCP client core conforms (`initialize → tools/list → tools/call`).
  Protect it; the generic path is built around it, not by rewriting it.
- **E-2:** the simulate/run-preview route has a confirmed live caller (Build →
  Run preview). It is **not** dead code; leave it.

---

## Methodology

Each finding was located by grep across `lib/`, `app/`, `components/`, `servers/`
and verified for live callers before classification. When uncertain between two
categories, the more conservative (closer to F) was chosen, per the rubric.
# Planner Drop-Point Audit (Chunk 19 Phase 0)

Every point where a plan element can currently be dropped or degraded silently,
and what the user sees for each (usually: nothing). This is the identity-by-string
disease, third location — the engine was fixed in Chunk 16; the planner still
binds by display string.

## Where plans lose things today

| # | Point | Mechanism | What the user sees |
|---|-------|-----------|--------------------|
| 1 | `resolve.ts` agents (~45-66) | Model-emitted `agentName` exact-matched (lowercased) against snapshot names; misses are **dropped** with a `warnings[]` string. A plan can lose ALL agents and still "resolve". | Nothing in the workspace describe path; a toast count in the Builder ("N item(s) adjusted"). |
| 2 | `resolve.ts` tools (~75-90) | `serverName` exact-matched by display name (`toolByName`); misses **dropped** with a warning. The engine dispatches on `mcpServerKey:mcpToolName`, but the planner still binds by display string. | Same — warnings array footnote at best. |
| 3 | `resolve.ts` memory (~93-101) | Partition-name exact match; misses dropped. | Same. |
| 4 | `resolve.ts` approval gates (~104-125) | Gates on removed agents are dropped or silently re-pointed to the "nearest" agent. A send-approval gate can migrate to a research step. | Warning string only. |
| 5 | `prompt.ts` EXAMPLE (~57) | Hardcoded example teaches `"Search MCP"` and `"Company Research Agent"` — names that only exist if the demo seed ran. A model copying the example emits references that hit drop #1/#2 for real users. | Nothing. |
| 6 | `prompt.ts` contract | "Copy names verbatim" + resolver exact-match = one rename (the Chunk-16 scenario) breaks planning silently. No canonical id anywhere in the prompt or response schema. | Nothing. |
| 7 | Plan route `ensureSearchAttached` | Regex-on-goal + name-regex-on-catalog patch that quietly ADDS a tool. Benign direction, but it papers over drop #2 for the search case only, by name matching again. | A warning string. |
| 8 | Plan route response | `warnings[]` is returned but the **workspace describe-to-build path** (`FlowWorkspace.handleDescribe`) calls `planFlow` → `saveFlow` immediately, never reading `warnings`. Silent by construction. | Nothing at all. |
| 9 | `clamp.ts` downgrades | Permission clamps (requested → effective) recorded as warnings. Legitimate, but buried in the same never-shown array. | Builder-only toast count. |
| 10 | `workflows/route.ts` `resolveWorkflowAgents` (~45-115) | Unknown agent names are **auto-created**; anything else unresolved lands in `skippedAgents` — returned in the response body, ignored by callers. `createFlowSchema.agents` is `optional()` — a flow with **zero agents saves fine**. | Nothing; later, "Flow has no agents to run" at run time. |
| 11 | `workflows/route.ts` `resolveWorkflowTools` (~117+) | Unknown `mcpServerId`s are skipped (`skippedTools`), returned, ignored. | Nothing. |
| 12 | Run start | The queue's "no agents" guard fires with an unexplained error, long after the cause (a fully-dropped plan silently saved). | "Flow has no agents to run" — mystery-broken shell. |

## The shape of the fix (Phases 1–4)

1. **Plan by canonical identity** — tools referenced by the Chunk-16 execution
   identity `mcpServerKey:mcpToolName`; agents/memory by stable catalog ids; the
   prompt enumerates keys; the example is generated from the live snapshot.
2. **Resolution report + re-plan loop** — every miss is a first-class failure:
   one automatic feedback re-plan, then a loud user-facing error. No silent drops.
3. **Goal-capability validation** — capability tags derived from canonical
   identity/risk; research goals must resolve a `search` tool, send goals a
   `send` tool + gate — validated server-side, generic over the catalog.
4. **Save/run integrity** — zero-agent saves refused (400 + report); skipped
   agents/tools become response errors the UI must show; existing empty shells
   flagged "needs re-plan".

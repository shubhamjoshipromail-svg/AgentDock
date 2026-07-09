# Planner Integrity (Chunk 19) — plans that resolve by construction

The planner used to bind by display strings, silently drop whatever missed, and
save empty shells. It now matches the engine's Chunk-16 integrity: one canonical
identity, loud failures with self-correction, capability validation, and save
integrity. (The before-state is catalogued in `planner-drop-audit.md`.)

## Plan by canonical identity (no new identifier)

- Tools are referenced by the **Chunk-16 canonical execution identity** —
  `mcpServerKey:mcpToolName` (`search:web_search`, `gmail:send_email`) — the same
  value the engine dispatches on and grants resolve to. Agents/memory use their
  stable catalog ids ("participant identity"; the same field later binds external
  A2A/NANDA participants by their protocol-native id). DB UUIDs stay internal FK
  plumbing; display names are never authoritative.
- The snapshot serves `key/id — name — description` per entry; the response
  schema requires the key/id (`agentId`, `key`, `partitionId`) and marks them
  AUTHORITATIVE. Metadata-only rows (no executable identity) are listed as "not
  connectable yet — do NOT select" and refused at resolve time.
- The prompt **example is generated from the live snapshot** — it can never teach
  a dead name. Empty catalogs get placeholders that cannot be mistaken for real
  identifiers.
- The resolver binds by key/id first; a normalized (case/punctuation-insensitive)
  alias fallback derived from the row's own identities covers legacy name forms —
  renaming a displayName can never break planning again.

## The resolution report + automatic re-plan loop

`resolvePlan` returns `{ plan, warnings, failures }`. Failures are first-class:
`{ kind, asked, reason, closestMatches }` (trigram "did you mean" over canonical
keys + display names). The route:

1. Resolves + auto-repairs (read-only search attach for research goals; approval
   gate auto-add for send plans — both visible as warnings).
2. If anything failed — or a required capability is missing but available — it
   runs **one automatic feedback re-plan** with the failure list injected, and
   adopts the result only if strictly better.
3. Whatever remains is surfaced in the response `report: { attached, clamped,
   failed, replanned }` (and mirrored into `warnings`). The workspace renders the
   report before saving; **a plan with failures or zero agents does not auto-save.**

No path exists from "model asked for X" to "X quietly absent."

## Goal-capability validation

`lib/orchestrator/capabilities.ts` derives tags from data (never per-tool code):
`send` = the Chunk-16 `isExternalSend` flag; `draft` = draft-shaped identity or
draft-only permission; `search` = read/lookup-shaped identity. Required
capabilities derive from the goal — explicit research/lookup verbs ⇒ `search`;
explicit send verbs ⇒ `send`; draft/compose without send ⇒ `draft`. Two tiers on
purpose: the broad research regex only drives the harmless auto-attach; the hard
requirement uses explicit verbs, so a memory-only "summarize my notes" goal stays
plannable with zero tools. A capability the catalog cannot satisfy short-circuits
to an actionable error ("no send-capable tool is available or connected — connect
one first") without wasting a model call.

## Save & run integrity

- `POST /api/workflows` refuses a zero-agent save (400 + skipped detail) for both
  `agents: []` and an omitted field — empty shells are structurally impossible.
- Partial saves (skipped agents/tools/memory) return an explicit message the
  workspace surfaces as an error naming what was skipped.
- The run guard's message is actionable, and existing zero-agent flows are
  flagged live in the UI: the selector shows "(needs re-plan)" and the
  participants column offers one-click "Re-plan from this goal".

## Scale

Selection is constrained-choice by enumerated key — verified by a 34-tool padded
catalog test (id resolution 100%, capability validation exact, zero per-tool
code). Ranked/filtered snapshots for 500+ tool catalogs are the next layer.

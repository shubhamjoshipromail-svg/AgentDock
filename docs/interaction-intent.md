# The Interaction Intent (A2UI) — one primitive, approval included

Agents can ask the human things mid-run — pick from options, fill a short form,
confirm a go/no-go — and the run continues with the answer. This is built as ONE
primitive, not a second system beside approvals: **approval is one intent type.**

## The primitive

An interaction intent lives in the `approval_requests` table (kept for
back-compat; it IS the intent table):

```
{ runId, stepIndex, intentType, payload, status, response, ... }
intentType : approval | choice | form | confirmation
status     : pending -> approved|denied|edited (approval) | responded (others) | expired
```

One pause/resume spine, one resolve route, one renderer registry:

- **Pause.** In `runStep`, an `approval_required` gate decision creates an
  `approval` intent; an agent envelope `{"type":"intent","intentType":"choice|form|confirmation","payload":{…}}`
  creates the matching A2UI intent. Both set the run `paused_for_approval` and
  return `{ kind: "paused" }` — identical worker semantics.
- **Resolve.** `POST /api/approvals/:id/resolve` handles both: an approval takes a
  `status`; a choice/form/confirmation takes a `response` (validated server-side
  against the payload), stored, and the run is re-enqueued.
- **Resume.** `resumeAfterApproval` branches on `intentType`: an approval
  authorizes and executes the pending tool (idempotent, Chunk 18 Phase 1); a
  choice/form/confirmation injects the human's response as **framed untrusted
  data** and continues forward. Neither replays the paused step's handoff/memory.

## The component vocabulary (the surface)

`components/workspace/IntentSurface.tsx` is a fixed whitelist renderer — NOT an
interpreter — in the run column:

- **choice** — option cards, single- or multi-select, `min/max` enforced.
- **form** — typed fields (`string` / `number` / `select`), required checks.
- **confirmation** — proceed / abort with optional context.
- **approval** — the exact-action authorization card (now one renderer among peers).

A payload is validated (Zod) at creation AND re-validated before render; an invalid
surface renders an honest error card — never a best-effort guess, never raw JSON.

## Security model

- **Schema-constrained, never arbitrary.** `lib/execution/interaction-intent.ts`
  defines strict schemas: bounded strings, capped option/field counts, whitelisted
  field types, `.strict()` (no extra keys). **No HTML, no markdown-as-UI, no URLs
  to external forms, no code** anywhere in the payload path. The renderer only
  knows these shapes.
- **Validated in, framed out.** The human response is validated against the
  payload (selection ids must exist, counts within `min/max`, form types checked),
  then re-enters the run via `frameIntentResponse` as bounded `<untrusted>` data —
  exactly like tool output, never as instructions to the agent.
- **Choice ≠ authorization.** Answering a choice/form/confirmation is not consent
  to a consequential action. A send after a choice still raises its own `approval`
  intent and passes the policy re-check on resolve. The gate is unchanged.
- **Lifecycle.** A terminal run (kill / cost-halt / error-halt) expires its pending
  intents — no orphaned `pending` rows that can never be answered. A resolved
  approval is unique per (run, step, action) (Phase 1 partial unique index), so no
  duplicate cards.

## Model contract

Agents emit intents with the same envelope discipline as tool calls (examples in
the system prompt). Ask only when it materially changes what you do; otherwise act.
The two seeded showcase flows — "Research → you choose → email your picks" and
"Brief → form → draft" — demonstrate search→choice→governed-send and form→draft
end-to-end through the real engine.

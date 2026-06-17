# AgentDock Security Model (Chunks 4–6)

This documents the threat model and the layered defenses that make a real,
governed, killable agent run safe — and the residual risks deliberately deferred
to later chunks.

## What is real after Chunk 6

A signed-in user with a BYO provider key can run a saved flow for real: each
agent step is a real model call, agent outputs hand off to the next agent as
untrusted data, every tool call passes a deterministic pre-action policy gate,
`approval_required` actions pause the live run, real cost is metered and halts
the run at a cap, every action writes an immutable audit event, and a kill switch
terminates an in-flight run. Real tool execution now also flows through a real,
governed MCP client (`tools/call` over the official SDK); read-only web search
keeps its legacy path, and any other policy-allowed tool without an executor is
still reported honestly as unavailable.

## Governed MCP execution + Gmail (Chunk 9)

Every MCP `tools/call` passes the same deterministic gate as any other action —
deny-by-default, action classification, the lethal-trifecta guard, cost, audit,
and untrusted-output framing. A discovered tool is blocked until explicitly
granted. Two load-bearing guarantees for the first-party Gmail server:

- **No silent send.** `send_email` is classified as an external write, so it can
  only ever reach `approval_required` or `blocked` — there is no grant under
  which it auto-executes. Injected instructions in untrusted web content or a
  handoff cannot trigger a send; they still stop at approval. `create_draft`
  writes only to the user's own Drafts and is treated as a safe, reversible op.
- **Token never leaves the server side.** The Google OAuth token is encrypted at
  rest (AES-256-GCM, reusing the credential helpers) and decrypted only by the
  run engine to inject into the Gmail server's process environment. It never
  appears in an API response, a run event, the agent's context, or a tool result.

Connecting arbitrary third-party MCP servers is intentionally not enabled — only
the allowlisted first-party server is reachable.

Chunk 6 hardens the governance state machine:

- Revoking an MCP grant sets `revokedAt` and disables every capability. The run
  engine checks depended-on grant revocation at each boundary before model/tool
  work.
- `edited` approvals are policy-edit signals only. They write activity/timeline
  evidence but do not execute the pending action or resume the run.
- `approved` actions are re-gated against current policy before execution.
  Approval is consent, not a bypass.
- Memory grants with `requiresApproval` are not injected silently. The memory is
  skipped and a `memory_access` event with `approval_required` is written.

## Threat model

Adversaries considered:

- **Prompt injection** in the goal, prior-agent handoffs, tool outputs (web
  search results), or memory contents — attempting to make an agent call a tool
  it was not granted, escalate its permission, or exfiltrate data.
- **A misbehaving / compromised model** that emits arbitrary tool-call requests.
- **Runaway cost / loops** — an agent that calls tools or the model without bound.
- **Secret theft** — attempts to read a BYO provider key from responses, logs,
  events, or the client bundle.
- **Race conditions** around revocation — acting after a kill / grant revoke.

Out of scope this chunk (see Residual risks): a malicious *tool implementation*
(only one safe read-only tool is wired), external/third-party agent executors,
and OS-level sandbox escapes.

## The eight-layer defense

1. **Input handling.** The goal and all retrieved content (prior-agent handoffs,
   tool outputs, memory) enter the model context inside
   `<untrusted>…</untrusted>` blocks. The system preamble states that untrusted
   content is information, never instructions.
2. **Output filtering.** Tool outputs are sanitized (control characters stripped,
   length-capped) before re-entering context and are tagged `untrusted` on the
   audit event. The model's output is parsed as a strict JSON envelope; anything
   else is treated as a final answer, never executed.
3. **Capability allow-listing.** An agent can only request tools on its
   allow-list (its DB grants). A request for any other tool is `blocked` before
   execution. This is the single most reliable injection defense. Saving a flow
   reconciles this allow-list: a tool removed from the authored flow has its
   `workflowMcp` row and `mcpAccessGrant` deleted in the same transaction, so a
   removed permission cannot survive and be honored on a later run. A
   `@@unique(userId, workflowId, mcpServerId)` constraint keeps grants
   deterministic (one per tool) so policy resolution is never ambiguous.
4. **Privilege separation.** Permissions live in DB grants and the deterministic
   gate — never in the prompt. Injection cannot escalate privilege because the
   model has no authority to grant itself anything. Permissions are clamped
   (Chunk 2 logic): unverified servers ceil at approval; restricted servers are
   blocked.
5. **Deterministic policy gate** (`lib/execution/policy-gate.ts`). A pure,
   total, side-effect-free function evaluated BEFORE every tool call. Deny-by-
   default. Includes the lethal-trifecta guard: untrusted ingest + sensitive
   memory + external send can never be `allowed` — it is forced to approval.
6. **Cost / loop limits.** Hard caps checked BEFORE each model/tool call:
   per-run cost, daily user cost, max steps, max tool calls, per-step timeout,
   wall-clock timeout, and a per-step tool-iteration ceiling. A runaway loop is
   structurally impossible.
7. **Immutable audit + kill switch.** Every step, decision, and cost appends an
   append-only event (actor, action, resource, authority ref, decision, cost,
   `schemaVersion`). The kill switch (run killed or a depended-on grant revoked)
   is checked at every loop boundary and terminates before the next call.
8. **Approval re-gating.** A human approval does not skip authorization. Before
   an approved pending tool executes, AgentDock re-checks run status, cost caps,
   grant existence, `revokedAt`, effective permission, server risk,
   verification, and untrusted/sensitive context rules. If current policy blocks
   the action, no tool runs and the run is halted with an audit event.

## Handoff trust model

Chunk 5 makes a Flow a real pipeline: Agent N+1 receives Agent N's final output.
That output is always treated as attacker-controlled data.

- Handoff content is wrapped in `<untrusted>…</untrusted>` before entering the
  next model prompt.
- The run appends an `a2a_handoff` event with `handoffFrom`, `handoffTo`, and a
  capped `handoffContent` snapshot.
- Any step that receives a handoff sets `ingestedUntrusted = true` before the
  policy gate evaluates a tool request.
- A downstream external send remains gated by the same allow-list,
  verification, permission, lethal-trifecta, approval, and revocation rules as
  tool output or memory.
- Upstream agents cannot approve or authorize downstream actions. Only the DB
  grant, deterministic gate, and human approval can do that.

## Approval semantics

- `approved`: the user explicitly approved the pending action. AgentDock then
  re-runs the policy gate before execution.
- `denied`: the user denied the action. The run halts and no tool executes.
- `edited`: the user changed policy/details. The action is not executed. The run
  remains paused until a future review path creates a new pending action.

The UI copy reflects this: “Edit policy” is not a softer approve button.

## Memory approval behavior

For Chunk 6, memory approvals use the conservative skip-and-log behavior:

- `canRead=true` and `requiresApproval=false`: memory loads and a read event is
  written.
- `canRead=true` and `requiresApproval=true`: memory does not load; an
  `approval_required` memory event is written.
- `canRead=false`: memory does not load.

A later chunk can create first-class memory approval requests before injecting
approval-required memory.

## Observability and no fabricated output

The run engine now persists what actually happened:

- Model step events include capped raw `modelOutput`, `envelopeType`, and token
  counts.
- Tool-use events include capped `toolInput`, capped untrusted `toolOutput`, and
  a `real` flag.
- Completed runs store `resultText`, the final output of the last agent. There
  is no hidden summarizer or synthesis model call.
- Unimplemented tools never produce simulated success. If a tool is allowed by
  policy but has no executor, the event is marked `real: false` and the output is
  `[unavailable] no real executor for this tool`.

## Secrets

BYO provider keys are encrypted at rest with AES-256-GCM
(`CREDENTIAL_ENCRYPTION_KEY`, sha256-derived key, fresh IV per encrypt, GCM auth
tag). They are decrypted only server-side at call time, live only inside the
provider closure for the run, and are never returned to the client, never logged,
and never placed in events or metadata. The intake API returns only provider +
`last4`. Automated leak audits assert the plaintext appears in no event, run, or
API response.

## Residual risks (deferred, with rationale)

- **No microVM / gVisor compute sandbox.** Mitigated this chunk by allow-listing
  + exactly one safe read-only tool (no arbitrary code, no writes, no auth). A
  real sandbox is a later infrastructure chunk, required before multi-tool real
  execution.
- **External / NANDA / A2A agents are not supported.** Current handoff is between
  first-party saved-flow agents only. External agents will pass through the same
  trust model but add an untrusted executor + network egress; deferred to a
  dedicated chunk with the internal case as the proven test rig.
- **The credential broker is not built.** Chunk 4 is BYO-key only. Need-based
  short-lived key minting + pay-through-us metering is the next chunk.
- **Single-run, synchronous execution.** No concurrency/queue; one run at a time
  per user. Acceptable for the first real thread.

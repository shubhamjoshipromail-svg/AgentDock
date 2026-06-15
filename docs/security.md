# AgentDock Security Model (Chunks 4–5)

This documents the threat model and the layered defenses that make a real,
governed, killable agent run safe — and the residual risks deliberately deferred
to later chunks.

## What is real after Chunk 4

A signed-in user with a BYO provider key can run a saved flow for real: each
agent step is a real model call, agent outputs hand off to the next agent as
untrusted data, every tool call passes a deterministic pre-action policy gate,
`approval_required` actions pause the live run, real cost is metered and halts
the run at a cap, every action writes an immutable audit event, and a kill switch
terminates an in-flight run. Exactly one real tool exists (read-only web search);
all other policy-allowed tools are reported honestly as unavailable until an
executor exists.

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

## The seven-layer defense

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
   execution. This is the single most reliable injection defense.
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

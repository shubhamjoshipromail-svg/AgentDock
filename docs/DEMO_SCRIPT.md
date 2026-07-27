# Demo script — conveying the platform vision with what actually exists

Audience: technical, likely to probe. Goal: convey the **idea**, not prove a finished
product. Length: ~4 minutes.

---

## The one-sentence positioning

> **Not an agent. The rail every agent action routes through** — permissions,
> approvals, audit, spend, kill switch — so a non-technical person can let an agent
> act without trusting it blindly.

Say this at the start and again at the end. Everything in between is evidence.

## The argument that makes a small demo credible

A technical viewer's real question is *"why is this just a governed email runner?"*
Answer it before they ask, using the sequencing:

> "Independent agents, from different parties, spending real money on someone's
> behalf is the most dangerous thing you can build. It is only safe if the control
> plane exists first. So I built the control plane. The coordination layer is what
> it makes possible — and it's the part that doesn't exist yet, deliberately."

This converts a small surface into evidence of judgment. Stripe shipped charges
before Connect. Never apologise for the order.

---

## Act 1 — Frame (15s, no screen)

"Agents can act now. They can send, buy, post, delete. Almost nothing can prove
what one did, or stop it mid-act. That's the layer I'm building."

## Act 2 — Composition: the glass box (30s)

Type a goal in plain English. Show the planner producing a **flow**: named steps,
each with its own tools and its own permission level.

> "An agent is a black box — you give it a goal and hope. A flow is a glass box:
> every step inspectable, every permission set independently, by someone who can't
> code. That distinction is about governance, not capability."

**Point at:** the per-step tool list and permission badges.

## Act 3 — It asks you something (30s)

Run it. Real web search executes. Mid-run it stops and asks a question.

> "It didn't guess. It asked. And my answer flows back in as *data* — framed
> untrusted — not as instructions it obeys."

**Point at:** the choice surface, then the audit line showing the response was
recorded.

## Act 4 — The consequential moment (45s) — THE BEST 10 SECONDS YOU HAVE

The approval card shows the real recipient, subject, body.

**Edit one word. Approve.** The run **halts** and demands a re-run.

> "What you approved is exactly what runs. You cannot approve one thing and have
> another execute. Most human-in-the-loop is theatre — you edit, and it sends the
> edited thing, which means the approval authorized nothing."

Then re-run, approve cleanly, show the real email arrive.

## Act 5 — The refusal reel (60s) — the credibility core

Rapid fire. These are the moments that say *infrastructure*:

| Show | Say |
|---|---|
| Spam the Run button 5× | "One run. That's not a disabled button — it's a database constraint." |
| Double-resolve an approval | "Resolves once. The second gets a conflict. A denial can't be replayed into an approval." |
| A tool that isn't granted | "Refused — and it tells you exactly why and what to do." |
| A grant scoped to *draft* attempting *send* | "The mandate refuses. Scope is deny-by-default: no scope means no authority." |
| Kill a run mid-flight | "Stops at the next boundary. Nothing further executes." |
| The audit trail | "Every step, every decision, real cost in cents. Append-only." |

## Act 6 — The platform claim (30s)

This is where "platform" has to land. Three true statements:

1. **One rail, differently-shaped actions.** "A read, a reversible write, and an
   irreversible external send — same gate, same audit, same kill switch, and the
   risk treatment differs automatically because the tool's identity says what it is."
2. **Adding a tool is data, not code.** Show the registration + connect → discover
   → grant flow. "No execution code was written for this tool. That's the substrate."
3. **The mandate is the payment primitive.** Show a grant's scope / limit / expiry /
   revocation. "This is the shape of a payment authorization. Today it governs an
   email. That's the only difference."

## Act 7 — Close on the vision (20s)

> "Every agent action — whoever wrote the agent, whoever owns the tool — routed
> through one rail that a human controls and can audit. Today it governs my inbox.
> The reason it can govern money next is that the gate, the mandate, and the audit
> already exist and are already enforced."

---

## What to say when probed (do NOT bluff)

Naming your own gaps is the most credible thing a governance company can do.

| Probe | Honest answer |
|---|---|
| "Can I plug in any MCP server?" | "First-party today. A third-party server is a process on my host — it needs isolation I haven't built: separate uid, read-only fs, egress allow-list. That's the next gate, and I won't ship it before then." |
| "Do you support agent-to-agent?" | "No. The gate is actor-agnostic by design, so an external agent slots into the same authorization path — but I haven't built the routing or discovery." |
| "Can it spend money?" | "Not yet. The mandate object is real and enforced — scope, limit, expiry, revocation. What's missing before money is signing the approved action so consent is cryptographically bound to it." |
| "How do you stop prompt injection?" | "Privilege never lives in the prompt. Tool output and human responses come back framed as untrusted, and authorization is a pure server-side function over database grants. Injected text can influence what the agent *asks for*; it cannot grant it." |
| "Isn't this just LangChain + approvals?" | "Frameworks help you *build* an agent. This governs one you didn't write, at runtime, with constraints in the database rather than checks in the app." |

---

## Pre-flight checklist (do this before recording)

1. **Re-authenticate with Google.** Tokens expire after 7 days while the OAuth app
   is in Testing — that is what killed the last run mid-send (`invalid_grant`).
   Publish the consent screen if you can.
2. **Use a fresh account** so the vetted flows carry the new goals (existing saved
   flows keep their old hardcoded topic).
3. **Enable real sending** in Profile — draft-only is the default, and without it
   no send tool is ever granted.
4. **Check `/api/health`** shows `db.ok` and `worker.ok` true.
5. **Pre-stage the denial.** Have a flow ready whose grant is scoped to draft, so
   the send refusal is one click away rather than improvised.
6. **Don't refresh mid-run on camera** unless you have verified run re-adoption.

## Known rough edges to avoid on screen

- The Build canvas has two "Plan" buttons with different save behaviour.
- Long tool lists are silently truncated in some panels.
- Only three executable tools exist — don't open a tool picker implying more.

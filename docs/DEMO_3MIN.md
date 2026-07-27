# 3-minute demo — setup, shot list, script

Audience: technical. Goal: convey the vision, not prove a finished product.

> **Record 8–10 minutes of raw footage and cut to 3.** Do not try to perform this
> live in one take. Runs take 30–90 seconds of real time; you will speed those up
> in the edit. Dead air is the only thing that can make this look weak.

## Recording decision — use two flows, not one fragile chain

Do **not** make the recording depend on Calendar → choice → search → Docs →
Calendar write → Gmail all succeeding in one run.

Use two honest, clearly separated clips:

1. **Composition proof (plan only):** type the ambitious five-tool goal and show
   the generated three-agent plan. This proves discovery, composition, canonical
   tool resolution, least privilege, and approval placement. Do not run it.
2. **Governance proof (run end to end):** run a concrete research → email goal
   using Web Search and Gmail. Use this run for approval, consent-integrity
   failure, successful re-run, kill/idempotency, and the audit trail.

Say this transition on camera:

> "That is the full composition. To show the execution rail without making you
> wait through five network calls, I’ll run a smaller version through the exact
> same permission, approval, and audit path."

This is stronger than pretending every screen belongs to one run. The platform
is the product; the task is only the vehicle.

### Exact goals to paste

**Composition-only goal**

> Look at my next three calendar events, let me choose one, research the company
> or topic, create a one-page Google Doc briefing, book a 15-minute review event,
> and email me the document link.

The plan should show:

| Step | Agent | Tools | Expected permission |
|---|---|---|---|
| 1 | Researcher | `calendar:list_events`, `search:web_search` | read only |
| 2 | Writer | `docs:create_doc` | approval gated |
| 3 | Coordinator | `calendar:create_event`, `gmail:send_email` | approval gated |

If those tools and permissions appear, the composition shot succeeded. The run
does not need to execute.

**Governance-run goal**

> Research three current approaches to securing AI agent tool use and email me
> a five-bullet brief with source links.

This has one read capability and one consequential action. It is enough to show
the entire governance thesis with much less live-demo risk.

---

## Part 1 — Setup (do this in order, the day you record)

Each step has a check. If a check fails, stop and fix it — every one of these has
bitten this app before.

**1. Re-authenticate with Google.**
Sign out completely, sign back in, approve the new permissions.
*Why:* Calendar and Docs scopes are new; your old token does not have them. Also,
while the OAuth app is in **Testing**, Google expires refresh tokens after **7
days** — that is exactly what killed the last run mid-send (`invalid_grant`).
**Check:** the consent screen lists Calendar and Docs, not just Gmail.

**2. Enable real sending, then reload the page.**
Profile → Real sending → on → **hard reload**.
*Why:* the session carries `sendingEnabled`. Without the reload the app still
thinks sending is off and will never grant a send tool — the flow silently drafts
instead. This is the single most likely way your demo quietly degrades.
**Check:** re-plan a send-shaped goal and confirm a send step appears.

**3. Add a provider key.**
Profile → Provider keys → add your Anthropic/OpenAI key.
**Check:** it shows with a last-4.

**4. Sync the tool catalog.**
Store → **Sync catalog**.
*Why:* this pulls the real MCP registry. An empty Store kills the App-Store moment.
**Check:** the result count is in the hundreds, with risk and verification badges.

**5. Connect all four servers.**
Connect → Gmail, Web Search, Google Calendar, Google Docs → **Discover** on each.
**Check:** each shows discovered tools. Calendar should show `list_events` and
`create_event`; Docs should show `create_doc` and `append_to_doc`.

**6. Clean the flow list.**
Archive old test flows. Old saved flows keep their **old hardcoded goals**, so a
stale one will not ask you for a topic and will look scripted on camera.
**Check:** the flow list shows only flows you want on screen.

**7. Health.**
`curl https://web-production-e123b.up.railway.app/api/health`
**Check:** `db.ok: true` **and** `worker.ok: true`. A 200 alone is not enough —
the web app stays up when the executor is dead.

**8. Refresh the managed agent prompts after deploying.**
The Calendar failure was not an access failure: the Researcher held
`calendar:list_events` but made zero tool calls and falsely claimed it lacked
access. The prompt fix requires agents to attempt an available tool before
reporting failure.
**Check:** deploy the fix, reload/sign in so `/api/bootstrap` updates the managed
Researcher, then confirm a Calendar practice run records at least one tool call.

**9. Rehearse the two clips separately. This is the real gate.**

- Plan the composition-only goal and verify the five expected tools. Do not run.
- Run the governance goal end to end: search → approval → send → audit.

Only the second rehearsal must succeed before recording.

**10. Treat Calendar and Docs execution as optional pickup shots.**
Their adapters are unit-tested, but a live Google call adds OAuth, payload, and
network risk that the core story does not need. If a separate practice call
works, capture the resulting Doc/event for B-roll. If it fails, get the worker
log (`railway logs --service worker`) after the core recording is safe.

---

## Part 2 — Shot list (capture these, in any order)

| # | Shot | Notes |
|---|---|---|
| A | Store, scrolling the synced registry | Get the risk/verification badges in frame |
| B | Connect → Discover on Calendar | The tools appearing is the moment |
| C | Composition-only goal → generated flow | Get all five tool + per-step permission badges; do not run |
| D | Governance goal → smaller generated flow | Make the transition between the two flows explicit |
| E | The approval card, full screen | Recipient, subject, body must be readable |
| F | **Edit a word → approve → run halts** | The money shot. Get it twice. |
| G | Re-run → approve cleanly → email arrives | Show the real inbox |
| H | Spam the Run button 5× → one run | Show the run list after |
| I | Kill a run mid-flight | |
| J | The audit trail, scrolling, with costs | Get the per-step cents in frame |
| K | Optional: created Doc/calendar event | Use only if separately proven against the real Google APIs |

### Best capture order

1. Successful governance run and the received email.
2. Consent-integrity halt after editing the approval.
3. Audit trail and idempotency/kill controls.
4. Five-tool composition plan.
5. Registry and discovery.
6. Optional Calendar/Docs B-roll.
7. Voiceover last.

Capture every important state for 5–8 seconds without moving the cursor. Record
notifications off, use a clean browser window, zoom until badges are readable,
and hide bookmarks or accounts you do not want in frame.

---

## Part 3 — The 3-minute script

### 0:00–0:15 — The problem *(no screen, or a black card)*

> "Agents can act now. They send, they buy, they post, they delete. Almost
> nothing can tell you what one actually did, under whose authority, or stop it
> half way through. That's the layer I'm building — not an agent. The rail every
> agent action routes through."

### 0:15–0:35 — The registry *(shot A)*

> "This isn't my tool list. It's the public MCP registry — hundreds of servers
> other people wrote. What's mine is the verdict beside each one: how risky it
> is, whether it's verified, and the most permission it's ever allowed to hold."

### 0:35–0:50 — Discovery *(shot B)*

> "Watch me add a capability to a running system. Connect, discover — and those
> tools are now governed and executable. No deploy. No code. The governance was
> already there waiting for them."

### 0:50–1:15 — Composition *(shot C)*

Type the goal, let it plan.

> "I describe what I want in plain English, and it composes a flow — three
> agents, each holding only the tools its step needs. A normal agent is a black
> box: you give it a goal and hope. This is a glass box. Nobody wrote this flow;
> it was composed against the tools I happen to have connected."

Point to the two read-only tools on Researcher, the document tool on Writer, and
the two approval-gated actions on Coordinator.

### 1:15–1:30 — Smaller run, same rail *(shot D)*

> "That is the full composition. To show the execution rail without making you
> wait through five network calls, I’ll run a smaller version through the exact
> same permission, approval, and audit path. It can research freely. Sending
> outside the system still requires me."

### 1:30–2:05 — Consent integrity *(shots E, F, G)* — **the core**

> "Before it sends anything, it shows me the exact action. Real recipient, real
> subject, real body."

Edit one word. Approve.

> "Now watch. I edited it — and the run **halted**. It refuses to execute
> something I didn't approve. Most human-in-the-loop lets you edit and sends the
> edited thing, which means the approval authorized nothing at all."

Re-run, approve cleanly, show the email land.

### 2:05–2:30 — The refusals *(shots H, I)*

Fast cuts.

> "Spam the run button — one run. That's not a disabled button, it's a database
> constraint. Resolve an approval twice — it resolves once. A denial can't be
> replayed into an approval. Kill it mid-flight — nothing further executes. Ask
> for a tool I never granted — refused, and it tells me exactly why."

### 2:30–2:45 — The audit *(shot J, optional K)*

> "A real email, and every step behind it: what ran, what it decided, what it
> cost, and which permission authorized it. The exact same rail governs the
> Calendar and Docs tools you saw in the composition."

### 2:45–3:00 — The vision and the honest boundary

> "Every one of those tools is governed the same way — same gate, same audit,
> same kill switch. The permission object behind it carries a scope, a limit, an
> expiry and a revocation. That's the shape of a payment authorization. Today it
> governs my inbox.
>
> Right now I'm the only publisher. What turns this into a platform is the day
> someone else publishes into it — and the only thing between here and there is
> isolation. I know exactly what that is, and I won't open it before it's built."

Do not call third-party process isolation or arbitrary MCP execution "sandboxed"
yet. Today the true claims are scoped permissions, approval gates, server-side
authorization, revocation, idempotency, kill control, and auditability.

---

## If someone probes

| Probe | Answer |
|---|---|
| "ChatGPT does this" | "It does the task. It can't let you run an agent *you didn't write* under permissions *you* set, revocable mid-act, with an audit trail you own. Its tools are its tools." |
| "Can I plug in any MCP server?" | "First-party today. A third-party server is a process on my host — it needs separate uid, read-only fs, egress allow-list. That's the next gate." |
| "Agent-to-agent?" | "Not yet. The gate is actor-agnostic by design, so an external agent slots into the same authorization path. The routing and discovery aren't built." |
| "Can it spend money?" | "No. The mandate is real and enforced — scope, limit, expiry, revocation. What's missing is signing the approved action so consent is cryptographically bound to it." |
| "Prompt injection?" | "Privilege never lives in the prompt. Tool output and human answers come back framed untrusted; authorization is a pure server-side function over database grants. Injected text can change what the agent *asks for*. It can't grant it." |

## Keep off screen

- The Build canvas (two "Plan" buttons, different save behaviour)
- The Memory tab (real, but thin — invites a question you'd rather take live)
- Any flow list with stale test flows in it

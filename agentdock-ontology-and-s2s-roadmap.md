# AgentDock — Ontology, Positioning & the S2S Gap

A reference document, not a build spec. It settles three things that have been causing confusion: (1) what AgentDock IS and is NOT, (2) the clean taxonomy of every concept in the product, and (3) the honest gap between what's built (a governed single-agent runner) and the vision (an S2S coordination substrate), with the chunk sequence to close it. Keep this at the repo root; every future chunk and pitch builds against it.

---

## 1. What AgentDock IS and is NOT (the positioning that resolves the confusion)

**AgentDock is NOT an agent builder.** It does not compete with LangChain, CrewAI, OpenAI's agent tooling, or the hundred frameworks for *building* agents. Building agents is a crowded, commoditizing space. Stay out of it.

**AgentDock IS the governed substrate that agents run ON and coordinate THROUGH.** The product is the trust-and-control layer: permissions, approvals, the policy gate, the kill switch, audit, spend caps, credential brokering, and — the destination — the safe coordination of independent agents (S2S) acting for a human or company. AgentDock is the road and the traffic control, not the cars.

**The analogy to hold:** Stripe is not a store; it's the payment substrate stores run on, and it ships demo checkouts to prove it works. AgentDock is not an agent or an app; it's the governance/coordination substrate agents run on, and it ships **vetted example flows** (like food delivery) to prove it works.

**Therefore: the food-delivery flow, the job-search flow — these are DEMONSTRATIONS and vetted catalog examples, NOT the business.** You build the substrate and a few flagship vetted flows that show it off. Third parties build the actual agents. The moment you feel pulled to "build the delivery agent," the correct move is "build the thing that lets anyone's delivery agent run safely, and ship one vetted example."

**What you sell:** governance + coordination + trust (verification, audit, control), metered/priced around governed activity — never the inference itself (customers bring their own model cost; you charge for the safety around it).

---

## 2. The ontology (clean taxonomy — stops the conceptual mud)

These are distinct, composable layers. Blurring them is what made the product feel muddy. Keep them clean and "unique combinations" fall out naturally.

**Tool (MCP)** — a *capability*. The smallest unit: "search the web," "draft an email," "read a calendar." Has a risk level, a verification status, a recommended permission. Tools don't act on their own; agents invoke them. (Source: the real MCP registry + AgentDock curation. Chunk 1.)

**Agent** — an *actor* that uses tools. Definition = `{ system prompt + model + allow-listed tools + memory grants + budget }`. Two kinds, same governance:
- **Internal agent** — AgentDock runs it (calls the model itself). What Chunk 4 executes.
- **External agent** — a third party runs it; AgentDock governs and routes to it (via its A2A AgentCard endpoint). Later chunk. *Same gates, different executor.*

**Flow** — a *composition*: agents + tools + memory zones + approval gates + budget, in an order. The saved, runnable, governable system. A flow can mix internal and external agents.

**Memory Zone** — partitioned, permissioned context. Agents see only what they're granted (the firewall). Bounds blast radius.

**A2A (agent-to-agent)** — the *protocol/mechanism* by which one agent hands off to or calls another agent (internal→internal now; internal→external later) inside a flow. A2A is how agents coordinate; it is governed by the same gate as any other action.

**A2UI (agent-to-user interface)** — the *human-facing surface an agent generates mid-run* to show information or request a decision (the "pick one of these 10 options" screen). NOT the static flow diagram — that's a builder visualization. Real A2UI = the agent produces structured UI intent → AgentDock renders it → the human's response flows back into the run. **This is currently missing and is the most vision-revealing next build.**

**Surfaces (how a flow gets triggered)** — the *entry points*: the AgentDock UI (click Run), the **CLI**, or an **API endpoint** (an external system or app calls AgentDock to run a governed flow). Same flow, multiple trigger surfaces.

**Governance layer (the constant under everything)** — the policy gate, approvals, kill switch, spend meter, credential broker, audit log. Every action by any agent (internal/external), every tool call, every A2A handoff, every transaction passes through it. **This is the product.** Everything above is composable; this is non-negotiable and universal.

**Mandate** — a signed authorization defining what an agent may spend/do, with scope/limit/expiry/revocation. The unit of trust for transactions. (Schema seeded in Chunk 4; the commerce/broker chunks make it real.)

**The "unique combinations" you wanted** come precisely from keeping these clean: any flow = any mix of internal/external agents + any tools + any memory + any gates, triggered from any surface, all under one governance layer. Clean layers compose; muddy ones don't.

---

## 3. What's built vs. the S2S vision (the honest gap)

**What's built = a governed single-user agent runner.** One user configures internal agents that perform tasks for them, with real execution, real governance, real cost, a real kill switch. (Chunks 1–4.) This is the *foundation*, and it's real.

**The vision = an S2S coordination substrate.** Independent agents — from different parties, discovered at runtime — coordinate on a human's behalf to accomplish real-world outcomes (the food-delivery example), with the human in control of every step and every dollar, through AgentDock's governance.

**The gap, named precisely.** The Domino's/food-delivery example requires five things we do NOT yet have:
1. **External agents** — coordinating with agents AgentDock didn't create. (Have: internal only.)
2. **A2A to external** — an agent calling another *agent* (not just a tool), across org boundaries. (Have: internal flow steps only.)
3. **Runtime discovery** — finding "restaurant agents near me" from a registry. *This is NANDA/A2A's real role* — not a catalog you browse, but how an agent finds another agent at runtime.
4. **Real A2UI** — the agent generating an interactive selection surface for the human mid-task and receiving the choice back. (Have: a static flow diagram, which is not A2UI.)
5. **Real transactions** — placing an order, paying, under a mandate with approval gates. (Have: mandate schema shape only.)

**Why the gap is correct, not a failure.** S2S — independent agents, from different parties, spending real money on a human's behalf — is the single most dangerous thing to build. It is only safe *because* of the governance foundation underneath it. You could not have built it first. What's built is not a detour from the vision; it's the safety layer the vision must stand on. You've been building the foundation — now you build the building, and it stands because the foundation is real.

---

## 4. The path from here to the vision (chunk sequence)

Each step reuses the governance already built. None requires re-architecting the foundation.

**Near-term, makes the substrate legible and the vision visible:**
- **Observability** — flow selector before running; live step-by-step run view (what each agent did/sent/got/decided, with real per-step cost); run history. Fixes "I don't know what it did." (Mostly frontend over existing data.)
- **Real A2UI** — agents generate interactive surfaces mid-run; human choices flow back. *The most vision-revealing build available now on the existing foundation.* This is the first moment the app feels like the substrate, not a task runner.

**Mid-term, turns the runner into a coordination substrate:**
- **External agents / A2A** — your agent calling another agent (internal→external), wrapped in the identical governance gates. Turns "flow of my agents" into "my agent coordinating with the world's agents."
- **Discovery (NANDA/A2A registries)** — runtime discovery of external agents to coordinate with. NANDA's real role finally appears.
- **The credential broker** — need-based scoped key minting + managed credits (pay-through-us); the moat; what lets external apps call AgentDock as an API.
- **Transactions / mandates** — real orders, real money, signed mandates, approval-gated. The commerce layer.

**The trust/quality engine (enabled by everything above producing real data):**
- **The Lab** — an internal red-team/security model that runs candidate flows/agents through adversarial scenarios against the real policy gate, scores them on risk/cost/security, and earns them a **verified** badge. This is your internal-orchestrator-ranking idea + the verification pipeline, combined. Only possible because Chunk 4 made runs real and the gate real.
- **Telemetry ranking** — rank agents/tools/flows by real behavioral data (success/cost/violation rates) from real runs. Your differentiator; impossible before real execution existed.
- **The Store as marketplace** — vetted, specialized, verified agents/flows (the "Amazon-products" idea), published by devs/users, carrying Lab verification + telemetry track records. The food-delivery flow lives here as a flagship vetted example.

**Later infra, when scale/risk demands:**
- **Local access** (filesystem/CLI/internal-API) for agents — the use case that most *justifies* the governance, needs real sandboxing (microVM/gVisor).
- **Multi-run operations view** — the air-traffic-control interface showing many governed flows running at once without overwhelming the operator. The flagship enterprise surface; build it once there's real multi-run activity to display.

---

## 5. The demo north star (changes from "job search" to coordination)

Job-search-automation is a weak flagship — niche, slow, single-agent. **Replace it with a simple, universal, multi-agent, transactional task** (food delivery is ideal: instantly legible, inherently multi-agent, needs A2UI, needs governed transactions). The one-sentence pitch becomes:

> *"Watch my agent coordinate three other companies' agents to order dinner — and watch me stay in control of every step and every dollar, with the power to approve, cap, or kill it instantly."*

Everything legible, the coordination obvious, the governance the visible hero. That sentence is the product. The food-delivery flow that demonstrates it is a vetted example you ship — not a business you're in.

---

## 6. Cost posture (the business answer to "$0.10 per run is expensive")

Two levers, one technical and one business:
- **Technical:** cheaper models for cheaper agent steps (Haiku-class, not Sonnet, for simple work — the multi-model design already allows this), tighter prompts/context per step, aggressive step/tool/cost caps, caching. A simple run should drop from ~$0.10 toward a few cents.
- **Business (the real answer):** **do not subsidize inference.** Customers bring their own model cost (BYO key) or buy metered managed credits at cost; AgentDock charges for *governance* — the control plane, the verification, the audit, the coordination — not the tokens. Thin-margin inference resale is a trap (OpenRouter already owns it). The control plane is the high-margin product. The customer's tokens are the customer's problem; their *trust in what the agent does with those tokens* is what they pay you for.

---

## Bottom line

The direction is right. The foundation is real. The confusion was mistaking the foundation (a governed agent runner) for the building (an S2S coordination substrate) — and mistaking the demo flows (delivery, job search) for the business (the governance substrate they run on). You are not an agent builder; you are the substrate agents run on and coordinate through, and you ship vetted examples to prove it. The next builds — observability, then real A2UI — make the substrate legible and start revealing the vision, on a foundation that can actually govern what comes next.

---

## 7. Addendum — the invisible rail, the App Store, and flow-vs-agent (settled)

**The altitude of the vision (say it this way).** AgentDock aims to be the **cheap, fast, lightweight, invisible trust-and-coordination rail that every agent action routes through** — the way nobody thinks about Stripe at checkout or DNS on page load. Stripe, Uber, Maps, anyone — their agents connect through AgentDock because that's where safety, trust, verification, and coordination live. Not using it becomes the weird choice. Combined with that: AgentDock is **the App Store / Play Store for the agent era** — where a company publishes its agent/tool because that's where vetted distribution, the verified badge, the governed runtime, and the users are.

**What must be cheap and invisible (the correct layer).** The thing that becomes near-zero-cost and near-zero-latency is **the governance cut** — the policy decision, the audit write, the mandate check, the routing. That is NOT inference; it's a permission decision and a log entry, so it genuinely can be fractions of a cent and milliseconds. That's the part that becomes invisible infrastructure everyone routes through. **Inference cost is explicitly NOT AgentDock's to bear or to make cheap** — it belongs to whoever runs the agent (BYO key or the publisher). Stop carrying inference cost as if it's the platform's burden; make *governance* nearly free and instant. The customer's tokens are the customer's problem; the trust around those tokens is what they route through you for.

**Why the App-Store play works (trust is the product, distribution is the reward).** Companies came to Apple's store not because Apple built their apps, but because that's where vetted distribution and user trust lived. AgentDock's equivalent: a company publishes through AgentDock because that's where the verified badge (from the Lab), the track record (from telemetry), the governed runtime, and the users are. You never build their agent — you make publishing-through-you the thing that makes their agent trustable and findable.

**Flow vs. Agent — the distinction that resolves the confusion (it's about GOVERNANCE, not capability).** Modern agents are already comprehensive — one agent can plan, use many tools, loop, accomplish a lot alone. So why flows?

- An **agent is a black box**: powerful but opaque and monolithic. You give it a goal, it does hidden internal work, you get a result. You can't see inside, control the middle, swap a part, or — critically — let a *non-technical* person reshape it. Its competence is internal and hidden.
- A **flow is a glass box**: a multi-agent system where **every modular point is independent, inspectable, and controllable by a non-technical user through AgentDock**, with the internal orchestrator assisting. The point of a flow is NOT that it's more capable than one big agent — it's that it's **transparent and governable**: see each step, set a permission per step, gate between any two steps, swap a node, cap spend at a node, kill at any point — without being a developer.

So: **the flow is the unit of governance.** A monolithic comprehensive agent is the thing customers are *afraid* of (blind trust); a flow is that same power broken into controllable, inspectable pieces. A comprehensive agent isn't a threat to the flow concept — it's just *one powerful node inside a flow*, wrapped in AgentDock's governance (permissioned, gated, capped, audited, killable). Agents are the powerful opaque actors; flows are how AgentDock makes them transparent and safe for normal people to run. The definition is a governance definition, never a capability one.

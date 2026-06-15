# AgentDock — Full Project Context (Handoff for a New Chat)

Paste this whole document at the start of a new conversation. It contains everything an assistant needs to continue helping with AgentDock without prior chat history: what it is, what's built, how we work, the vision, the open decisions, and what's next. Read it fully before responding.

---

## 0. How to help me (working agreement)

- I am a non-deeply-technical solo founder building AgentDock. I drive a coding agent (Claude Code, run in my terminal, interactively) using detailed prompt documents that the assistant writes for me. I paste those prompts into Claude Code; it edits my local repo and commits per phase.
- The repo is local at `/Users/shubhamjoshi/Desktop/Agent platform` (note the space — quote it in shell) and on GitHub at `shubhamjoshipromail-svg/AgentDock`.
- **The assistant's main job:** strategic thinking + writing comprehensive, phased, security-conscious build-prompt documents for the coding agent. Each prompt = ordered phases, hard constraints, explicit "do NOT" lists, acceptance gates, commit-per-phase, build+tests-green-always.
- Run prompts **interactively** in the terminal (`claude`), not autonomously — autonomous runs hit a capped credit pool and stall; interactive uses my subscription. Keep `npm run dev` open in a second terminal to watch UI changes land.
- **I am the final acceptance test.** Headless tools can't complete Google OAuth, so the signed-in experience and live LLM runs can only be verified by me. Always end build cycles by telling me exactly what to test live.
- Be critical and honest. I want real diagnosis, not flattery. Push back when I'm wrong. I value the assistant catching drift and naming hard truths.
- Files I'm given should be downloadable artifacts I can paste into the coding agent.

---

## 1. What AgentDock IS (the positioning — do not let this drift)

**Not an agent builder** (that space is crowded — LangChain, CrewAI, etc.). **AgentDock is the governed substrate that agents run ON and coordinate THROUGH** — the cheap, fast, lightweight, eventually-invisible trust-and-coordination rail every agent action routes through (the Stripe/DNS of the agent era), AND the App Store / Play Store for agents (where companies publish agents/tools to get vetted distribution, the verified badge, governed runtime, and users).

The product is the **governance + coordination + trust layer**: permissions, the deterministic policy gate, approvals that pause real runs, the kill switch, audit, spend caps, the credential broker, verification (the Lab), and — the destination — safe coordination of independent agents (S2S/A2A) acting for a human, with the human in control of every step and every dollar.

**What's cheap/invisible = the governance cut** (a permission decision + a log write — fractions of a cent, milliseconds). **Inference cost is NOT AgentDock's to bear** — BYO key or publisher pays; AgentDock charges for governance, never resells inference at a markup.

**Demo flows (food delivery, job search) are vetted EXAMPLES that prove the substrate — NOT the business.** AgentDock never builds the delivery agent; it builds the thing that lets anyone's delivery agent run safely, and ships one vetted example. (Stripe ships demo checkouts; it isn't a store.)

**Flow vs. Agent (governance distinction, not capability):** an agent is a powerful but opaque black box; a **flow is a glass box** — a multi-agent system where every modular point is independent, inspectable, and controllable by a non-technical user through AgentDock (set permission per step, gate between steps, swap a node, cap spend, kill anytime), assisted by an internal orchestrator. The flow is the **unit of governance**. A comprehensive agent is just one powerful node inside a flow, wrapped in governance.

---

## 2. Vision & monetization (the strategy, briefly)

- **North star:** the universal governed substrate for the agent economy — eventually every company/user/B2B/consumer agent interaction (S2S) flows through AgentDock safely; UI is generated on demand (A2UI); websites become less necessary because it's agent-to-agent.
- **Wedge to get there:** sell the governance gateway to teams/companies blocked from deploying agents by their security org ("we're the yes"). Land design partners with that exact pain.
- **Monetization (settled view):** enterprise governance tier (platform fee + usage on governed actions) is the real business; BYO-key now; the credential broker (need-based scoped key minting + managed "pay-through-us" credits) is the moat; verification-as-a-service (the badge) monetizes the supply side later; the App Store/marketplace + telemetry-ranked vetted agents is the long game. Never subsidize inference.
- **Adjacent big bets identified, deferred:** agentic-commerce mandates (AP2-shaped authorization — schema already seeded), and AI-agent insurance (AgentDock's audit log = the underwriting/evidence dataset; partner with carriers as a distribution channel, don't become the insurer).
- **Naming risk:** there is an established open-source project also called "AgentDock" — rename the product before it gets expensive (still pending).

---

## 3. Tech stack & repo facts

- Next.js 16 (App Router), React 19, TypeScript, Prisma 7, PostgreSQL (local via docker-compose), NextAuth 4 (Google OAuth, scopes `openid email profile` only), Vitest, Zod.
- Structure: thin `app/page.tsx` shell; components under `components/{layout,build,store,flows,control,profile,shared,a2ui}/`; `lib/types.ts` (single domain types source); `lib/api/client.ts` (typed fetch); `lib/validation/` (Zod per route); `lib/registry/` (MCP ingestion); `lib/orchestrator/` (planning); `lib/llm/` (provider abstraction); `lib/execution/` (run engine, policy gate, tools, memory). Dark "control-tower" design system in `app/tokens.css` + component CSS.
- ~120 tests, all green (mostly backend/logic; no component tests; frontend changes are safe vs. tests as long as `lib/` contracts hold). Run with `npm test`; build with `npm run build`. Tests use a real `agentdock_test` Postgres DB and mock the LLM/provider layer (suite passes with no API keys).
- Reliable commands always prefix with: `cd "/Users/shubhamjoshi/Desktop/Agent platform" && ...`

---

## 4. What's BUILT (chunk history, all committed & pushed)

**Foundation (phase0–F):** decomposed the 3,128-line monolith into a component tree; single types source; Zod validation on every route; per-user data isolation (`@@unique([userId,name])`); idempotent `POST /api/bootstrap` (GETs are pure reads); honest Flow persistence (the Builder saves real canvas state, not a hardcoded payload); generic simulation that walks `routeOrder` and derives decisions from grants; removed all "Job Search" hardcoding.

**Chunk 1 — real tool catalog:** real MCP ingestion from `registry.modelcontextprotocol.io` (~492 servers, capped); deny-by-default curation (external = unverified, medium risk, approval_required) enforced in `normalizeExternal()`; `McpVerificationStatus` enum; `recommendedPermission` typed column; searchable/filterable/paginated `GET /api/mcp/servers`; Store search/filters/sync; **all fake metrics (trustScore etc.) deleted.**

**Chunk 2 — the Orchestrator (first real model call):** `POST /api/flows/plan` makes ONE real LLM call (Anthropic/OpenAI behind `lib/llm/`), Zod-validates the FlowPlan, resolves names against the catalog, **server-clamps permissions** (model proposes, policy disposes), returns `PlannedFlowResponse` with `warnings` + `planMeta` (provider, model, tokens, costCents, durationMs); Builder renders editable plan cards; cost governance (per-call cap, daily cap, ActivityLog entries). Verified working live (~4¢, ~35s per plan).

**Chunk 3 + 3.5 — the redesign:** dark "control-tower" design system (tokens, primitives); workstation shell (left rail + top bar + independently-scrolling panels, no page scroll); ⌘K command palette; toast system; the **flow graph** (hand-built SVG, goal→agent-spine→tools/memory/gates); **A2UI EventCard grammar** in Control (who/what/on-what/authority/decision/cost); approvals consolidated to Control only; logo-led tool cards; killed legacy CSS + zombies; banner consolidation to one mode pill.

**Chunk 4 — first REAL execution (the milestone):** real run engine (`lib/execution/run-engine.ts`) executes a saved flow step-by-step on the user's **BYO encrypted API key**; each agent step is a real model call; the **deterministic pre-action policy gate** (`policy-gate.ts`, deny-by-default) authorizes every tool call BEFORE it runs; `approval_required` **pauses the live run** until a human decides (approve resumes, deny halts); ONE real read-only tool (web search via keyless DuckDuckGo, output tagged `<untrusted>`); the executor registry contains ONLY web-search (nothing else can execute); real cost metered against caps that **halt** the run; **kill switch** terminates mid-run before the next call; memory firewall bounds each step's context to granted partitions; immutable append-only audit events with actor/authority/decision/cost/schemaVersion; **mandate-shaped fields** (scope/limit/expiry/revoked/signature) on grants+approvals for the future broker/AP2 chunk. Phase H red-team suite passes (injection via goal + via tool output, trifecta forced-approval, runaway-loop halt, kill-switch race, secret-leak canary). `docs/security.md` written. ~51 new tests. **Security was the acceptance criteria, not features — and two real bugs were caught and fixed mid-build (kill-switch resurrection on resume; a grant defaulting to approval).**

**Current real-vs-simulated truth:** REAL = planning call, agent execution (model calls), ONE read-only tool (web search), policy enforcement, cost metering, approvals that block, kill switch, memory firewall, BYO-key. STILL SIMULATED/ABSENT = all other tools' real execution, external/NANDA agents, the credential broker, telemetry-based ranking, A2UI-as-interactive-surface (only a static graph exists), local/CLI access, multi-run ops view.

---

## 5. Known issues / honest gaps (as of now)

- **Observability gap (founder-reported):** after a real run, you can't easily tell which flow ran, choose the flow before running, or see step-by-step what the agent actually did — only a sparse "completed." Needs a flow selector + live step-by-step run view + run history.
- **A2UI is not real yet:** the "flow visualization" is a static diagram, not an agent generating an interactive surface for the human mid-run. This is the biggest gap vs. the S2S vision.
- **The runnable product feels thin:** an agent that thinks + does one web search isn't yet "worth governing" — needs richer real agent actions/tools to make runs meaningful.
- **UI premium feel:** improved a lot across 3/3.5, but a "Chunk 3.6" premium/consistency pass was scoped (elevation/light model to make flat dark read premium; unify Store Tools cards to match Agents cards; fit-to-view graph so flows aren't clipped; fix a warnings-strip overlap; kill remaining zombies). **This was PAUSED** — founder chose to prioritize substance over polish, possibly hand 3.6 to Codex, or do it later. The Chunk 3.6 prompt exists if wanted.
- **Cost:** ~$0.10 per trial run (real model tokens). Levers: cheaper models per step, tighter prompts, caps, caching — but the real answer is the business model (don't subsidize inference; charge for governance).
- **Per-run experience generally needs a "genius transparency interface"** for watching runs; and eventually a multi-run operations view (air-traffic-control) — but that's later, once single-run observability exists.

---

## 6. The path forward (sequenced; each step reuses existing governance)

**Near-term (make the substrate legible + start revealing the vision):**
1. **Observability** — flow selector before running; live step-by-step run view (what each agent did/sent/got/decided + real per-step cost); run history. Fixes "I don't know what it did." Mostly frontend over existing data. *(Strong candidate for the immediate next chunk.)*
2. **Real A2UI** — agents generate interactive surfaces mid-run (e.g., "pick one of these 10 options"); human choice flows back into the run. The most vision-revealing build available on the current foundation; first moment the app *feels* like the substrate. *(The other strong candidate for next.)*

**Mid-term (runner → coordination substrate):**
3. External agents / A2A (your agent calling another agent, internal→external, same gates).
4. Runtime discovery (NANDA/A2A registries — NANDA's real role: find agents at runtime, not browse a catalog).
5. The credential broker (need-based scoped key minting + managed credits — the moat).
6. Transactions / mandates (real orders, real money, signed mandates, approval-gated — the commerce layer).

**Trust/quality engine (enabled now that runs are real):**
7. **The Lab** — internal red-team/security model runs candidate flows/agents through adversarial scenarios against the real gate, scores risk/cost/security, earns the **verified** badge. (= internal orchestrator-ranking idea + verification pipeline.)
8. Telemetry ranking — rank agents/tools/flows by real behavioral data from real runs. The differentiator; impossible before Chunk 4 made runs real.
9. The Store as marketplace — vetted, specialized, published agents/flows ("Amazon-products" style) with Lab verification + telemetry track records.

**Later infra:** local/CLI/internal-API access for agents (needs real microVM/gVisor sandboxing); the multi-run operations view; streaming (token-by-token real-time reveal, replacing current polling/post-hoc reveal); drag-and-drop flow authoring; the UI premium pass (3.6); the product rename.

**Demo north star:** shift from "job search automation" to a simple, universal, multi-agent, transactional task (food delivery is ideal — legible, multi-agent, needs A2UI, needs governed transactions). Pitch: *"Watch my agent coordinate three companies' agents to order dinner — and watch me stay in control of every step and every dollar, with power to approve, cap, or kill it instantly."*

---

## 7. Immediate recommended next step

The previous chunk (Chunk 4, real execution) is done and pushed. The two best next builds are **observability** (fixes the live "I can't see what it did" pain) and **real A2UI** (most vision-revealing). My recommendation: do them close together — observability first or folded in, since A2UI also needs the run to be watchable. Both are buildable on the current foundation with no re-architecting.

Before building: I (the founder) should verify Chunk 4 live on my real API key — add my provider key in Profile → Provider keys, start a real run from a saved flow, watch Control for real events + real cost, confirm an approval actually pauses a real run and the kill switch actually terminates one. (This has not yet been fully confirmed live.)

**When responding to me in the new chat:** confirm you've absorbed this, then either (a) help me verify Chunk 4 live and debug what I see, or (b) write the next comprehensive build-prompt document (observability and/or real A2UI) in the established format — phased, hard constraints, "do NOT" list, acceptance gates, commit-per-phase, security-conscious, frontend-only unless stated. Ask me which, and ask any clarifying questions first if a fork would change the architecture.
EOF
echo "context file created"
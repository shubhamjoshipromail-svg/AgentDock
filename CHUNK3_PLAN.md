# Chunk 3 — The Credibility Redesign (plan)

Pixels, not behavior. Zero backend/schema/route changes. All 69 tests stay green.
Concept: **the control tower** — calm, dark, high-signal operations room. Mono for
every machine-true value (IDs, costs, tokens, timestamps, event types, model names).

## Decisions / interpretations

- **App shell = top nav** (keep, restyle). The existing `Nav` already renders the five
  sections in story order (Build → Store → Flows → Control → Profile). A left rail would
  force a relayout of every page wrapper for no story gain. Restyle the top bar into a
  flat control-tower bar (no pill/blur), add the global mode pill + auth menu there.
- **Legacy CSS variable bridge.** Every component already styles via class names that
  resolve through `--bg/--surface/--ink/--muted/--line/--green/...`. Phase A defines the
  new tokens in `app/tokens.css` AND remaps those legacy names onto the new dark tokens,
  so the whole app re-skins at once. `base.css` + `theme.css` get gutted to token-driven
  dark rules. New component CSS consumes only tokens; raw hex lives only in tokens.css.
- **Mono everywhere** via a `.data` utility class + `<Data>` primitive.
- **One motion lib?** No. CSS transitions only (all ≤250ms, reduced-motion gated).

## Token system (app/tokens.css)

Palette: bg-base #0E1116, bg-raised #161B22, bg-overlay #1D242E, line #2A323D,
text-primary #E8EDF2, text-secondary #9AA7B4, text-faint #5C6875, accent #5B8DEF,
accent-muted #2C4470. Semantics: ok #3FB68B, warn #D9A03F, danger #E5604C,
restricted #8B5CF6. Risk→semantic LAW: low→ok, medium→warn, high→danger,
restricted→restricted; verified→ok, community→warn, unverified→faint+warn border.
Type: Space Grotesk (display), Inter (UI), IBM Plex Mono (data), all via next/font.
Scale 12/13/14/16/20/28/36, body 14. Space 4/8/12/16/24/32/48. Radius 6/10/999.
Borders not shadows (one overlay shadow for modal/inspector).

## Phases

- **A — tokens + primitives.** tokens.css + fonts in root layout; rebuild
  `primitives.tsx`: Button (primary/secondary/ghost/danger, sm/md, loading), Card,
  Badge (risk/verification/decision props resolve color internally), Pill, Data, Input,
  Select, SearchInput, EmptyState, Metric. Sweep components onto primitives + tokens;
  kill inline styles in Store; gut base/theme CSS to dark. No layout changes yet.
- **B — IA.** Delete every `truthNotice`/capability paragraph; ONE global mode pill in
  nav (DB-backed / Demo + tooltip). Restage each section to one hero/primary surface:
  Build (goal docks top, inspector right-on-select, runtime/memory/routes as inspector
  tabs), Store (toolbar row + grid + segmented tabs), Flows (card grid → detail),
  Control (two-column ops room), Profile (real data only — delete fake DetailBlocks).
  EmptyState everywhere with story copy.
- **C — flow graph.** Hand-built SVG edge layer + positioned div nodes, computed layout:
  goal node leading, agent spine horizontal by routeOrder, tools below, memory above,
  gates as warn diamonds on the spine. Node border = risk/role semantic; selection drives
  inspector. Warnings strip first-class above graph; plan-meta mono line under goal.
  Same component renders saved Flow detail read-only.
- **D — A2UI grammar.** `components/a2ui/EventCard.tsx` fixed anatomy (who/what/on-what/
  authority/decision stripe/when+cost). Control timeline → all events through EventCard;
  functional client-side filters by decision + type. ApprovalCard variant (approve/deny/
  edit, warn pulse, resolve animation). Spend panel from already-fetched data. Revoke =
  Button danger + inline confirm (no window.confirm). `A2UI` caption on feed header.
- **E — demo seed.** Extend templates.ts + seed.js + bootstrap data-shape: one polished
  example Flow (Market research digest: 3 agents, 2 tools incl. approval-required, 2
  memory zones, 1 gate), one completed run w/ events, one pending approval, history — so
  Control/Flows look alive. Same for signed-out mock. Build empty hero gets 3 goal chips.
  Voice sweep; rename Workflow/MCP stragglers. README screenshot section + 90s script.
- **F — motion, responsive floor, a11y.** CSS stagger/slide/stripe transitions (reduced-
  motion gated); usable at 1280×800, degrade to 1024 (inspector overlay, Control stacks);
  focus-visible accent rings; text on every badge; graph nodes keyboard-focusable.

## Flow-graph rendering approach

Container `position:relative`, overflow auto (pan). Nodes are absolutely-positioned
`<button>`s at computed (x,y); one `<svg>` underlay draws edges as rounded-elbow paths
between node anchor points. Layout: x by routeOrder column, y bands (memory top, spine
middle, tools bottom); gates inserted as half-columns on the spine. Pure function
`layoutFlow(plan)` → {nodes, edges} consumed by `FlowGraph`. Reused for plan + saved Flow.

## Acceptance gates (per phase): `npm run build` + `npm test` (69) green, one commit.
Final: `git diff --stat <start>..HEAD -- app/api prisma lib/orchestrator lib/llm
lib/registry lib/validation` shows only allowed seed/template files; no `truthNotice`;
no raw hex in *.tsx.

# UI Beauty Pass — decisions & state (Phases 0–3)

North star: "calm control tower" — Linear's discipline, Vercel's clarity,
Raycast's life. Dark-first. Governance colors are the one loud element.

## Decisions (founder-approved)

- **Signature accent: electric cyan-teal** — `--accent: oklch(78% 0.125 205)`.
  Distinct from Linear purple / Vercel monochrome / default-shadcn zinc.
- **Type: Geist + Geist Mono** (npm `geist`, self-hosted — no build-time font
  fetch). One grotesk for display+body; mono for identities (`gmail:send_email`),
  costs, timestamps — machine truth looks machine-true (`.data`/`.mono`).
- **Tokens are law**: `app/tokens.css` is the single source (OKLCH palette,
  4px space grid, 6/10/14 radius, 120/200/300ms motion, the z scale). Zero raw
  colors outside it; legacy var names bridge onto canonical tokens.

## Phase 0 — banner overlap fix

The attention banner now lives in NORMAL FLOW above the app frame
(`.appViewport` flex column in `page.tsx` + `shell.css`) — it pushes the shell
down instead of plating over the header. The z scale is documented once in
tokens.css: chrome 80 · drawers 85 · modals 90 · toasts 95.

## Phase 2 — machinery

Tailwind v4 (utilities only, **no preflight** — base.css owns the reset) via
`postcss.config.mjs`; the Tailwind theme maps to OUR tokens in `app/tw-theme.css`
(`--color-*: initial` kills the default palette). Radix primitives: the focused
interaction window is a **Dialog** (focus trap/Esc/aria for free), the attention
queue a **DropdownMenu**, plus themed Tooltip/Tabs in `primitives.tsx`; Button is
cva-structured with the same call-site API. The hand-built ⌘K palette and toast
stay custom (small, already accessible) — candidates for later migration.

## Phase 3 — surfaces

- **Workspace hero**: run header is a status bar (semantic state chip with live
  pulse, slim spend meter with hot-warn at >80% of cap, one primary + one
  destructive action); participants are issue-card-discipline cards (accent
  order marker, mono tool identities, hover-reveal revoke, semantic permission
  icons); the run column is a connected timeline rail (semantic markers on a
  vertical line, mono cost ticks, entries animate in as they stream).
- **Attention**: the focused window carries the product's signature — a 2px
  accent-gradient hairline across the top; generous `--sp-6` padding; options
  are real selectable cards in a responsive grid.
- **Connect/Store**: cards share one elevation/hover language (top-lit +
  raise); tool names render as mono identities.
- **Empty states teach**: illustrated accent glyph, one line, one action
  (workspace empty state focuses the describe input; tool setup guide walks
  connect → discover → grant).

## Still open (Phases 4–5, founder-gated)

Framer-Motion micro-interactions, skeleton coverage audit, the one hero-moment
glow (run completion), wordmark/favicon (waiting on the rename), the
blast-radius radar as the iconic screenshot element, and the 60-second demo
path review — these want visual review with the app running.

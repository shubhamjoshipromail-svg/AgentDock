# The A2UI Attention Surface — banners + a focused interaction window

Chunk 18 renders interaction intents (approval/choice/form/confirmation) inline
in the workspace run column. That works for a one-click approval; rich surfaces
were cramped there, and an ask was invisible from any other screen. This
mini-chunk adds the attention pattern on top — no engine changes; the intent
primitive, schema validation, and governance from Chunk 18 are untouched.

## The pattern

1. **Banner (global)** — `AttentionBanner`, rendered at app level, fixed across
   the top of every screen. One pending intent → "⚠ [Flow] needs your input —
   Respond" (opens the window directly). Several → the count, opening the queue.
   `role="status"` + `aria-live="polite"` for screen readers.
2. **Focused interaction window** — `AttentionWindow`: an overlay where the
   intent renders large and centered, with the context header
   "[Agent] in [Flow] is asking:". Esc / backdrop / × close WITHOUT responding —
   the run stays paused. Focus is trapped inside; it returns where it was on
   close.
3. **Inline stays glanceable** — the run column keeps a compact chip for rich
   intents ("⏸ waiting on you → Open"); simple approvals remain one-click
   inline. Quick-action and the window are complements, not duplicates.
4. **The queue** — a minimal newest-first list of every pending intent across
   runs, from the banner. Deliberately just a list: this is the **seed of the
   multi-run operations view** from the vision, not the view itself.

## One source of truth

All three views read the SAME pending-intents state: `GET /api/approvals`
(the Chunk 18 `ApprovalRequest` table — `status: pending`, run not terminal),
held in `AttentionProvider` (`components/attention/AttentionCenter.tsx`). There
is no separate notification store that can drift. The state refreshes on a
steady poll (safety net for screens without a run stream), on tab focus, and —
debounced, trailing — whenever the workspace's run SSE sees a snapshot or the
user responds anywhere. Pure derivations (banner state, newest-first order,
rich-vs-simple) live in `lib/attention/pending.ts` and are unit-tested.

## One renderer, two container sizes

The window renders the identical schema-validated `IntentSurface` components
the inline column uses — the constrained vocabulary from Chunk 18, never a
parallel renderer. The size difference is container-scoped CSS only
(`.attnWindowBody .intentOption { … }` turns options into a real card grid).

## Governance unchanged

Responding in the window calls the same `/api/approvals/[id]/resolve` route —
same policy re-check, same response-as-untrusted-data framing. A choice still
never authorizes a consequential action; external sends still require their
approval gate.

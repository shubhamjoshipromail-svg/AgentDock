# Workspace Composition Inventory (Chunk 17 Phase 0)

The single workspace surface lives in `components/workspace/FlowWorkspace.tsx`
(mounted once by `app/page.tsx` under the "Workspace" section of `Shell`). It owns
all flow/run/grant state and today switches between four full-screen views via a
`WorkspaceTab` bar (`flow | builder | activity | connect`, lines 30, 336–406).

What each piece renders:

- **`FlowWorkspace` `flow` tab** — already a 3-column composition: **left** = a
  describe-to-build bar + flow `<select>` + a participants list (one card per
  `workflowAgent`, with tool chips); **center** = a run bar (Run/Kill + status),
  the no-tools "guided setup" panel, the inline approval card, and the live
  output/step stream (polls `getRealRun` every 2s); **right** = an inspector for
  the selected participant: its granted tools (revoke), a "Discover & grant" list
  of `availableTools`, and a mini blast-radius radar. Grant/revoke/run/approve/
  kill/describe handlers all live here (`handleGrant`, `handleRevoke`, `handleRun`,
  `handleApprove`, `handleKill`, `handleDescribe`).
- **`Builder` (`components/build/Builder.tsx`)** — the heavy node-graph editor
  (the `builder` tab). Driven by `nodes/selectedNodeId` props from FlowWorkspace;
  it internally embeds **`GrantPanel`** (`components/build/GrantPanel.tsx`, the only
  consumer) for grant editing on the canvas. Calls `onLoadWorkflow` to hydrate the
  graph and `onViewLogs` to jump to activity.
- **`ControlPlane` (`components/control/ControlPlane.tsx`)** — the global activity
  / run-history view (the `activity` tab). Self-contained, no props.
- **`ConnectPanel` (`components/connect/ConnectPanel.tsx`)** — the connect →
  discover → register-tools flow (the `connect` tab). Self-contained, no props.

Composition plan: the `flow` tab's three columns are the seed of the single
surface. Chunk 17 keeps the participants + run columns always visible, folds the
right inspector's grant logic onto each participant card (Phase 2), and turns the
two heavy sub-tasks — `Builder` (build canvas) and `ConnectPanel` (connect server)
— into in-place expandable drawers (Phases 2–3) instead of full-view tab swaps.
`ControlPlane`'s live-run view is already mirrored by the center run column, so the
`activity` tab folds into that. No component is rewritten; they are recomposed.

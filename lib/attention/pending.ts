// Pure selectors over the pending-intents list — the banner, queue, and
// focused window all derive from this ONE state (fetched from the Chunk 18
// table). Pure functions so the attention logic is unit-testable without DOM.

import type { PendingIntentSummary } from "../api/client";

export type BannerState =
  | { visible: false }
  | { visible: true; count: number; newest: PendingIntentSummary; label: string };

// Newest-first is the API's order, but never trust call-site ordering — sort here.
export function sortNewestFirst(intents: PendingIntentSummary[]): PendingIntentSummary[] {
  return [...intents].sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt));
}

export function bannerState(intents: PendingIntentSummary[]): BannerState {
  if (intents.length === 0) return { visible: false };
  const sorted = sortNewestFirst(intents);
  const newest = sorted[0];
  const label =
    sorted.length === 1
      ? `${newest.flowName} needs your input`
      : `${sorted.length} runs need your input`;
  return { visible: true, count: sorted.length, newest, label };
}

// Simple approvals are answerable inline with one click; rich surfaces
// (choice grids, forms, confirmations with context) deserve the focused window.
export function isRichIntent(intentType: string | null | undefined): boolean {
  return intentType === "choice" || intentType === "form" || intentType === "confirmation";
}

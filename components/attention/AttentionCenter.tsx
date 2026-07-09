"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";

import { listPendingIntents, type PendingIntentSummary } from "../../lib/api/client";
import { bannerState, sortNewestFirst } from "../../lib/attention/pending";
import "./attention.css";

// THE ATTENTION SURFACE. One source of truth: the pending-intents state fetched
// from the Chunk 18 table (GET /api/approvals). The banner, the queue, and the
// focused interaction window are three views over this ONE list — there is no
// separate notification store that can drift from run truth.

type AttentionContextValue = {
  intents: PendingIntentSummary[];
  // Re-read the pending list from the server (debounced). Call after anything
  // that can change intent lifecycle: SSE snapshot, respond, resolve.
  refresh: () => void;
  // Open the focused interaction window on a specific intent.
  open: (intentId: string) => void;
  // The intent currently focused in the window (null = closed).
  focusedId: string | null;
  close: () => void;
};

const AttentionContext = createContext<AttentionContextValue>({
  intents: [],
  refresh: () => {},
  open: () => {},
  focusedId: null,
  close: () => {}
});

export function useAttention() {
  return useContext(AttentionContext);
}

const POLL_MS = 20_000;
const DEBOUNCE_MS = 1_500;

export function AttentionProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const signedIn = Boolean(session?.user);

  const [intents, setIntents] = useState<PendingIntentSummary[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const lastFetchRef = useRef(0);

  const fetchNow = useCallback(async () => {
    if (!signedIn) { setIntents([]); return; }
    lastFetchRef.current = Date.now();
    try {
      const data = await listPendingIntents();
      setIntents(sortNewestFirst(data.intents ?? []));
    } catch { /* transient — keep last known state; next poll corrects */ }
  }, [signedIn]);

  const trailingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = useCallback(() => {
    // Coalesce bursts (SSE snapshots) into one re-read, but never DROP a
    // refresh — a trailing fetch always lands, so respond→banner-clears is
    // guaranteed even inside the debounce window.
    const since = Date.now() - lastFetchRef.current;
    if (since >= DEBOUNCE_MS) { void fetchNow(); return; }
    if (trailingRef.current) return;
    trailingRef.current = setTimeout(() => {
      trailingRef.current = null;
      void fetchNow();
    }, DEBOUNCE_MS - since);
  }, [fetchNow]);
  useEffect(() => () => { if (trailingRef.current) clearTimeout(trailingRef.current); }, []);

  // Lifecycle: initial load + steady poll + refresh when the tab regains focus.
  // The poll is the safety net that keeps the banner honest from ANY screen
  // (screens without a run stream still learn about new asks).
  useEffect(() => {
    void fetchNow();
    if (!signedIn) return;
    const t = setInterval(() => void fetchNow(), POLL_MS);
    const onFocus = () => void fetchNow();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [signedIn, fetchNow]);

  // If the focused intent got resolved elsewhere (inline card, another tab),
  // the window must not linger on a dead ask.
  useEffect(() => {
    if (focusedId && !intents.some((i) => i.id === focusedId)) setFocusedId(null);
  }, [intents, focusedId]);

  const open = useCallback((intentId: string) => setFocusedId(intentId), []);
  const close = useCallback(() => setFocusedId(null), []);

  return (
    <AttentionContext.Provider value={{ intents, refresh, open, focusedId, close }}>
      {children}
    </AttentionContext.Provider>
  );
}

// The slim global banner: unmissable, on every screen, persistent until every
// pending intent is handled. One pending → names the flow and opens it directly;
// several → shows the count.
export function AttentionBanner() {
  const { intents, open } = useAttention();
  const state = bannerState(intents);
  if (!state.visible) return null;

  return (
    <div className="attnBanner" role="status" aria-live="polite">
      <span className="attnBannerIcon" aria-hidden>⚠</span>
      <span className="attnBannerText">
        {state.label}
        {state.count === 1 && state.newest.agentName ? (
          <span className="attnBannerDetail"> — {state.newest.agentName} is asking</span>
        ) : null}
      </span>
      <button className="attnBannerAction" onClick={() => open(state.newest.id)}>
        {state.count === 1 ? "Respond" : `Review ${state.count}`}
      </button>
    </div>
  );
}

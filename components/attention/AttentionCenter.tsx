"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

import {
  listPendingIntents, resolveApproval, respondToIntent, type PendingIntentSummary
} from "../../lib/api/client";
import { bannerState, sortNewestFirst } from "../../lib/attention/pending";
import { IntentSurface } from "../workspace/IntentSurface";
import { useToast } from "../layout/Toast";
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
  // the window must not linger on a dead ask. But an intent opened from a live
  // run stream may be newer than our last fetch — only auto-close once a fetch
  // that STARTED AFTER the open has confirmed the intent is gone.
  const openedAtRef = useRef(0);
  useEffect(() => {
    if (!focusedId) return;
    if (intents.some((i) => i.id === focusedId)) return;
    if (lastFetchRef.current > openedAtRef.current) setFocusedId(null);
  }, [intents, focusedId]);

  const open = useCallback((intentId: string) => {
    openedAtRef.current = Date.now();
    setFocusedId(intentId);
    // The workspace stream can learn about an ask before our poll does —
    // re-read immediately so the window has the intent to render.
    void fetchNow();
  }, [fetchNow]);
  const close = useCallback(() => setFocusedId(null), []);

  return (
    <AttentionContext.Provider value={{ intents, refresh, open, focusedId, close }}>
      {children}
    </AttentionContext.Provider>
  );
}

// The slim global banner: unmissable, on every screen, persistent until every
// pending intent is handled. One pending → names the flow and opens it directly;
// several → shows the count and opens the queue.
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
      {state.count === 1 ? (
        <button className="attnBannerAction" onClick={() => open(state.newest.id)}>
          Respond
        </button>
      ) : (
        // THE QUEUE: a Radix dropdown off the banner — keyboard nav, outside
        // click, Esc, and focus return for free. It reads the SAME list as the
        // banner, so when the last intent resolves they leave together.
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button className="attnBannerAction">Review {state.count}</button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="attnQueue" align="end" sideOffset={8} aria-label="Runs waiting on you">
              <DropdownMenu.Label className="attnQueueHead">Needs attention</DropdownMenu.Label>
              {intents.map((i) => (
                <DropdownMenu.Item key={i.id} className="attnQueueRow" onSelect={() => open(i.id)}>
                  <span className="attnQueueKind" data-kind={i.intentType ?? "approval"}>
                    {i.intentType === "choice" ? "☰" : i.intentType === "form" ? "✎" : i.intentType === "confirmation" ? "?" : "⚠"}
                  </span>
                  <span className="attnQueueBody">
                    <span className="attnQueueTitle">{i.title}</span>
                    <span className="attnQueueMeta">
                      {i.agentName ? `${i.agentName} · ` : ""}{i.flowName} · {relativeTime(i.requestedAt)}
                    </span>
                  </span>
                  <span className="attnQueueGo" aria-hidden>→</span>
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
    </div>
  );
}

function relativeTime(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// The focused interaction window: one intent, rendered LARGE, with room to
// breathe. Same schema-validated renderer as the inline cards (one renderer
// registry, two container sizes) — never a parallel renderer. Responding goes
// through the same resolve route with the same policy re-check; closing
// without responding leaves the run paused.
export function AttentionWindow() {
  const { intents, focusedId, close, refresh } = useAttention();
  const toast = useToast();
  const intent = focusedId ? intents.find((i) => i.id === focusedId) ?? null : null;

  if (!intent) return null;

  const handleRespond = async (intentId: string, response: Record<string, unknown>) => {
    try {
      await respondToIntent(intentId, response);
      toast("Response sent — resuming…", "ok");
      close();
      refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not submit your response.", "danger");
    }
  };

  const handleResolveApproval = async (intentId: string, approved: boolean) => {
    try {
      await resolveApproval(intentId, approved ? "approved" : "denied");
      toast(approved ? "Approved — resuming…" : "Denied — run halted.", approved ? "ok" : "warn");
      close();
      refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Approval failed.", "danger");
    }
  };

  // Radix Dialog: focus trap, Esc, outside-click, focus return, aria — for
  // free. Closing (any path) never responds: the run stays paused.
  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="attnOverlay" />
        <Dialog.Content
          className="attnWindow"
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="attnWindowHead">
            <Dialog.Title asChild>
              <span className="attnWindowContext">
                <strong>{intent.agentName ?? "Agent"}</strong> in <strong>{intent.flowName}</strong> is asking:
              </span>
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="attnWindowClose" aria-label="Close without responding">×</button>
            </Dialog.Close>
          </div>
          <div className="attnWindowBody">
            <IntentSurface
              intent={{
                id: intent.id,
                title: intent.title,
                description: intent.description,
                status: "pending",
                intentType: intent.intentType,
                payload: intent.payload
              }}
              onRespond={(id, response) => void handleRespond(id, response)}
              onResolveApproval={(id, approved) => void handleResolveApproval(id, approved)}
            />
          </div>
          <div className="attnWindowFoot">Closing without responding keeps the run paused.</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import * as Dialog from "@radix-ui/react-dialog";

import { Button } from "../layout/primitives";
import { useAttention } from "../attention/AttentionCenter";
import "./getting-started.css";

const GUIDE_VERSION = "v1";

export function GettingStarted({
  openProfile,
  openWorkspace
}: {
  openProfile: () => void;
  openWorkspace: () => void;
}) {
  const { data: session, status } = useSession();
  const { intents } = useAttention();
  const [open, setOpen] = useState(false);
  const email = session?.user?.email ?? "anonymous";
  const storageKey = `agentdock:getting-started:${GUIDE_VERSION}:${email}`;

  useEffect(() => {
    if (status !== "authenticated" || !session?.user?.email) return;
    if (window.localStorage.getItem(storageKey) !== "done") setOpen(true);
  }, [status, session?.user?.email, storageKey]);

  const finish = (next?: () => void) => {
    window.localStorage.setItem(storageKey, "done");
    setOpen(false);
    next?.();
  };

  if (status !== "authenticated") return null;

  return (
    <Dialog.Root open={open && intents.length === 0} onOpenChange={(next) => { if (!next && intents.length === 0) finish(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="guideOverlay" />
        <Dialog.Content className="guideWindow" aria-describedby="getting-started-copy">
          <div className="guideHead">
            <div>
              <span className="guideEyebrow">Welcome to AgentDock</span>
              <Dialog.Title className="guideTitle">Three things before your first real run</Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button className="guideClose" aria-label="Close getting started">×</button>
            </Dialog.Close>
          </div>

          <p className="guideCopy" id="getting-started-copy">
            AgentDock pauses whenever it needs information or permission. A window will open automatically and tell you exactly what to do.
          </p>

          <ol className="guideSteps">
            <li>
              <span className="guideNumber">1</span>
              <div><strong>Add a model key</strong><span>Open Profile and add an Anthropic, OpenAI, or OpenRouter key so agents can run.</span></div>
            </li>
            <li>
              <span className="guideNumber">2</span>
              <div><strong>Choose whether email may send</strong><span>Drafting is safer by default. Turn on real sending in Profile only if you want it.</span></div>
            </li>
            <li>
              <span className="guideNumber">3</span>
              <div><strong>Run a saved flow</strong><span>If the agent needs a topic, choice, or approval, the action window opens automatically. Nothing waits silently.</span></div>
            </li>
          </ol>

          <div className="guideActions">
            <Button variant="primary" onClick={() => finish(openProfile)}>Open Profile setup</Button>
            <Button variant="secondary" onClick={() => finish(openWorkspace)}>Go to Workspace</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

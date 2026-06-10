"use client";

import { useEffect, useState } from "react";
import { getProviders, signIn, signOut, useSession } from "next-auth/react";

export function AuthStatus() {
  const { data: session, status } = useSession();
  const [googleAvailable, setGoogleAvailable] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    getProviders()
      .then((providers) => setGoogleAvailable(Boolean(providers?.google)))
      .catch(() => setGoogleAvailable(false));
  }, []);

  if (status === "loading") {
    return <button className="authTrigger" disabled>Checking...</button>;
  }

  if (session?.user) {
    return (
      <div className="authMenu">
        <button className="authTrigger signedIn" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          {session.user.image ? <img src={session.user.image} alt="" /> : <span className="authAvatar">AD</span>}
          <span>{session.user.name ?? "Signed in"}</span>
        </button>
        {open && (
          <div className="authPopover">
            <div className="authPopoverHeader">
              {session.user.image ? <img src={session.user.image} alt="" /> : <span className="authAvatar large">AD</span>}
              <div>
                <strong>{session.user.name ?? "AgentDock user"}</strong>
                <span>Signed in as {session.user.email ?? session.user.name}</span>
              </div>
            </div>
            <button className="secondaryButton smallButton" onClick={() => signOut()}>Sign out</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="authMenu">
      <button className="authTrigger" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        Sign in
      </button>
      {open && (
        <div className="authPopover">
          <div>
            <strong>Save your AgentDock workspace</strong>
            <p>Sign in to save Flows, Memory Zones, access, and Timeline.</p>
          </div>
          {googleAvailable ? (
            <button className="googleSignInButton" onClick={() => signIn("google")}>
              <span>G</span>
              Sign in with Google
            </button>
          ) : (
            <p className="authSetupText">Set Google OAuth env vars to enable sign-in.</p>
          )}
        </div>
      )}
    </div>
  );
}

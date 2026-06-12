"use client";

import { useSession } from "next-auth/react";

import { Card, DetailBlock, PageHeader } from "../layout/primitives";
import { MemorySection } from "./MemorySection";

export function Profile({
  selectedMemory,
  onSelectMemory,
  defaultAgent
}: {
  selectedMemory: string;
  onSelectMemory: (name: string) => void;
  defaultAgent: string;
}) {
  const { data: session } = useSession();
  const profileName = session?.user?.name ?? "Shubham Joshi";
  const profileEmail = session?.user?.email ?? "shubham@example.com";

  return (
    <section className="platformPage">
      <PageHeader eyebrow="Profile" title="Profile" copy="Defaults for access, memory, models, and spend." />
      {session?.user ? (
        <div className="profileAuthNotice">Signed in as {profileName || profileEmail}</div>
      ) : (
        <div className="profileAuthNotice">Sign in to save Flows, Memory Zones, Scoped Access, and Timeline.</div>
      )}
      <div className="profileGrid">
        <Card title="Identity" meta="Account">
          <DetailBlock label="Name" value={profileName ?? "Not signed in"} />
          <DetailBlock label="Email" value={profileEmail ?? "Not signed in"} />
          <DetailBlock label="Workspace" value={session?.user ? "Personal workspace" : "Demo workspace"} />
        </Card>
      </div>
      <MemorySection selectedMemory={selectedMemory} onSelectMemory={onSelectMemory} />
    </section>
  );
}

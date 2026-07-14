"use client";

import { useSession } from "next-auth/react";

import { Card, DetailBlock, PageHeader } from "../layout/primitives";
import { MemorySection } from "./MemorySection";
import { ProviderKeys } from "./ProviderKeys";

export function Profile({
  selectedMemory,
  onSelectMemory
}: {
  selectedMemory: string;
  onSelectMemory: (name: string) => void;
}) {
  const { data: session } = useSession();
  const profileName = session?.user?.name ?? "Shubham Joshi";
  const profileEmail = session?.user?.email ?? "shubham@example.com";

  return (
    <section className="platformPage">
      <PageHeader eyebrow="Profile" title="Profile" copy="Defaults for access, memory, models, and spend." />
      <div className="profileGrid">
        <Card title="Identity" meta="Account">
          <DetailBlock label="Name" value={profileName ?? "Not signed in"} />
          <DetailBlock label="Email" value={profileEmail ?? "Not signed in"} />
          <DetailBlock label="Workspace" value={session?.user ? "Personal workspace" : "Demo workspace"} />
        </Card>
        <ProviderKeys />
      </div>
      <MemorySection selectedMemory={selectedMemory} onSelectMemory={onSelectMemory} />
    </section>
  );
}

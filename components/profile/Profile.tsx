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
        <Card title="Identity basics" meta="User">
          <DetailBlock label="Name" value={profileName ?? "Not signed in"} />
          <DetailBlock label="Email" value={profileEmail ?? "Not signed in"} />
          <DetailBlock label="Workspace" value="Personal demo workspace" />
        </Card>
        <Card title="Approval defaults" meta="High trust">
          {["Email sends require approval", "Payments are blocked by default", "External sharing requires approval", "Restricted memory always approval-gated"].map((rule) => <div className="approvalItem" key={rule}>{rule}</div>)}
        </Card>
        <Card title="Default agents" meta={defaultAgent}>
          <DetailBlock label="Discovery" value="Job Discovery Agent" />
          <DetailBlock label="Research" value="Company Research Agent" />
          <DetailBlock label="Documents" value="Resume Tailoring Agent" />
        </Card>
        <Card title="Model defaults" meta="Cross-model">
          <DetailBlock label="Default provider" value="OpenAI for Flow planning" />
          <DetailBlock label="Research provider" value="Claude" />
          <DetailBlock label="Outreach provider" value="Gemini" />
        </Card>
        <Card title="Budget defaults" meta="$5/week">
          <DetailBlock label="Weekly cap" value="$5.00" />
          <DetailBlock label="Max run budget" value="$1.50" />
          <DetailBlock label="Premium model policy" value="Allowed within cap" />
        </Card>
        <Card title="Sharing" meta="Conservative">
          <DetailBlock label="Raw memory export" value="Blocked by default" />
          <DetailBlock label="Team sharing" value="Approval required" />
          <DetailBlock label="Third-party reuse" value="Blocked" />
        </Card>
      </div>
      <MemorySection selectedMemory={selectedMemory} onSelectMemory={onSelectMemory} />
    </section>
  );
}

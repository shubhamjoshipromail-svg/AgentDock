"use client";

import { runtimeModes } from "../mock-data";

export function RuntimeModeSection({ context }: { context: "builder" | "workflow" }) {
  return (
    <section className={context === "builder" ? "runtimeSection" : "runtimeSection compactRuntime"}>
      <div className="panelHeader">
        <span>Runtime Mode</span>
        <strong>AgentDock Sandbox Mode selected</strong>
      </div>
      <p className="runtimeCopy">
        AgentDock is not trying to be a raw GPU cloud. It manages where and how agent workflows run:
        provider APIs, AgentDock sandbox, user cloud, or local runtime.
      </p>
      <div className="runtimeGrid">
        {runtimeModes.map((mode) => (
          <article className={mode.name === "AgentDock Sandbox Mode" ? "runtimeCard selected" : "runtimeCard"} key={mode.name}>
            <div className="runtimeTopline">
              <strong>{mode.name}</strong>
              <span>{mode.status}</span>
            </div>
            <p>{mode.description}</p>
            <small>Best for {mode.bestFor}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

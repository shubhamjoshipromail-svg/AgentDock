import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["tests/global-setup.ts"],
    setupFiles: ["tests/setup-env.ts"],
    // Integration tests share one Postgres database; run files serially.
    fileParallelism: false,
    // Reuse ONE worker for every file instead of spawning a fresh one per file.
    // On a slow/contended machine the default per-file spawn can exceed the pool's
    // "waiting for worker to respond" timeout and fail files that would otherwise
    // pass (an environmental flake, not a test failure). Files already run serially
    // and per-file module isolation is preserved, so behaviour is unchanged — only
    // the worker lifecycle is stabler. (Vitest 4 moved these to top level;
    // `poolOptions` was removed.)
    maxWorkers: 1,
    // Integration tests dynamically `await import(...)` route modules, which
    // triggers on-demand TypeScript transform of the route's full dependency
    // graph (Prisma, the MCP SDK, googleapis) inside the test body. On a cold
    // cache or a slow/contended machine that transform alone can exceed a tight
    // timeout even though the assertions themselves are trivial and pass. These
    // ceilings are generous headroom for that cold-import cost — CI with a warm
    // cache runs well under them — so a real hang still fails, but environmental
    // slowness never produces a false red.
    testTimeout: 120000,
    hookTimeout: 120000
  }
});

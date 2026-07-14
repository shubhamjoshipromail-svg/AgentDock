import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["tests/global-setup.ts"],
    setupFiles: ["tests/setup-env.ts"],
    // Integration tests share one Postgres database; run files serially.
    fileParallelism: false,
    // Run every test file in ONE long-lived fork. The default pool spawns a fresh
    // worker per file; on a slow/contended machine that repeated spawn can exceed
    // the pool's "waiting for worker to respond" timeout and fail files that would
    // otherwise pass (an environmental flake, not a test failure). A single fork
    // spawns once. Files already run serially, and per-file module isolation is
    // preserved, so behaviour is unchanged — only the worker lifecycle is stabler.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
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

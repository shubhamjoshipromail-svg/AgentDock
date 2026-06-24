// Standalone worker process — claims jobs from the Postgres-backed durable
// queue and executes them via the existing run engine. No Next.js dependency;
// loads .env directly. Run with `npm run worker`.
//
// The worker:
//   - Loops: claim an eligible queued/reclaimable job → execute → release
//   - Respects per-user concurrency (one run per user by default)
//   - Heartbeats every leaseMs/3 so live jobs never expire mid-execution
//   - Step-cursor tracks progress so a reclaimed job resumes safely
//   - Graceful shutdown on SIGTERM/SIGINT (drains current job, then exits)
//
// This is NOT a web server. The Next.js dev server (`npm run dev`) serves the
// UI and API; start the worker separately to execute runs.

import "../lib/config/dotenv"; // load .env before anything else

import { runWorkerLoop } from "../lib/execution/run-queue";
import { prisma } from "../lib/prisma";

const WORKER_ID = `worker-${process.pid}-${Date.now()}`;
const POLL_MS = Number(process.env.WORKER_POLL_MS) || 2_000;
const LEASE_MS = Number(process.env.WORKER_LEASE_MS) || 60_000;
const PER_USER_CONCURRENCY = Number(process.env.WORKER_PER_USER_CONCURRENCY) || 1;

let stopping = false;

process.on("SIGTERM", () => {
  console.log(`[worker] ${WORKER_ID} received SIGTERM — draining then exiting`);
  stopping = true;
});
process.on("SIGINT", () => {
  console.log(`[worker] ${WORKER_ID} received SIGINT — draining then exiting`);
  stopping = true;
});

async function main() {
  console.log(
    `[worker] ${WORKER_ID} starting (pollMs=${POLL_MS}, leaseMs=${LEASE_MS}, perUserConcurrency=${PER_USER_CONCURRENCY})`
  );

  await runWorkerLoop({
    workerId: WORKER_ID,
    pollMs: POLL_MS,
    leaseMs: LEASE_MS,
    perUserConcurrency: PER_USER_CONCURRENCY,
    shouldStop: () => stopping
  });

  await prisma.$disconnect();
  console.log(`[worker] ${WORKER_ID} stopped`);
}

main().catch((err) => {
  console.error("[worker] fatal error", err);
  process.exit(1);
});

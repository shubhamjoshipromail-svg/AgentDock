import { execSync } from "node:child_process";

import { config } from "dotenv";

export default function globalSetup() {
  config({ path: ".env.test", override: true });

  const databaseUrl = process.env.DATABASE_URL ?? "";

  if (!databaseUrl.includes("agentdock_test")) {
    throw new Error(`Refusing to run tests: DATABASE_URL does not point at the agentdock_test database (${databaseUrl}).`);
  }

  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: databaseUrl }
  });
}

import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  experimental: {
    extensions: true
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "postgresql://agentdock:agentdock@localhost:5432/agentdock?schema=public"
  },
  migrations: {
    seed: "node prisma/seed.js"
  }
});

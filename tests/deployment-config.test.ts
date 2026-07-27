import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const json = (file: string) => JSON.parse(read(file)) as {
  $schema: string;
  build: { builder: string; dockerfilePath: string };
  deploy: Record<string, unknown>;
};

describe("production deployment contract", () => {
  it("defines distinct Railway web and worker services from the same Dockerfile", () => {
    const web = json("railway.web.json");
    const worker = json("railway.worker.json");

    for (const config of [web, worker]) {
      expect(config.$schema).toBe("https://railway.com/railway.schema.json");
      expect(config.build).toEqual({ builder: "DOCKERFILE", dockerfilePath: "Dockerfile" });
      expect(config.deploy.preDeployCommand).toEqual(["npx prisma migrate deploy"]);
      expect(config.deploy.restartPolicyType).toBe("ALWAYS");
    }

    expect(web.deploy.startCommand).toBe("npm run start");
    expect(web.deploy.healthcheckPath).toBe("/api/health");
    expect(web.deploy.healthcheckTimeout).toBe(300);
    expect(worker.deploy.startCommand).toBe("npm run worker");
    expect(worker.deploy).not.toHaveProperty("healthcheckPath");
  });

  it("builds EVERY first-party MCP server and binds Next to Railway's port", () => {
    const dockerfile = read("Dockerfile");
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };

    // Assert the outcome (every adapter is compiled), not one literal command —
    // a server whose dist is never built fails at runtime with "not registered",
    // which is a confusing way to discover a missing build step.
    expect(dockerfile).toContain("npm run build:servers");

    const buildAll = pkg.scripts["build:servers"];
    expect(buildAll).toBeTruthy();
    for (const server of ["gmail", "search", "calendar", "docs"]) {
      expect(pkg.scripts[`build:${server}`], `missing build script for ${server}`).toBeTruthy();
      expect(buildAll, `build:servers does not build ${server}`).toContain(`build:${server}`);
    }

    expect(dockerfile).toContain("ENV HOSTNAME=0.0.0.0");
    expect(dockerfile).toContain("ENV PORT=3000");
  });

  it("declares standalone worker dependencies and accepts canonical NextAuth secrets", () => {
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
    const auth = read("auth.ts");

    expect(pkg.dependencies.tsx).toBeTruthy();
    expect(pkg.dependencies.dotenv).toBeTruthy();
    expect(auth).toContain("process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET");
  });

  it("keeps every required production secret and cap in the environment template", () => {
    const env = read(".env.example");
    const required = [
      "DATABASE_URL",
      "NEXTAUTH_URL",
      "NEXTAUTH_SECRET",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "CREDENTIAL_ENCRYPTION_KEY",
      "FOUNDER_EMAILS",
      "RUN_MAX_COST_CENTS",
      "USER_DAILY_RUN_COST_CAP_CENTS",
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "OPENROUTER_API_KEY"
    ];

    for (const name of required) expect(env).toMatch(new RegExp(`^${name}=`, "m"));
  });

  it("documents the exact two-service path, Google callback, and hosted smoke gate", () => {
    const deploy = read("docs/DEPLOY.md");

    expect(deploy).toContain("/railway.web.json");
    expect(deploy).toContain("/railway.worker.json");
    expect(deploy).toContain("${{Postgres.DATABASE_URL}}");
    expect(deploy).toContain("/api/auth/callback/google");
    expect(deploy).toContain('"worker":{"ok":true');
    expect(deploy).toContain("Research → you choose → email your picks");
  });
});

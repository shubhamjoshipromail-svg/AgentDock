import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { google } from "googleapis";

import { createDocsMcpServer } from "./server";
import type { DocsApi } from "./docs-tools";

// Entry point for the first-party Google Docs MCP server, spawned over stdio by
// the governed client. The user's OAuth access token is provided ONLY via the
// server-side environment (set by AgentDock from the encrypted, per-user token);
// it is never passed by, or exposed to, the calling agent.
function docsFromEnv(): DocsApi {
  const token = process.env.GOOGLE_ACCESS_TOKEN;
  if (!token) {
    throw new Error("GOOGLE_ACCESS_TOKEN is required (set server-side by AgentDock).");
  }
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: token });
  return google.docs({ version: "v1", auth }) as unknown as DocsApi;
}

async function main() {
  const server = createDocsMcpServer({ getDocs: docsFromEnv });
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error("[docs-mcp] fatal:", error);
  process.exit(1);
});

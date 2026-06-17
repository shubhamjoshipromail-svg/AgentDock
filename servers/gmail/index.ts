import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { google } from "googleapis";

import { createGmailMcpServer } from "./server";
import type { GmailApi } from "./gmail-tools";

// Entry point for the first-party Gmail MCP server, spawned over stdio by the
// governed client. The user's OAuth access token is provided ONLY via the
// server-side environment (set by AgentDock from the encrypted, per-user token);
// it is never passed by, or exposed to, the calling agent.
function gmailFromEnv(): GmailApi {
  const token = process.env.GMAIL_ACCESS_TOKEN;
  if (!token) {
    throw new Error("GMAIL_ACCESS_TOKEN is required (set server-side by AgentDock).");
  }
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: token });
  return google.gmail({ version: "v1", auth }) as unknown as GmailApi;
}

async function main() {
  const server = createGmailMcpServer({ getGmail: gmailFromEnv });
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error("[gmail-mcp] fatal:", error);
  process.exit(1);
});

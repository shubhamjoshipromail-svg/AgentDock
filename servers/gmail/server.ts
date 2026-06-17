import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { createDraft, sendEmail, type GmailApi } from "./gmail-tools";

// The first-party Gmail MCP server. It is a real MCP server (official SDK),
// just trusted and first-party. The Gmail client is injected so tests can mock
// the API; in production index.ts builds it from the user's OAuth token, which
// is read server-side here and NEVER exposed to the calling agent.
export function createGmailMcpServer(deps: { getGmail: () => GmailApi | Promise<GmailApi> }): McpServer {
  const server = new McpServer({ name: "agentdock-gmail", version: "0.1.0" });

  const emailShape = {
    to: z.string().email().describe("Recipient email address"),
    subject: z.string().min(1).describe("Email subject line"),
    body: z.string().describe("Plain-text email body")
  };

  server.registerTool(
    "create_draft",
    {
      description: "Create a Gmail draft in the user's own mailbox. Safe: writes only to Drafts, sends nothing.",
      inputSchema: emailShape
    },
    async ({ to, subject, body }) => {
      const gmail = await deps.getGmail();
      const text = await createDraft(gmail, { to, subject, body });
      return { content: [{ type: "text", text }] };
    }
  );

  server.registerTool(
    "send_email",
    {
      description: "Send a real email from the user's account. External write — AgentDock requires approval before this runs.",
      inputSchema: emailShape
    },
    async ({ to, subject, body }) => {
      const gmail = await deps.getGmail();
      const text = await sendEmail(gmail, { to, subject, body });
      return { content: [{ type: "text", text }] };
    }
  );

  return server;
}

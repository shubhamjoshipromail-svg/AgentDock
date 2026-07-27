import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { appendToDoc, createDoc, type DocsApi } from "./docs-tools";

// The first-party Google Docs MCP server. A real MCP server (official SDK),
// reached through the SAME generic client, gate, broker and audit path as every
// other tool — no execution code was added for it. The Docs client is injected so
// tests can mock the API; in production index.ts builds it from the user's OAuth
// token, which is read server-side and NEVER exposed to the calling agent.
export function createDocsMcpServer(deps: { getDocs: () => DocsApi | Promise<DocsApi> }): McpServer {
  const server = new McpServer({ name: "agentdock-docs", version: "0.1.0" });

  server.registerTool(
    "create_doc",
    {
      description:
        "Create a real Google Doc in the user's Drive with a title and body text, and return its link. External write — AgentDock requires approval before this runs.",
      inputSchema: {
        title: z.string().min(1).describe("Document title"),
        body: z.string().describe("Plain-text body of the document")
      }
    },
    async ({ title, body }) => {
      const docs = await deps.getDocs();
      const text = await createDoc(docs, { title, body });
      return { content: [{ type: "text", text }] };
    }
  );

  server.registerTool(
    "append_to_doc",
    {
      description:
        "Append plain text to the end of an existing Google Doc the user owns. External write — AgentDock requires approval before this runs.",
      inputSchema: {
        documentId: z.string().min(1).describe("The target document id"),
        text: z.string().min(1).describe("Text to append")
      }
    },
    async ({ documentId, text }) => {
      const docs = await deps.getDocs();
      const result = await appendToDoc(docs, { documentId, text });
      return { content: [{ type: "text", text: result }] };
    }
  );

  return server;
}

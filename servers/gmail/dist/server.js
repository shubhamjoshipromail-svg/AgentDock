"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createGmailMcpServer = createGmailMcpServer;
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const zod_1 = require("zod");
const gmail_tools_1 = require("./gmail-tools");
// The first-party Gmail MCP server. It is a real MCP server (official SDK),
// just trusted and first-party. The Gmail client is injected so tests can mock
// the API; in production index.ts builds it from the user's OAuth token, which
// is read server-side here and NEVER exposed to the calling agent.
function createGmailMcpServer(deps) {
    const server = new mcp_js_1.McpServer({ name: "agentdock-gmail", version: "0.1.0" });
    const emailShape = {
        to: zod_1.z.string().email().describe("Recipient email address"),
        subject: zod_1.z.string().min(1).describe("Email subject line"),
        body: zod_1.z.string().describe("Plain-text email body")
    };
    server.registerTool("create_draft", {
        description: "Create a Gmail draft in the user's own mailbox. Safe: writes only to Drafts, sends nothing.",
        inputSchema: emailShape
    }, async ({ to, subject, body }) => {
        const gmail = await deps.getGmail();
        const text = await (0, gmail_tools_1.createDraft)(gmail, { to, subject, body });
        return { content: [{ type: "text", text }] };
    });
    server.registerTool("send_email", {
        description: "Send a real email from the user's account. External write — AgentDock requires approval before this runs.",
        inputSchema: emailShape
    }, async ({ to, subject, body }) => {
        const gmail = await deps.getGmail();
        const text = await (0, gmail_tools_1.sendEmail)(gmail, { to, subject, body });
        return { content: [{ type: "text", text }] };
    });
    return server;
}

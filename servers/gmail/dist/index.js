"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const googleapis_1 = require("googleapis");
const server_1 = require("./server");
// Entry point for the first-party Gmail MCP server, spawned over stdio by the
// governed client. The user's OAuth access token is provided ONLY via the
// server-side environment (set by AgentDock from the encrypted, per-user token);
// it is never passed by, or exposed to, the calling agent.
function gmailFromEnv() {
    const token = process.env.GMAIL_ACCESS_TOKEN;
    if (!token) {
        throw new Error("GMAIL_ACCESS_TOKEN is required (set server-side by AgentDock).");
    }
    const auth = new googleapis_1.google.auth.OAuth2();
    auth.setCredentials({ access_token: token });
    return googleapis_1.google.gmail({ version: "v1", auth });
}
async function main() {
    const server = (0, server_1.createGmailMcpServer)({ getGmail: gmailFromEnv });
    await server.connect(new stdio_js_1.StdioServerTransport());
}
main().catch((error) => {
    console.error("[gmail-mcp] fatal:", error);
    process.exit(1);
});

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const server_1 = require("./server");
// Entry point for the first-party web-search MCP server, spawned over stdio by
// the governed client — reached identically to any other MCP server. Read-only:
// it needs no credential, so the broker injects nothing into its environment.
async function main() {
    const server = (0, server_1.createSearchMcpServer)();
    await server.connect(new stdio_js_1.StdioServerTransport());
}
main().catch((error) => {
    console.error("[search-mcp] fatal:", error);
    process.exit(1);
});

// Test fixture: a real MCP server, spawned as a real child process over stdio,
// whose only tool reports the environment variable NAMES it received.
//
// This exists so the env-isolation guarantee is proved against an actual spawned
// process — not against a mocked transport. If someone reverts the allowlist and
// goes back to spreading process.env, this fixture sees the host secrets and the
// test goes red.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "env-report", version: "0.0.1" });

server.registerTool(
  "report_env",
  { description: "Report the names of the environment variables this process received.", inputSchema: {} },
  async () => ({ content: [{ type: "text", text: Object.keys(process.env).sort().join(",") }] })
);

await server.connect(new StdioServerTransport());

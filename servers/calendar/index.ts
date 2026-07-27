import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { google } from "googleapis";

import { createCalendarMcpServer } from "./server";
import type { CalendarApi } from "./calendar-tools";

// Entry point for the first-party Google Calendar MCP server, spawned over stdio
// by the governed client. The user's OAuth access token is provided ONLY via the
// server-side environment (set by AgentDock from the encrypted, per-user token);
// it is never passed by, or exposed to, the calling agent.
function calendarFromEnv(): CalendarApi {
  const token = process.env.GOOGLE_ACCESS_TOKEN;
  if (!token) {
    throw new Error("GOOGLE_ACCESS_TOKEN is required (set server-side by AgentDock).");
  }
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: token });
  return google.calendar({ version: "v3", auth }) as unknown as CalendarApi;
}

async function main() {
  const server = createCalendarMcpServer({ getCalendar: calendarFromEnv });
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error("[calendar-mcp] fatal:", error);
  process.exit(1);
});

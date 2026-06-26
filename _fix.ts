import { prisma } from "./lib/prisma";
import { callMcpTool } from "./lib/execution/mcp-client";
async function main(){
  // 1. Make the existing search-mcp row executable.
  const upd = await prisma.mcpServer.updateMany({
    where: { registrySource: "agentdock-curated", registryId: "agentdock:search-mcp" },
    data: { mcpServerKey: "search", mcpToolName: "web_search", isExternalSend: false, credentialProvider: null }
  });
  console.log("search-mcp rows updated:", upd.count);
  // 2. Prove the real search server runs via the unified path.
  const res = await callMcpTool("search", "web_search", { query: "types of carp fish" }, {});
  console.log("search isError:", res.isError);
  console.log("search output (first 300):", res.text.slice(0, 300));
  await prisma.$disconnect();
}
main().catch((e)=>{ console.error("ERR", e); process.exit(1); });

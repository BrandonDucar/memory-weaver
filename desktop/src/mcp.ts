import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { MemoryWeaverRuntime } from "./runtime.js";

const jsonText = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

export const runMcpServer = async (configPath?: string): Promise<void> => {
  const runtime = await MemoryWeaverRuntime.open(configPath);
  const server = new McpServer({ name: "memory-weaver-local", version: "0.1.0" });

  server.registerTool("mesh_status", {
    description: "Inspect the local Memory Weaver vault and connector permissions.",
    inputSchema: {},
  }, async () => jsonText(await runtime.status()));

  server.registerTool("mesh_search", {
    description: "Search source titles and topics exposed to local MCP clients. Source content remains encrypted at rest.",
    inputSchema: { query: z.string().min(1), limit: z.number().int().min(1).max(50).default(20) },
  }, async ({ query, limit }) => jsonText(await runtime.search(query, limit, true)));

  server.registerTool("mesh_read", {
    description: "Read one local source only when its connector explicitly grants the mcp capability.",
    inputSchema: { sourceId: z.string().min(1) },
  }, async ({ sourceId }) => {
    const source = await runtime.readSource(sourceId, true);
    return source ? jsonText(source) : { content: [{ type: "text" as const, text: "Source not found" }], isError: true };
  });

  const transport = new StdioServerTransport();
  const shutdown = async (): Promise<void> => {
    await runtime.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  await server.connect(transport);
};

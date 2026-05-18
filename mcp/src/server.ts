#!/usr/bin/env bun
// Engram MCP server. Connects to watch.js over HTTP, speaks MCP over stdio.
//
// Run directly: `bun mcp/src/server.ts`
// Configure via env: ENGRAM_URL (default http://localhost:3001)
//
// To register with an MCP client (Claude Code, Claude Desktop, Cursor, etc.):
// see ../README.md.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { tools } from "./tools/index.js";
import { engramUrl, setAgentId } from "./client.js";

const server = new Server(
  { name: "engram", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

// Intercept the SDK's internal initialize handler to capture clientInfo and
// thread it as X-Engram-Agent on every backend call. watch.js logs that
// header on /mcp/*, attributing runs to "hermes/0.x", "claude-code/0.y", etc.
// (The "official" `server.oninitialized` + `getClientVersion()` path doesn't
// populate reliably in SDK 1.29 with the deprecated Server class — see
// mcp/ARCHITECTURE.md → Agent attribution.)
const _internalServer = server as unknown as {
  _oninitialize: (request: { params: { clientInfo?: { name?: string; version?: string } } }) => Promise<unknown>;
};
const originalOnInit = _internalServer._oninitialize.bind(server);
_internalServer._oninitialize = async (request) => {
  const info = request.params.clientInfo;
  if (info?.name) {
    const version = info.version ? `/${info.version}` : "";
    setAgentId(`${info.name}${version}`);
  }
  return originalOnInit(request);
};

// Build a lookup once at boot — tool names are stable per the architecture invariants.
const handlersByName = new Map(tools.map((t) => [t.def.name, t.handler]));
const definitions = tools.map((t) => t.def);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: definitions,
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const handler = handlersByName.get(name);
  if (!handler) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }
  try {
    return await handler(args ?? {});
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);

// Log startup to stderr — stdout is reserved for the JSON-RPC stream.
process.stderr.write(
  `engram-mcp v0.1.0 ready (${definitions.length} tools, backend=${engramUrl})\n`,
);

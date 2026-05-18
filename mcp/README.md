# Engram MCP Server

An [MCP](https://modelcontextprotocol.io/) server that exposes the Engram graph as tools any MCP-capable agent can use to scout, document, and highlight infrastructure neurons.

**Status**: Phase 1 — 6 tools (4 read, 2 write). See `TOOLS.md` for the full inventory and roadmap. Architecture invariants live in `ARCHITECTURE.md`.

---

## Prerequisites

1. Bun installed (`curl -fsSL https://bun.sh/install | bash`).
2. The Engram backend running: `bun /Users/vbusnita/Engram/watch.js` (port 3001).
3. Dependencies installed: from `mcp/`, run `bun install`.

The MCP server is a stdio process — your MCP client spawns it on demand. It connects to the backend over HTTP, so the backend must already be running.

---

## Registering with a client

### Claude Code

Add to `~/.claude/mcp.json` (or per-project `.mcp.json`):

```json
{
  "mcpServers": {
    "engram": {
      "command": "bun",
      "args": ["/Users/vbusnita/Engram/mcp/src/server.ts"]
    }
  }
}
```

Restart Claude Code. The 6 tools appear under the `engram` namespace.

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "engram": {
      "command": "bun",
      "args": ["/Users/vbusnita/Engram/mcp/src/server.ts"]
    }
  }
}
```

Quit and relaunch the desktop app.

### Cursor

Settings → MCP → Add server. Use the same `command` + `args` shape as above.

### Zed / Continue / Cline / other MCP clients

Same pattern: stdio transport, `command: "bun"`, `args: ["<absolute path>/mcp/src/server.ts"]`. Refer to the client's MCP docs for the exact config location.

### Non-MCP clients (Gemini, Copilot)

These don't speak MCP natively. Two options:

- Have the agent shell out to the backend directly: `curl http://localhost:3001/mcp/list_neurons`. Functional but tool-discovery isn't automatic.
- Run an MCP-to-OpenAI-function bridge (e.g. `mcp-bridge`) that translates this server's tools into OpenAI-style function definitions.

---

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `ENGRAM_URL` | `http://localhost:3001` | Where the backend listens. Override for remote Engram or non-default port. |

---

## Verifying it works

Quickest check, from the project root:

```sh
{
  printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'
  printf '%s\n' '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  printf '%s\n' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
} | bun mcp/src/server.ts
```

You should see the `initialize` response and a `tools/list` response containing 6 tools.

---

## Tools

| Tool | Purpose |
|---|---|
| `list_neurons` | Overview of all documented neurons |
| `get_neuron` | Full record + body + edges + highlight state |
| `list_boundaries` | Boundary groupings + edge stats |
| `list_highlights` | Currently flagged neurons |
| `create_neuron` | Write a new neuron from scouting output |
| `highlight` | Set/clear transient visual signal |

Each tool's full input schema is exposed via `tools/list` and visible in your MCP client. The agent reads the descriptions and chooses tools accordingly.

---

## Layout

```
mcp/
  ARCHITECTURE.md      design + invariants (read first if resuming)
  TOOLS.md             tool inventory and roadmap
  package.json
  src/
    server.ts          MCP entry point (stdio)
    client.ts          HTTP client to watch.js (single source of URLs)
    types.ts           shared Tool/Handler types
    tools/
      index.ts         registry
      <one file per tool>
```

Adding a tool: see `ARCHITECTURE.md` → "Adding a new tool — checklist".

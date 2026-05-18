# Engram MCP Server — Architecture

**Status**: Phase 1 implemented. See `TOOLS.md` for tool-by-tool status.
**Last updated**: 2026-05-17

This document is the contract. If a session loses context, read this + `TOOLS.md` + `../progress.md` to resume without breaking invariants.

---

## Purpose

Give any MCP-capable agent (Claude Code, Claude Desktop, Cursor, Zed, Continue, Cline, custom Hermes agent) a uniform way to read and write the Engram graph — so scouting, documenting, and highlighting infrastructure neurons doesn't require per-agent integration.

---

## Topology

```
  Agent (any MCP client)
       │  JSON-RPC 2.0 over stdio
       ▼
  bun mcp/src/server.ts        ← stateless protocol adapter
       │  HTTP/JSON (localhost:3001 by default)
       ▼
  watch.js                     ← source of truth: graph state, file watcher, SSE
       │
       ├─ neurons/*.md         ← persisted neurons
       └─ canvas.html          ← live 3D view (SSE-driven)
```

Each MCP client spawns its own `bun mcp/src/server.ts` subprocess. Multiple agents can run concurrently — they all point at the same `watch.js`, which serialises writes and broadcasts changes over SSE so the canvas stays live for everyone.

---

## Invariants (do not break)

1. **MCP server is stateless.** No caching, no local files. All state lives in `watch.js` / `neurons/`. If you find yourself adding a Map or a counter in the MCP server, stop. The one allowed module-level variable in the MCP server is `agentId` in `client.ts` (set once at initialize, read on every fetch — see "Agent attribution" below).
2. **Writes go through HTTP, not direct file I/O.** This keeps the watcher → SSE → canvas pipeline intact. Direct `writeFileSync` from MCP code would race the watcher and bypass validation.
3. **Logging lives in `watch.js`, never in the MCP server.** Per-request log entries go to `logs/engram-calls.jsonl` from the backend, which already does file I/O. The MCP server's only job re: attribution is to set the `X-Engram-Agent` header from MCP `clientInfo`.
4. **Each tool lives in its own file** under `src/tools/`. One tool = one file = one entry in `src/tools/index.ts`. Adding a tool must not require changes outside those two locations + the corresponding `client.ts` method.
5. **Tool names are stable.** Renaming a tool breaks every agent config that references it. If a tool's behaviour must change, deprecate first.
6. **Tool descriptions are agent-facing prose.** Agents pick tools based on these strings. Be specific about input/output and intent.
7. **No SDK version drift.** The `@modelcontextprotocol/sdk` version is pinned in `package.json`. Bumping it is a deliberate decision, not a side effect.

---

## Agent attribution

The MCP server intercepts the SDK's internal `_oninitialize` to capture `clientInfo` (name + version) from the very first request. That gets stored in a module-level `agentId` in `client.ts` and sent as `X-Engram-Agent: <name>/<version>` on every backend HTTP call.

`watch.js` reads that header on every `/mcp/*` request and writes it to the per-request log. So every action taken via this MCP server is attributable to whatever client (Hermes, Claude Code, Cursor, …) spawned it.

Non-MCP HTTP clients can — and should — set the header themselves (`curl -H 'X-Engram-Agent: gemini/foo' …`). If they don't, the log records `"unknown"`.

Why intercept rather than use `server.oninitialized` + `getClientVersion()`? The SDK's "official" path (the `Server` class is marked `@deprecated` in 1.29) doesn't populate `_clientVersion` reliably in this version. Reading `request.params.clientInfo` directly is the stable path. Revisit if/when we migrate to `McpServer`.

---

## File responsibilities

| File | Owns |
|---|---|
| `src/server.ts` | Entry point. Wires the tool registry to MCP's `tools/list` + `tools/call` handlers. Connects stdio transport. Nothing else. |
| `src/client.ts` | All HTTP calls to `watch.js`. Typed methods, one per backend endpoint. The only file that knows about URLs and fetch. |
| `src/types.ts` | Shared types: `Tool`, `ToolHandler`, response shapes. |
| `src/tools/index.ts` | Registry: an array `tools[]` that the server iterates. Adding a tool = adding one import + one entry. |
| `src/tools/*.ts` | One tool each. Exports a `Tool` definition (name, description, inputSchema) and a handler function. |

---

## Adding a new tool — checklist

1. Add the underlying HTTP endpoint to `watch.js` if it doesn't exist.
2. Add a typed method to `src/client.ts`.
3. Create `src/tools/<your-tool>.ts` exporting `<yourTool>Tool` and `<yourTool>Handler`.
4. Register it in `src/tools/index.ts`.
5. Add a row to `TOOLS.md` and tick `✅`.
6. If the input schema is non-trivial, add an example payload to the tool's JSDoc.

That's the entire change surface. Resist refactoring `server.ts` to special-case anything.

---

## Configuration

The MCP server reads `ENGRAM_URL` from its env. Default: `http://localhost:3001`. This is the only knob. Future ports (remote Engram, auth headers) extend this same pattern — don't add a config file until there are 3+ knobs.

---

## Transport choice

stdio. JSON-RPC over stdin/stdout. Reasons:

- Universal MCP client support (every client supports stdio first).
- No port conflicts; the agent spawns the server as a subprocess.
- Process isolation: kill the agent, the MCP server dies with it.

SSE/HTTP transport may come later for remote Engram instances; not now.

---

## Versioning

The MCP server's version (`package.json` → `version`) is independent from `watch.js`. Bump it when tools change. Patch = bug fix in handler logic; minor = new tool added; major = tool removed or input schema breaking change.

---

## Phase roadmap

See `TOOLS.md` for the live status. High-level:

- **Phase 1** (this session): Read tools + create_neuron + highlight. Wraps existing watch.js endpoints.
- **Phase 2**: Backfill the write gaps — update, delete, append_notes, add_edge, remove_edge, search. Requires new watch.js endpoints.
- **Phase 3**: Scouting helpers — `suggest_neuron_from_host`, `discover_subnet` (wraps nmap/arp), idempotent upsert.
- **Phase 4**: Multi-agent provenance — capture MCP `clientInfo` on every write so we know which agent did what.

---

## Anti-patterns observed previously

- **Renaming endpoints mid-session without updating callers** (the `/neuron` 404 mess in canvas.html before this rebuild). Never rename without grep.
- **Adding `await` to a sync handler** (the watch.js fetch handler before the rebuild). The MCP server's handlers are async by SDK contract — that's fine — but always check before adding await inside something that returns sync.
- **Validation drift** (schema YAML said one thing, watch.js enforced another). Single source: the schema file. Validation must mirror it.

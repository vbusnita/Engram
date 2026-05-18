# Engram

**Agent memory for infrastructure.** A persistent graph that any MCP-capable agent (Claude Code, Hermes, Cursor, Cline, custom loops) can read, scout against, and write back to. The graph compounds across sessions and across agents.

Engram is **not** a scanner. It doesn't run nmap, doesn't poll APIs, doesn't SSH anywhere. Discovery is the agent's job; Engram is the memory layer where findings get recorded and visualized.

See **[VISION.md](VISION.md)** for the full why-doc.

---

## Quick start

```sh
# 1. Install Bun if you don't have it
curl -fsSL https://bun.sh/install | bash

# 2. Clone and install MCP server deps
git clone <this repo> Engram && cd Engram
cd mcp && bun install && cd ..

# 3. Install the pre-commit secret scanner (recommended)
bin/install-hooks.sh

# 4. Run the backend
bun watch.js
```

The backend serves the canvas at **http://localhost:3001** and exposes graph + MCP HTTP endpoints. On first launch, sample neurons (in `neurons.example/`) seed your data directory so the canvas isn't empty.

---

## Where data lives

User data (real neurons, logs, scout artefacts) **never lives in the repo**. The backend reads/writes from a separate, OS-conventional directory:

| Platform | Default |
|---|---|
| macOS | `~/Library/Application Support/Engram/` |
| Linux | `$XDG_DATA_HOME/engram/` (default `~/.local/share/engram/`) |
| Override | `ENGRAM_DATA_DIR=/path/to/dir` |

Created with mode `0700`. The repo ships only `neurons.example/` (fictional, RFC 5737 IPs).

Full data-handling policy in **[SECURITY.md](SECURITY.md)**.

---

## Architecture

| Module | File | Role |
|---|---|---|
| Schema | `schema/neuron.schema.yaml` | Neuron frontmatter format |
| Backend | `watch.js` | Graph builder, HTTP/SSE, `/mcp/*` HTTP endpoints |
| Canvas | `canvas.html` | 3D rendering |
| MCP Server | `mcp/` | Stdio MCP adapter — see `mcp/README.md` |

---

## MCP client registration

Add Engram to your MCP-capable agent. See **[mcp/README.md](mcp/README.md)** for Claude Code, Claude Desktop, Cursor, and others.

Phase 1 tools (read + write):
- `list_neurons`, `get_neuron`, `list_boundaries`, `list_highlights`
- `create_neuron`, `highlight`

Phase 2 (in design — see `mcp/TOOLS.md`):
- `upsert_neuron`, `update_neuron`, `search_neurons`, `add_edge`, `append_notes`, `remove_edge`, `delete_neuron`

---

## Status

v1 in active development. Scope: homelab + small-org IT. Schema is extensible — cloud / k8s / security domains can land without breaking changes.

The agent loop (read → scout → write → repeat) is the load-bearing primitive. Distribution polish (LICENSE, CI, install script) lands after the loop closes end-to-end against a real device.

---

## Contributing

Open issues. Propose tools by adding rows to `mcp/TOOLS.md` with status `🧪`. Before any PR, run `bin/check-secrets.sh` on your staged changes and review **[SECURITY.md](SECURITY.md)** → contributor checklist.

---

## License

TBD — see [VISION.md](VISION.md) → "Distribution gaps".

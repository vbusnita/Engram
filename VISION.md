# Engram — Vision

**Status**: Draft, locked-in for v1. Read this before contributing.
**Last updated**: 2026-05-17

---

## The premise

Agents are getting good at running operations on infrastructure — scanning networks, querying APIs, reading configs, deploying changes. What they're bad at is **remembering what they did last time**.

Every scouting run starts from scratch. Every "what's on my network?" question re-discovers the same hosts. Findings live in chat transcripts that vanish at the end of a session. There's no shared memory across agents, across runs, or across the humans who eventually have to read the output.

**Engram is that shared memory.** It's a graph of the infrastructure an agent has touched, with the discovery context preserved alongside each node. Any agent — Claude Code, Hermes, Cursor, Cline, a custom Gemini wrapper, your own loop — reads it before acting and writes to it as it works. The graph compounds.

---

## The agent loop

Engram is designed around one repeating cycle:

```
   ┌──────────────────────────────────────────┐
   │                                          │
   │   1. Read state (list_neurons, get,      │
   │      search) — what's already known?     │
   │                                          │
   │   2. Decide what's worth investigating   │
   │      — new hosts, stale entries, gaps    │
   │                                          │
   │   3. Run discovery — agent's own tools   │
   │      (nmap, dig, API calls, ssh…)        │
   │                                          │
   │   4. Document findings (upsert_neuron,   │
   │      add_edge, append_notes)             │
   │                                          │
   │   5. Highlight ongoing operational       │
   │      signals during the run              │
   │                                          │
   └────────────────┬─────────────────────────┘
                    │
              repeat next session
```

The user prompt is high-level: *"map my home network"*, *"check the Proxmox cluster for changes since last time"*, *"what's exposed on the DMZ?"*. The agent figures out the rest.

---

## What Engram is — and isn't

### Engram **is**

- A **persistent graph** of infrastructure neurons and their relationships
- A **read/write memory layer** any MCP-capable agent (and any HTTP client) can use
- A **live 3D visualization** of the graph so a human can see what the agents see
- A **transient highlight overlay** so agents can signal "I'm working on this right now" or "this is broken"

### Engram **is not**

- **A scanner.** Engram doesn't run nmap, doesn't poll APIs, doesn't ssh anywhere. Discovery is the agent's job — Engram only stores what the agent finds.
- **A monitoring system.** It's not Prometheus, not Zabbix. Highlights are agent-driven signals, not metrics.
- **A configuration database.** Engram captures *what an agent observed*, not the canonical config. Source-of-truth lives in your actual systems (UniFi, Proxmox, etc.); Engram is the agent's recollection of having looked.
- **An identity store.** No users, no auth in v1. Localhost only.

These boundaries are deliberate. Every time someone asks "should Engram do X?" — if X is discovery, monitoring, or configuration, the answer is no. Push it back to the agent.

---

## The universal agent contract

For the "any agent can use this" promise to hold, the contract is small enough that anything implementing it works.

### What an agent needs to do

1. **Connect** — either via MCP stdio transport (preferred, automatic tool discovery), or via plain HTTP to `localhost:3001/mcp/*` (fallback for non-MCP agents).
2. **Read before writing** — call `list_neurons` / `get_neuron` / `search_neurons` so it doesn't duplicate or clobber existing work.
3. **Use the schema** — when creating neurons, conform to the documented frontmatter. Unknown entity_types are allowed (Engram won't reject them) but will render with the generic icon.
4. **Be idempotent** — use `upsert_neuron` for things that might already exist. Don't crash on conflicts.
5. **Clean up its highlights** — if you set `state: active` during a run, clear it when done. Highlights are signals, not logs.

That's the entire contract. An agent that does these five things works with Engram regardless of what model powers it or what framework wraps it.

### Two transports, one backend

```
  MCP-native agents          Non-MCP agents
  (Claude Code, Hermes,      (Gemini, raw OpenAI,
   Cursor, Cline, …)          custom loops, …)
         │                          │
         │ stdio                    │ HTTP
         │ JSON-RPC                 │ JSON
         ▼                          ▼
   mcp/src/server.ts          watch.js  /mcp/*
         │                          │
         └──────────┬───────────────┘
                    ▼
              watch.js core
              (graph + watcher + SSE)
```

The MCP server is a thin protocol adapter on top of the HTTP layer. Anything that can `curl` can talk to Engram. The MCP path just gives MCP-native clients automatic tool discovery and typed schemas for free.

---

## Worked examples

These are the kinds of flows v1 is built to support. The exact prompts will vary; the shape won't.

### 1. First-time home network scout

> "Map my home network. Use Engram for memory."

Agent reads `list_neurons` → empty → runs `arp -a` / `nmap -sn 10.0.1.0/24` → calls `upsert_neuron` for each host found → adds edges back to the gateway → highlights the gateway `active` while it's probing its config → clears highlights when done.

### 2. Follow-up scout

> "What's changed since last time?"

Agent reads `list_neurons` → has 17 hosts → re-runs discovery → compares → calls `update_neuron` on hosts whose IP or hostname changed → calls `create_neuron` for new arrivals → flags missing hosts as `warning` for human review.

### 3. Targeted investigation

> "The home gateway is acting up. Investigate."

Agent calls `get_neuron home-gateway` → reads the prior notes → highlights it `critical` → checks UniFi controller → appends findings to the neuron's notes via `append_notes` → either resolves (clears highlight) or escalates (leaves highlight + tags the human).

### 4. Cross-agent handoff

Agent A (Claude Code) scouts the Proxmox cluster, documents 12 VMs as neurons, highlights one as `warning` because it's running on a degraded node. Hours later, Agent B (Hermes on Grok) is asked to follow up. It calls `list_highlights`, sees the `warning`, calls `get_neuron` to read why, and continues from there. No human-readable summary required — the graph itself is the handoff.

---

## v1 scope vs. scale targets

### v1 (this OSS release)

- **Homelab + small-org IT.** Physical and virtual infrastructure on a private network: routers, switches, APs, hypervisors, VMs, containers, NAS, workstations.
- **Schema vocabulary**: `network`, `component`, `resource`, `security`, `device` — homelab-flavored.
- **Localhost only.** No remote Engram, no auth, no multi-tenant.
- **Six MCP tools** (see `mcp/TOOLS.md`) covering the read/write surface needed to close the agent loop.

### Designed-for, not yet implemented

The schema and architecture are extensible by construction. None of these require breaking changes — they require new entity_type values, new tools, or new endpoints. Listed so contributors know the trajectory:

- **Cloud accounts and SaaS** — AWS accounts, GitHub orgs, Okta tenants. New entity_types: `cloud_account`, `cloud_service`, `saas_app`. Same graph.
- **Kubernetes & containerized workloads** — clusters, namespaces, workloads as neurons; control-plane / data-plane edges.
- **Attack surface modelling** — for security-flavored use: exposed services, CVE attachments, blast-radius edges. Different highlight palette.
- **Remote Engram** — currently MCP server hits `localhost:3001`. The `ENGRAM_URL` env var already exists; adding TLS + bearer auth is a focused change in `watch.js` and `mcp/src/client.ts`.
- **Cross-agent provenance** — *foundation shipped*: `X-Engram-Agent` header + `logs/engram-calls.jsonl` already attribute every call to a named agent. Next steps: surface this on neurons themselves (`created_by` / `updated_by` frontmatter fields), expose a `recent_activity` MCP tool, build an audit feed.

---

## How runs are captured and reviewed

Engram is meaningless without a feedback loop — running an agent against it, seeing what works and what doesn't, fixing the gaps, running again. The repo treats this as first-class:

- Every `/mcp/*` call is logged to `logs/engram-calls.jsonl` with timestamp, agent identity, args, status, response, and duration.
- A scouting run is wrapped by `bin/run-hermes.sh` (or equivalents for other agents) which captures the prompt, slices the log to this run's window, exports the agent's transcript, and seeds a review template.
- Each run produces a `runs/<slug>/` folder with everything needed to review cold: the prompt, the call slice, the agent's transcript, and a `review.md` to fill in.
- Reviews categorise what the run revealed (schema / tool / vision / canvas / process gaps) and produce concrete actions naming the files to change.

See `runs/README.md` for the full workflow.

This is the loop the rest of the project depends on. Every Phase 2 tool, every schema field added, every doc update should trace back to a `review.md` Action in a `runs/<slug>/` folder.

### Hard non-goals

- **A general-purpose knowledge graph.** Engram is infrastructure-shaped. If your use case is "remember things about my codebase" or "remember things about my customers", build a separate graph — don't bend Engram.
- **Replacing CMDBs.** If you have a mature CMDB, Engram complements it (agent memory) rather than replacing it (source of truth).
- **A canvas-first product.** The canvas is for humans to glance at what agents are doing. It's not where work happens. Work happens through agents.

---

## Open-source readiness

### What ships today

- Engram backend (`watch.js`) — single Bun file, zero deps beyond Bun + stdlib.
- 3D canvas (`canvas.html`) — single HTML file, all rendering libs from CDN.
- MCP server (`mcp/`) — one dep (`@modelcontextprotocol/sdk`).
- Neuron schema (`schema/neuron.schema.yaml`).
- Documentation: this file, `mcp/ARCHITECTURE.md`, `mcp/TOOLS.md`, `mcp/README.md`, `CLAUDE.md`, `progress.md`.

### What's also shipped now (post-cleanup, 2026-05-18)

- **Data dir architecture** — `ENGRAM_DATA_DIR` defaults to `~/Library/Application Support/Engram/` (mac) or `$XDG_DATA_HOME/engram/` (linux), with `0700` perms. User data never lives in the repo working tree.
- **`neurons.example/`** — sanitized sample neurons using RFC 5737 IPs. Auto-seeded on first launch if the data dir is empty.
- **`SECURITY.md`** — full data-handling policy: where data lives, encryption guidance, leak recovery.
- **Defense in depth** — hardened `.gitignore`, pre-commit secret scanner (`bin/check-secrets.sh`), hook installer (`bin/install-hooks.sh`), GitHub server-side push protection.

### Distribution gaps still open

- Hardcoded absolute paths (`/Users/vbusnita/Engram/...`) in MCP client-registration examples — must become relative / discoverable.
- No `LICENSE` file.
- No version-pinning / release process.
- No install script (current install: clone, `bun install` in `mcp/`, `bin/install-hooks.sh`, `bun watch.js`).
- No CI.
- File-level encryption ("vault mode") deferred per `SECURITY.md`.

These come *after* the agent loop closes end-to-end with a real device. Premature distribution polish on a not-yet-working loop is wasted work.

---

## How to contribute (placeholder)

For now: open issues, propose tools by adding rows to `mcp/TOOLS.md` with status `🧪`. A proper CONTRIBUTING.md ships with the public release.

---

## TL;DR for AIs reading this in a new session

- Engram = **agent memory for infrastructure**.
- Agents read, scout, write back. Engram never scouts itself.
- Any MCP-capable agent works out of the box; anything else uses HTTP.
- v1 = homelab. Schema is extensible; cloud / k8s / security come later without breaking changes.
- The agent loop closes when `upsert_neuron`, `update_neuron`, `search_neurons`, `add_edge`, `append_notes` exist. Until then, the loop has gaps — see `mcp/TOOLS.md`.

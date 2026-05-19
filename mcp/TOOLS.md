# Engram MCP Tools — Inventory

**Last updated**: 2026-05-18
**Status legend**: ✅ implemented · ⏳ planned · 🧪 needs design

To resume work: this is the source of truth for which tools exist, which don't, and what's planned. Update it the moment a tool lands. The phase ranking reflects what the **agent loop in `../VISION.md`** actually needs — not a feature wishlist.

---

## Phase 1 — wraps existing watch.js endpoints

| Tool | Verb | Status | Backend endpoint | Purpose |
|---|---|---|---|---|
| `list_neurons` | read | ✅ | `GET /mcp/list_neurons` | Summary list of all real neurons |
| `get_neuron` | read | ✅ | `GET /mcp/get_neuron?id=` | Full record + body + edges + highlight state |
| `list_boundaries` | read | ✅ | `GET /mcp/list_boundaries` | Boundary stats |
| `list_highlights` | read | ✅ | `GET /mcp/list_highlights` | Current highlight overlay |
| `create_neuron` | write | ✅ | `POST /mcp/create_neuron` | Validates payload, writes `.md`, rebuilds graph |
| `highlight` | write | ✅ | `POST /mcp/highlight` | Set/clear transient pulse overlay |

---

## Phase 2 — close the agentic loop

Ordered by criticality for the read → scout → document → repeat cycle described in `../VISION.md`. The agent loop literally cannot close without the top-ranked tools — they're not nice-to-haves.

Each tool implies a backend endpoint that must be added to `watch.js` first.

| Rank | Tool | Verb | Status | Backend endpoint | Why it's at this rank |
|---|---|---|---|---|---|
| 1 | `upsert_neuron` | write | ✅ | `PUT /mcp/upsert_neuron` | Idempotent create-or-update. The scouting workhorse — agents call it without checking existence first. Merge semantics: incoming fields overwrite, omitted ones preserve, explicit null clears. New neurons require the create_neuron required-set; existing neurons only require `neuron_id`. Returns `{ok, action: "created"\|"updated"}`. Shipped 2026-05-18. |
| 2 | `update_neuron` | write | ⏳ | `PATCH /mcp/neuron/:id` | Update frontmatter on existing neurons (IP changed, source_system known now, tags refined). Required for follow-up scouts to actually refresh state. |
| 3 | `search_neurons` | read | ⏳ | `GET /mcp/search` | Filter by entity_type, source_system, boundary, tag, body-text. Agents need this to ask "all UniFi neurons?" without listing the whole graph and filtering client-side. |
| 4 | `add_edge` | write | ✅ | `PUT /mcp/edge` | Record relationships discovered *after* both endpoints already exist. Idempotent on (source, target, type) — re-adding the triple replaces weight/bidirectional/label. Source must exist; target can be missing (becomes phantom). Returns `{ok, action: "created"\|"updated"}`. Shipped 2026-05-18. |
| 5 | `append_notes` | write | ⏳ | `POST /mcp/append_notes` | Timestamped append to the neuron body. The operation log. Lets follow-up agents read what previous agents found and decided. |
| 6 | `remove_edge` | write | ⏳ | `DELETE /mcp/edge` | Counterpart to `add_edge`. Lower priority because deletions are rare in practice. |
| 7 | `delete_neuron` | write | ⏳ | `DELETE /mcp/neuron/:id` | Removes the `.md` file. Lowest because in practice agents should tag stale things, not delete them. Human operation more than agent one. |

---

## Phase 3 — scouting helpers

| Tool | Verb | Status | Notes |
|---|---|---|---|
| `suggest_neuron_id` | read | 🧪 | Given a hostname/IP/URL, propose a kebab-case `neuron_id` and `entity_type` |
| `discover_subnet` | write | 🧪 | Optional helper that calls nmap and bulk-upserts findings. Open question: does this live in MCP or in the agent? |

The "open question" on `discover_subnet`: pure-MCP tools should be I/O over the graph, not shell-out. A scouting agent already has shell access via its own tools (Bash, etc.); the MCP server's job is to receive the findings, not generate them. Lean toward: keep MCP graph-focused, let the agent drive nmap directly.

---

## Phase 4 — multi-agent provenance

| Tool change | Status | Notes |
|---|---|---|
| Capture `clientInfo` on every write | ⏳ | MCP `initialize` request carries `clientInfo.name` + `version`. Plumb into create/update/highlight as `created_by` / `updated_by` / `highlighted_by`. Stored in frontmatter (writes) or highlight overlay (transient). |
| `engram_recent_activity` | ⏳ | "What did agents do in the last N minutes?" — read-only audit feed |

---

## How to use this file

When implementing a tool:

1. Move its row's status to ✅.
2. If the row references a backend endpoint that didn't exist, add it to `watch.js` first and mark it as part of that tool's "done" state.
3. Commit `TOOLS.md` in the same change as the tool implementation, never separately.

When designing a new phase:

1. Add a section with the same shape as Phase 1.
2. Mark every tool 🧪 until input schema and backend endpoint are nailed down.
3. Move to ⏳ once design is approved and ready to implement.

# Progress Log — Engram

**Date**: May 2026
**Branch**: `refactor/infrastructure-focus`

---

## Current State

- Canvas loads and renders neurons cleanly. 0 warnings on boot.
- 3 real infrastructure neurons exist (`home-gateway`, `unifi-ap`, `macbook-pro`).
- Detail panel opens when clicking a neuron; markdown body + edges render.
- MCP endpoints implemented and tested end-to-end (see below).
- SSE rebroadcasts graph + highlight changes; clean reconnect on drop.
- All 4-band / Knowledge / Operations / Memory remnants removed from canvas.

---

## MCP Endpoints (HTTP, ready to wrap as MCP tools)

| Method | Path                       | Purpose                                       |
|--------|----------------------------|-----------------------------------------------|
| GET    | `/mcp/list_neurons`        | Summary list of all real neurons              |
| GET    | `/mcp/list_boundaries`     | Boundary stats                                |
| GET    | `/mcp/get_neuron?id=…`     | Full record + body + edges + highlight state  |
| POST   | `/mcp/create_neuron`       | Validates payload, writes `.md`, rebuilds     |
| POST   | `/mcp/highlight`           | Set/clear transient pulse overlay             |
| GET    | `/mcp/list_highlights`     | Current overlay state                         |

Highlight states: `critical | warning | active | monitoring | clear`.
Highlights are runtime-only (not persisted to neuron files) and broadcast over SSE.

---

## Cleanup Done This Session

### watch.js
- Fixed broken `/neuron` endpoint (incomplete `if` → null-deref guarded with proper 404).
- Removed duplicate `Access-Control-Allow-Origin` header on SSE response.
- Aligned `ENTITY_TYPES` / `EDGE_TYPES` validation with `neuron.schema.yaml`.
- Removed obsolete `SEMANTIC_ROLES`, `semantic_role`, `ops_state`, `health_state`,
  `resolved_at`, `color_hint`, `icon` fields from node records.
- Added in-memory `highlights` overlay + `graphWithHighlights()` injector.
- Added 6 MCP endpoints (above) + `renderNeuronMarkdown()` writer.
- Removed `/demo-graph` endpoint.

### canvas.html (380 lines removed)
- Removed band-rail (CSS + DOM + `updateBandRail` + `_bandVec` etc.).
- Removed `DOMAIN_Y` / `STRATIFY_STRENGTH` / `stratifyForce` (4-band physics).
- Removed demo brain (badge UI, `loadGraphWithDemoFallback`, `dismissDemo`,
  `updateDemoBadge`, SSE demo-fallback branch).
- Removed `LAYER_COLOR` (multi-domain palette) → single `INFRASTRUCTURE_COLOR`.
- Removed `OPS_STATE_COLOR` / `OPS_SEVERITY` / `computeOpsPropagation` /
  `decayAlpha` / `GHOST_DECAY_DAYS` / `isMemoryNode`.
- Removed `HEALTH_STATE_COLOR` + `activeHealthStates` + health filter UI.
- Removed `activeDomains` + domain filter UI + `DOMAIN_LABELS` + `TB_SHORTCUTS`
  keys for removed domains.
- Renamed `pulseOpsNeurons` → `pulseHighlights`, wired to `node.highlight.state`
  fed by MCP `/mcp/highlight`.
- Simplified `createNodeObject`, `createEdgeObject`, `nodeLayerVisible`,
  `applyHullFilter`, `buildLegend`, `toggleFilter`.
- Replaced `loadGraphWithDemoFallback` with plain `loadGraph`.
- Updated `ENTITY_ICON` to match new schema (component/resource/network/security/device).

### Neuron files
- Added required `discovery_method: manual` and `confidence_score: 1.0` to
  `home-gateway`, `unifi-ap`, `macbook-pro` so they validate without warnings.

---

## Roadmap / Next Steps

### Short Term
- [ ] Wrap the `/mcp/*` HTTP endpoints in a real MCP server (stdio transport).
- [ ] Hermes integration: have an agent populate neurons via `create_neuron`.
- [ ] Add `update_neuron` (edit frontmatter + body) and `delete_neuron`.
- [ ] Visual: focus mode could pull cluster from MCP `get_neuron` edges_in/out
      instead of re-walking `simLinks` in the client.

### Medium Term
- [ ] Edge editing from the detail panel.
- [ ] A "scout" routine that pings the home network and creates neurons.
- [ ] Notes append API (`POST /mcp/append_notes`) for operation history.

### Longer Term
- [ ] Auth on MCP endpoints if exposed beyond localhost.
- [ ] Document the neuron schema + MCP tool contract for downstream agents.

---

## Notes

- Canvas is intentionally minimal; the data layer is now the load-bearing piece.
- Highlights are transient by design: `/mcp/highlight` does not modify files,
  so an agent can flash a neuron during an op and the map returns to neutral
  the moment the highlight is cleared (or the server restarts).
- The watcher (fs.watch on `neurons/`) debounces 120ms and broadcasts
  `graph-update` over SSE — external writes to the `.md` files also propagate.

---

## Session Log

### 2026-05-18 (continued) — First three scouts, Phase 2 underway, canvas redesign

**Trigger**: Test Engram + Hermes + MCP end-to-end against a real home network, then iterate on canvas + tool gaps as they surfaced.

**Scouts run** (artefacts in `$ENGRAM_DATA_DIR/runs/<slug>/`):

1. **`first-scout-home`** — 17 Engram calls, 1 error (409 dup), 8 new neurons, 2 highlights. Confirmed the canonical read→discover→write→highlight loop works. Surfaced: `upsert_neuron` need, transcript auto-export broken, agent attribution wrong (logs `mcp/0.1.0` not `hermes/0.14.0`).
2. **`second-scout-deep`** — 17 calls, **zero errors**, 3 new + 9 refined, fixed all 3 `_unbound` boundary bugs. Grok made an architectural decision unprompted: kept `boundary` flat and used `tags` (iot, media, ev, nas/storage…) for orthogonal grouping. Flagged 2 unknown devices as `warning` highlights. Real security value.
3. **`third-scout-enrich`** — 27 calls. Ran add_edge across the existing graph to declare logical relationships beyond layer-2 connectivity. **Not yet reviewed** — `runs/third-scout-enrich/review.md` blank, ready for next session.

**Load-bearing bugs found + fixed this session**:
- **YAML parser dropped all edges** — `parseYaml` preferred the "simple scalar" regex over the "object key:value" regex, so `- target: home-gateway` was parsed as a string instead of an object. Every edge silently disappeared; canvas showed 11 floating disconnected nodes. Fix: swap regex order, try object form first. Caught only because the canvas exposed it.
- **TDZ on `_cameraSizeFactor`** — `let _cameraSizeFactor = 1.0;` was below `initThree()`, so the first frame of `animate()` referenced it pre-init. Fixed by hoisting the size constants up next to other visual constants.
- **Highlights vanish on server restart** — by design (runtime-only overlay) but bad UX. Long-lived critical/warning probably should persist; transient active/monitoring shouldn't. Noted as future work.

**Phase 2 MCP tools shipped**:
- `upsert_neuron` (priority #1) — `PUT /mcp/upsert_neuron`. Idempotent create-or-update keyed on neuron_id. Merge semantics: incoming fields overwrite, omitted ones preserve, explicit null clears. Eliminated the 409 problem from scout #1.
- `add_edge` (priority #4) — `PUT /mcp/edge`. Idempotent on (source, target, type). Source must exist; target can be missing (phantom). Lets agents declare logical relationships post-creation: depends_on, manages, monitors, contains, etc.

Both tools moved to ✅ in `mcp/TOOLS.md`. Remaining Phase 2: `update_neuron` (#2 — partly subsumed by upsert but distinct semantics), `search_neurons` (#3), `append_notes` (#5), `remove_edge` (#6), `delete_neuron` (#7).

**Canvas redesign — full visual overhaul over ~10 iterations** (`canvas.html`):
- **Colours by entity_type** — five categorical hues (network blue, device purple, component green, resource amber, security red). Replaced single-blue `INFRASTRUCTURE_COLOR` + source_system tints. The toolbar still has source_system in a comment but the active palette is `ENTITY_HUE`.
- **Cluster force keyed on entity_type** (primary, strength 0.30) + boundary (secondary, 0.10). Same-coloured neurons group. `_unbound` opts out of the boundary force only — still participates in type clustering.
- **Polygon-mesh lattice per cluster** — for each entity_type cluster, every neuron connects to its 3 nearest cluster-mates via thin LineSegments in cluster colour. NOT data; pure visual scaffold rebuilt every 6 sim ticks. Single draw call per cluster. Hidden when the cluster's filter chip is off.
- **Tight layout** — `LINK_DISTANCE 160→70`, `CHARGE_STRENGTH -600→-260`, `forceCenter strength 0.04→0.10`. The whole graph reads as one tight assembly instead of satellite blobs.
- **Bottom toolbar = entity_type filter** — renamed `activeSources → activeEntityTypes` throughout, rewrote `buildLegend` to enumerate types with `ENTITY_HUE` swatches. Canonical order: network → device → component → resource → security. Filter chips toggle whole clusters (spheres + edges + lattice).
- **Pulse rewrite for attention signal** — `ATTENTION_COLOR 0xff1830` overrides entity_type emissive while a highlight is set. Frequencies bumped 2-4× (critical 2.4 Hz, warning 1.8 Hz, active 1.5 Hz, monitoring 1.3 Hz). Peak emissive 3.4–5.0. Halo also turns red. `baseEmissive` cached on each `nodeObject` so we restore properly when the highlight clears.
- **Camera-distance sphere/edge sizing** — `updateCameraSizeFactor()` per frame. `SIZE_REF_DIST=700`, factor clamped `[0.45, 1.00]`. Spheres + edge radius scale by factor so screen-size stays roughly constant as you zoom. `SPHERE_RADIUS` dropped 5.78 → 3.0 absolute. Resolves "everything obstructs the view when zoomed in" complaint.
- **Curved edges experiment reverted** — briefly tried Catmull-Rom dendritic tubes; operator clarified preference was geometric/mesh over organic/biological. Reverted to straight cylinders.

**Connection strategy** (clarified late in session): two distinct systems on the canvas:
1. Bright cylinders = real data edges declared by agents (currently mostly star-to-gateway).
2. Faint coloured lines = structural mesh, proximity-based, NOT data.

`add_edge` exists now so future scouts can fatten (1) — operator chose this over dropping (2) or visually disambiguating them.

**To resume next session**:
1. **Review `third-scout-enrich/review.md`** — write it up based on `engram-calls.jsonl`, `hermes-stdout.txt`. Look for what edges Grok declared, by type, with what confidence.
2. **Decide next Phase 2 tool**. With upsert + add_edge done, the remaining ranked list is:
   - `update_neuron` (#2) — mostly subsumed by upsert. Worth shipping? Keep partial-PATCH semantics distinct? Worth a design conversation.
   - `search_neurons` (#3) — at 14 neurons not yet bottleneck. Becomes load-bearing at 50+.
   - `append_notes` (#5) — actually a real gap. Upsert replaces the body each time; agents lose context between scouts.
3. **Hermes transcript auto-export still broken** — regex in `bin/run-hermes.sh` doesn't match Hermes 0.14.0 output. Fix when convenient.
4. **Agent attribution still wrong** — calls log `mcp/0.1.0` instead of `hermes/0.14.0`. The intercept logic in `mcp/src/server.ts` reads its own clientInfo, not the incoming one.

---

### 2026-05-18 — Repo cleanup + rename to Engram + security hardening

**Trigger**: Prepare repo for public push to GitHub as `Engram`. Operator
flagged that previous direction's cruft was still in the tree and that
naming hadn't been refactored.

**Cleanup**:
- Deleted `drafts/` (9 old KCP design docs), `imported/`, `.obsidian/`,
  `Untitled.canvas`, `demo-graph.json`, `plan.md`, `project-state.md`.
- Removed dead code in `watch.js`: `/files`, `/content`, `/import`,
  `/browse`, `/import-path` endpoints + the `IMPORTS` watcher + the root
  `DIR` watcher that broadcast a `update` event nothing listened to.
- Removed `debouncedBroadcast` + the unused `unlinkSync`/`resolve` imports.

**Rename**:
- KCP → Engram in `watch.js`, `canvas.html`, `schema/neuron.schema.yaml`,
  `schema/known_systems.json`, `CLAUDE.md`, `mcp/README.md`,
  `runs/README.md`, `VISION.md`.
- Module table in `CLAUDE.md` renamed (Synapse/Cortex → Backend/Canvas).

**Security architecture (new — this is the load-bearing change)**:
- **Data dir outside the repo**: `watch.js` now reads/writes neurons,
  logs, and run artefacts from `ENGRAM_DATA_DIR`, defaulting to
  `~/Library/Application Support/Engram/` (mac) or
  `$XDG_DATA_HOME/engram/` (linux). Created with mode `0700`.
- **`neurons.example/`** ships in the repo with 3 sanitized samples
  using RFC 5737 IPs (`192.0.2.x`). On first launch, auto-seeded into
  the data dir if empty (`ENGRAM_SKIP_SEED=1` to disable).
- **Migrated** the 3 existing real neurons + logs out of the working
  tree into the data dir.
- **`bin/run-hermes.sh`** now writes to `$ENGRAM_DATA_DIR/runs/`.
- **Hardened `.gitignore`** with patterns for `.env*`, `*.pem`/`*.key`,
  ssh keys, IDE/OS junk, and defensive entries for data dirs.
- **Pre-commit secret scanner** — `bin/check-secrets.sh` catches AWS
  keys, GitHub/Slack tokens, private-key headers, hardcoded
  password/secret assignments. Installed via `bin/install-hooks.sh`.
- **`SECURITY.md`** — policy doc: data location, OS-level encryption
  guidance, leak recovery (rotate + `git filter-repo`), reporting via
  GitHub security advisories.
- **`REVIEW_TEMPLATE.md`** — added required sensitive-data check
  section since `review.md` files DO get committed.

**Architecture decisions locked in**:
- File-level encryption (age/libsodium) deferred. Rationale in
  `SECURITY.md`: the live `fs.watch` → SSE → canvas pipeline depends
  on plaintext reads; adding it is a substantive change, not free.
  OS-level disk encryption (FileVault/LUKS/BitLocker) is the v1
  at-rest layer.
- `node.file` in the graph now stores absolute paths (was
  repo-relative). Necessary because the data dir is no longer under
  `import.meta.dir`.
- Warnings still display `relative(DATA_DIR, …)` paths for human
  readability.

**Smoke test passed**: server boots, reports `data: ~/Library/...`,
finds 3 migrated neurons, `/graph` returns them with absolute paths,
secret scanner catches AWS/GitHub/private-key/password patterns and
passes clean on the real source files.

**Next session**:
1. Run `bin/install-hooks.sh` if not already done.
2. Push to GitHub as public `Engram` repo.
3. Enable secret-scanning push protection via `gh api`.
4. Then continue with Phase 2 of MCP — `upsert_neuron` is #1.

---


### 2026-05-17 — Phase 1 MCP server stood up

**Goal**: Turn the `/mcp/*` HTTP endpoints into a real MCP server any agent can use.

**Built**:
- `mcp/` module with `@modelcontextprotocol/sdk@1.29.0`, stdio transport.
- 6 tools, each in its own file under `mcp/src/tools/`:
  `list_neurons`, `get_neuron`, `list_boundaries`, `list_highlights`,
  `create_neuron`, `highlight`.
- `mcp/src/client.ts` is the single owner of HTTP calls to `watch.js`.
- `mcp/src/server.ts` wires the tool registry to `tools/list` + `tools/call`.
- Continuity anchors: `mcp/ARCHITECTURE.md` (design + invariants) and
  `mcp/TOOLS.md` (tool inventory with ✅/⏳/🧪 status).
- `mcp/README.md` documents registration for Claude Code, Claude Desktop,
  Cursor, and non-MCP agent fallbacks.

**Smoke-tested**:
- `initialize` handshake, `tools/list` returns 6 tools with full schemas,
  `tools/call list_neurons` returns the 3 real neurons.
- Write path: `highlight` sets warning state, persists in backend,
  visible via `/mcp/list_highlights`, cleared cleanly.

**Architecture invariants** (do not break — these are in `mcp/ARCHITECTURE.md`):
1. MCP server is stateless. All state in `watch.js` / `neurons/`.
2. Writes go through HTTP, never direct file I/O.
3. One tool = one file + one registry line. No exceptions.
4. Tool names are stable; rename = break every agent config.

**What's not done yet** (Phase 2):
- `update_neuron`, `delete_neuron`, `append_notes`, `add_edge`, `remove_edge`,
  `search_neurons`. Each needs a new `watch.js` endpoint first.
- Tracked tool-by-tool in `mcp/TOOLS.md`.

**To resume next session**:
1. Read `CLAUDE.md` → "Resume-fast checklist".
2. Read this session log entry.
3. Read `mcp/TOOLS.md` to see which Phase 2 tool to pick up first.
4. Pattern for adding a tool: see `mcp/ARCHITECTURE.md` →
   "Adding a new tool — checklist".

### 2026-05-17 (continued) — Vision locked, Phase 2 reranked

**Trigger**: User clarified Engram is for agentic flows, not manual neuron entry.
The MCP wiring is correct; the test-prompt shape I'd suggested was wrong
(manual create steps don't reflect how the system is meant to be used).

**Decisions locked in**:
- **Audience**: homelab + small-org IT (both).
- **Discovery model**: pure memory. Engram never scouts. Agents own discovery
  via their own tools. This is now codified in `VISION.md`'s non-goals.
- **v1 schema scope**: homelab-flavored vocab (`network/component/resource/
  security/device`), but extensible by construction — unknown entity_types
  are accepted with a warning, render with generic icon. Cloud / k8s /
  security expansions slot in without breaking changes.
- **Universal contract**: MCP for MCP-native agents (Claude Code, Hermes,
  Cursor, Cline, …); plain HTTP `/mcp/*` for everything else (Gemini,
  custom loops). Same backend, two transports.

**Written**:
- `VISION.md` — the canonical why-doc. Reads before any code change.
- Reranked `mcp/TOOLS.md` Phase 2 — `upsert_neuron` is now #1 because the
  agent loop can't close without it. `update_neuron` #2, `search_neurons` #3,
  `add_edge` #4, `append_notes` #5, `remove_edge` #6, `delete_neuron` #7.
- `CLAUDE.md` resume-fast checklist now starts at `VISION.md`.

**OSS distribution**: deferred. The user is intentionally not designing
distribution shape until the agent loop closes end-to-end with a real
device. Gap list (hardcoded paths, no root README, no LICENSE, no CI)
captured in `VISION.md` → "Open-source readiness".

**To resume next session**:
1. Read `VISION.md` first. Everything else follows from it.
2. Pick `upsert_neuron` as Phase 2 starting point. Implement the backend
   endpoint in `watch.js`, then the MCP tool file in `mcp/src/tools/`.
3. Then `search_neurons` (because real scouting needs filtered reads).
4. Save Hermes-with-Grok-4.3 testing for after `upsert_neuron` lands —
   the manual-test workaround (check exists, then create) is too fragile
   to be the first real scouting run.

### 2026-05-17 (continued) — Run capture + review infrastructure

**Trigger**: Operator asked how reveals from Hermes test runs get
documented so both Claude Code and the operator can review and fix gaps.

**Built**:
- **Per-request log in `watch.js`** — every `/mcp/*` request appends a JSON
  line to `logs/engram-calls.jsonl`: ts, agent, method, path, args, status,
  response, duration_ms. Wraps the entire fetch handler; non-MCP routes
  bypass the wrapper for performance. ~30 lines net change.
- **`X-Engram-Agent` header in MCP server** — intercepts the SDK's
  `_oninitialize` (deprecated `Server` class doesn't populate
  `_clientVersion` reliably in 1.29), captures `clientInfo`, stores in
  `client.ts` module-level `agentId`, sends on every backend fetch.
- **`bin/run-hermes.sh`** — wraps `hermes -z` invocations, captures prompt,
  slices the call log for this run window, exports Hermes session if it
  can extract the session_id, drops a pre-filled `review.md`.
- **`runs/REVIEW_TEMPLATE.md`** — structured review: outcome, tools used,
  tools the agent wanted but couldn't find, errors, reveals
  (schema/tool/vision/canvas/process), concrete actions naming target files.
- **`runs/README.md`** — workflow doc for capturing and reviewing runs,
  including manual fallbacks for non-Hermes agents.
- **`.gitignore`** — keeps prompts + reviews; ignores transcripts, logs,
  and call slices (large, regenerable).

**Smoke-tested**:
- Per-request logging works — captured a full MCP session with multiple
  tool calls; each line has correct ts, args, status, duration.
- Agent attribution works — initialised the MCP server with
  `clientInfo: {name: "hermes-smoke", version: "0.1"}`, log lines came
  back as `"agent": "hermes-smoke/0.1"`.

**Architecture changes documented in `mcp/ARCHITECTURE.md`**:
- New invariant #3: logging lives in `watch.js`, never the MCP server.
- New section "Agent attribution" explains the `clientInfo` interception
  workaround and why it exists.

**VISION.md updated**:
- "Designed-for" → "Cross-agent provenance" now shows *foundation
  shipped* — the header + log are in place; surfacing on neurons is the
  remaining work.
- New section "How runs are captured and reviewed" — declares that every
  Phase 2 change should trace back to a `review.md` action.

**What this unblocks**:
- The first real Hermes scouting run can now produce a reviewable
  artefact end-to-end. The `review.md` is the closing of the feedback
  loop — distilled gaps go into `mcp/TOOLS.md` (🧪 rows), `VISION.md`
  (scope), or directly into code work.

**To resume next session**:
1. Read `VISION.md` and `runs/README.md`.
2. With the capture infra in place, the next decision is: implement
   `upsert_neuron` first (so the run isn't crippled by duplicate-id
   conflicts), or run Hermes once with what we have and let the gaps
   surface naturally?
3. Recommendation: implement `upsert_neuron` first. It's small (one
   backend endpoint + one tool file), it's already at #1 in
   `mcp/TOOLS.md`, and the very first follow-up scout would hit the
   409-on-duplicate issue immediately.


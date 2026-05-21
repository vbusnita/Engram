// watch.js — Engram backend (graph builder, HTTP/SSE, MCP HTTP endpoints)
// Usage: bun watch.js
// Opens: http://localhost:3001

import { watch } from "fs";
import { readFileSync, readdirSync, mkdirSync, existsSync, writeFileSync, statSync, appendFileSync, chmodSync, cpSync } from "fs";
import { join, relative } from "path";
import { homedir, platform } from "os";

const DIR      = import.meta.dir;
const EXAMPLES = join(DIR, "neurons.example");

// ─── Data directory resolution ──────────────────────────────────────────────
// User data NEVER lives in the repo. Default to an OS-conventional location;
// override with ENGRAM_DATA_DIR. The dir is created with 0700 perms so other
// local accounts can't read it. The repo only ships neurons.example/.
function resolveDataDir() {
  const override = process.env.ENGRAM_DATA_DIR;
  if (override) return override;
  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "Engram");
  }
  const xdg = process.env.XDG_DATA_HOME;
  return join(xdg || join(homedir(), ".local", "share"), "engram");
}

const DATA_DIR = resolveDataDir();
const NEURONS  = join(DATA_DIR, "neurons");
const LOGS     = join(DATA_DIR, "logs");
const CALL_LOG = join(LOGS, "engram-calls.jsonl");
const PORT     = 3001;
const enc      = new TextEncoder();

function ensureDir(path, mode) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
  try { chmodSync(path, mode); } catch {}
}

ensureDir(DATA_DIR, 0o700);
ensureDir(NEURONS,  0o700);
ensureDir(LOGS,     0o700);

// First-run seeding: if neurons/ is empty AND examples ship in the repo,
// copy them in so the canvas isn't empty on a fresh install. Set
// ENGRAM_SKIP_SEED=1 to disable.
if (
  process.env.ENGRAM_SKIP_SEED !== "1" &&
  existsSync(EXAMPLES) &&
  readdirSync(NEURONS).filter(f => f.endsWith(".md")).length === 0
) {
  for (const file of readdirSync(EXAMPLES)) {
    if (file.endsWith(".md")) cpSync(join(EXAMPLES, file), join(NEURONS, file));
  }
  console.log(`✓  seeded ${NEURONS} from neurons.example/`);
}

// ─── Per-request log for /mcp/* — the artefact that run-review reads ───────
// One JSONL line per MCP call. Attribution comes from X-Engram-Agent header
// (the MCP server sets this from MCP clientInfo; HTTP clients can set their own).
function appendCallLog(entry) {
  try {
    appendFileSync(CALL_LOG, JSON.stringify(entry) + "\n");
  } catch (e) {
    console.error("call log write failed:", e?.message);
  }
}

// ─── Valid ontology enums (from schema/neuron.schema.yaml) ──────────────────

const ENTITY_TYPES = new Set([
  "component", "resource", "network", "security", "device",
]);
const EDGE_TYPES = new Set([
  "connected_to", "depends_on", "routes_to",
  "manages", "monitors", "authenticates", "contains",
]);

// ─── YAML frontmatter parser (zero dependencies) ───────────────────────────

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  return parseYaml(match[1]);
}

function parseYaml(text) {
  const result = {};
  const lines = text.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    // skip blank lines and comments
    if (!line.trim() || line.trim().startsWith("#")) { i++; continue; }

    const kvMatch = line.match(/^(\w[\w_-]*):\s*(.*)/);
    if (!kvMatch) { i++; continue; }

    const key = kvMatch[1];
    let val = kvMatch[2].trim();

    // array block (next lines start with "  - ")
    if (val === "" && i + 1 < lines.length && lines[i + 1].match(/^\s+-\s/)) {
      const arr = [];
      i++;
      while (i < lines.length && lines[i].match(/^\s+-/)) {
        const itemLine = lines[i];
        // Try complex (object) first: "- key: value" indicates an object item.
        // Otherwise fall through to simple scalar handling.
        const firstKv = itemLine.match(/^\s+-\s+(\w[\w_-]*):\s*(.*)/);
        if (firstKv) {
          const obj = {};
          obj[firstKv[1]] = castValue(firstKv[2].trim());
          i++;
          while (i < lines.length) {
            const contMatch = lines[i].match(/^\s{4,}(\w[\w_-]*):\s*(.*)/);
            if (contMatch) {
              obj[contMatch[1]] = castValue(contMatch[2].trim());
              i++;
            } else break;
          }
          arr.push(obj);
        } else {
          const simpleMatch = itemLine.match(/^\s+-\s+"?([^"]*)"?\s*$/);
          if (simpleMatch) arr.push(castValue(simpleMatch[1]));
          i++;
        }
      }
      result[key] = arr;
      continue;
    }

    // inline array: [a, b, c]
    if (val.startsWith("[") && val.endsWith("]")) {
      const inner = val.slice(1, -1);
      result[key] = inner ? inner.split(",").map(s => castValue(s.trim().replace(/^["']|["']$/g, ""))) : [];
      i++;
      continue;
    }

    result[key] = castValue(val);
    i++;
  }
  return result;
}

function castValue(v) {
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null" || v === "") return null;
  // strip surrounding quotes
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
    return v.slice(1, -1);
  const n = Number(v);
  if (!isNaN(n) && v !== "") return n;
  return v;
}

// ─── Knowledge Graph ────────────────────────────────────────────────────────

let knowledgeGraph = { nodes: [], edges: [], boundaries: [], meta: {} };
const graphWarnings = [];

// Runtime-only highlight overlay. Not persisted to neuron files —
// highlights are transient visual signals from agent operations.
// Map<neuron_id, { state, reason, since, auto? }>  state ∈ critical|warning|active|monitoring
// auto:true marks pulses set by pulseActivity() (write side-effect, self-clearing);
// without it, the entry is a deliberate /mcp/highlight call from an agent.
const highlights = new Map();
const HIGHLIGHT_STATES = new Set(["critical", "warning", "active", "monitoring"]);

// Auto-pulse: every write (create/upsert/add_edge) flashes the affected neurons
// `active` for ACTIVITY_PULSE_MS so the canvas always shows what the agent is
// doing right now, even when the agent never calls /mcp/highlight itself. A
// manual highlight on the same neuron always wins — auto entries never stomp
// manual ones, and the auto timer never clears a manual highlight.
const ACTIVITY_PULSE_MS = 2000;
const activityTimers = new Map(); // neuron_id -> Timeout

function pulseActivity(neuron_id) {
  if (!neuron_id) return;
  const existing = highlights.get(neuron_id);
  if (existing && !existing.auto) return; // manual wins — don't touch it

  highlights.set(neuron_id, {
    state: "active",
    reason: "auto:write",
    since: new Date().toISOString(),
    auto: true,
  });

  const prev = activityTimers.get(neuron_id);
  if (prev) clearTimeout(prev);
  const handle = setTimeout(() => {
    activityTimers.delete(neuron_id);
    const h = highlights.get(neuron_id);
    if (h && h.auto) {
      highlights.delete(neuron_id);
      broadcast("graph-update", graphWithHighlights());
    }
  }, ACTIVITY_PULSE_MS);
  activityTimers.set(neuron_id, handle);
}

function cancelActivityTimer(neuron_id) {
  const t = activityTimers.get(neuron_id);
  if (t) { clearTimeout(t); activityTimers.delete(neuron_id); }
}

function graphWithHighlights() {
  const nodes = knowledgeGraph.nodes.map(n => {
    const h = highlights.get(n.id);
    return h ? { ...n, highlight: h } : n;
  });
  return { ...knowledgeGraph, nodes };
}

// Render a neuron object (from create_neuron payload) into a YAML+markdown file body.
function renderNeuronMarkdown(d) {
  const lines = ["---"];
  const scalar = (k, v) => { if (v != null && v !== "") lines.push(`${k}: ${v}`); };
  scalar("neuron_id",        d.neuron_id);
  scalar("display_name",     d.display_name);
  scalar("entity_type",      d.entity_type);
  scalar("source_system",    d.source_system);
  scalar("boundary",         d.boundary);
  scalar("source_uri",       d.source_uri);
  scalar("discovery_method", d.discovery_method);
  scalar("discovered_at",    d.discovered_at || new Date().toISOString());
  scalar("confidence_score", d.confidence_score);
  if (Array.isArray(d.tags) && d.tags.length) {
    lines.push("tags:");
    for (const t of d.tags) lines.push(`  - ${t}`);
  }
  if (Array.isArray(d.edges) && d.edges.length) {
    lines.push("edges:");
    for (const e of d.edges) {
      lines.push(`  - target: ${e.target}`);
      lines.push(`    type: ${e.type}`);
      if (e.weight != null) lines.push(`    weight: ${e.weight}`);
      if (e.bidirectional)  lines.push(`    bidirectional: true`);
      if (e.label)          lines.push(`    label: ${e.label}`);
    }
  }
  lines.push("---", "");
  if (d.notes) lines.push(d.notes.trimEnd(), "");
  return lines.join("\n");
}

function scanNeuronFiles(dir) {
  const files = [];
  if (!existsSync(dir)) return files;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      files.push(...scanNeuronFiles(full));
    } else if (e.name.endsWith(".md")) {
      files.push(full);
    }
  }
  return files;
}

function validateNeuron(fm, filePath) {
  const errors = [];
  if (!fm.neuron_id)          errors.push("missing neuron_id");
  if (!fm.entity_type)        errors.push("missing entity_type");
  if (!fm.display_name)       errors.push("missing display_name");
  if (!fm.source_uri && fm.discovery_method !== "manual")
                              errors.push("missing source_uri");
  if (!fm.discovery_method)   errors.push("missing discovery_method");
  if (fm.confidence_score == null) errors.push("missing confidence_score");

  // enum validation (warn but don't reject — extensibility)
  if (fm.entity_type && !ENTITY_TYPES.has(fm.entity_type))
    errors.push(`unknown entity_type: ${fm.entity_type}`);
  if (fm.confidence_score != null && (fm.confidence_score < 0 || fm.confidence_score > 1))
    errors.push(`confidence_score out of range: ${fm.confidence_score}`);

  return errors;
}

function buildGraph() {
  graphWarnings.length = 0;
  const nodeMap = new Map();
  const edgeList = [];
  const neuronFiles = scanNeuronFiles(NEURONS);

  // Pass 1: parse all files, register nodes
  for (const filePath of neuronFiles) {
    try {
      const content = readFileSync(filePath, "utf8");
      const fm = parseFrontmatter(content);
      if (!fm) {
        graphWarnings.push({ file: relative(DATA_DIR, filePath), warn: "no frontmatter found" });
        continue;
      }

      const errors = validateNeuron(fm, filePath);
      if (errors.length > 0) {
        graphWarnings.push({ file: relative(DATA_DIR, filePath), warn: errors.join("; ") });
        // still include if neuron_id is present (soft validation)
        if (!fm.neuron_id) continue;
      }

      if (nodeMap.has(fm.neuron_id)) {
        graphWarnings.push({
          file: relative(DATA_DIR, filePath),
          warn: `duplicate neuron_id "${fm.neuron_id}" — skipped`,
        });
        continue;
      }

      nodeMap.set(fm.neuron_id, {
        id: fm.neuron_id,
        entity_type: fm.entity_type || "component",
        display_name: fm.display_name || fm.neuron_id,
        boundary: fm.boundary || "_unbound",
        domain: "infrastructure",
        source_system: fm.source_system || null,
        confidence: fm.confidence_score ?? 0.5,
        tags: fm.tags || [],
        source_uri: fm.source_uri || null,
        discovery_method: fm.discovery_method || null,
        discovered_at: fm.discovered_at || null,
        phantom: false,
        file: filePath,
      });

      // collect edges
      if (Array.isArray(fm.edges)) {
        for (const edge of fm.edges) {
          if (!edge.target || !edge.type) {
            graphWarnings.push({
              file: relative(DATA_DIR, filePath),
              warn: `edge missing target or type in ${fm.neuron_id}`,
            });
            continue;
          }
          if (!EDGE_TYPES.has(edge.type)) {
            graphWarnings.push({
              file: relative(DATA_DIR, filePath),
              warn: `unknown edge type "${edge.type}" on ${fm.neuron_id}→${edge.target}`,
            });
          }
          edgeList.push({
            source: fm.neuron_id,
            target: edge.target,
            type: edge.type,
            weight: edge.weight ?? 0.5,
            label: edge.label || null,
            bidirectional: edge.bidirectional || false,
          });
        }
      }
    } catch (err) {
      graphWarnings.push({ file: relative(DATA_DIR, filePath), warn: `parse error: ${err.message}` });
    }
  }

  // Pass 2: resolve edges — create phantom nodes for missing targets
  const resolvedEdges = [];
  const seen = new Set();

  for (const edge of edgeList) {
    // create phantom node if target doesn't exist
    if (!nodeMap.has(edge.target)) {
      nodeMap.set(edge.target, {
        id: edge.target,
        entity_type: "component",
        display_name: edge.target,
        boundary: "_unbound",
        domain: "infrastructure",
        source_system: null,
        confidence: 0,
        tags: [],
        source_uri: null,
        discovery_method: null,
        discovered_at: null,
        phantom: true,
        file: null,
      });
    }

    // deduplicate edges (keep highest weight)
    const edgeKey = `${edge.source}→${edge.target}:${edge.type}`;
    if (seen.has(edgeKey)) continue;
    seen.add(edgeKey);

    resolvedEdges.push({
      source: edge.source,
      target: edge.target,
      type: edge.type,
      weight: edge.weight,
      label: edge.label,
    });

    // create reverse edge for bidirectional
    if (edge.bidirectional) {
      const revKey = `${edge.target}→${edge.source}:${edge.type}`;
      if (!seen.has(revKey)) {
        seen.add(revKey);
        resolvedEdges.push({
          source: edge.target,
          target: edge.source,
          type: edge.type,
          weight: edge.weight,
          label: edge.label,
        });
      }
    }
  }

  // Pass 3: compute boundary stats
  const boundaryMap = new Map();
  for (const [, node] of nodeMap) {
    if (node.phantom) continue;
    const b = node.boundary;
    if (!boundaryMap.has(b)) boundaryMap.set(b, { id: b, node_count: 0, internal_edges: 0, external_edges: 0 });
    boundaryMap.get(b).node_count++;
  }

  for (const edge of resolvedEdges) {
    const srcBound = nodeMap.get(edge.source)?.boundary;
    const tgtBound = nodeMap.get(edge.target)?.boundary;
    if (srcBound && tgtBound) {
      if (srcBound === tgtBound) {
        const b = boundaryMap.get(srcBound);
        if (b) b.internal_edges++;
      } else {
        const bs = boundaryMap.get(srcBound);
        const bt = boundaryMap.get(tgtBound);
        if (bs) bs.external_edges++;
        if (bt) bt.external_edges++;
      }
    }
  }

  const phantomCount = [...nodeMap.values()].filter(n => n.phantom).length;

  knowledgeGraph = {
    nodes: [...nodeMap.values()],
    edges: resolvedEdges,
    boundaries: [...boundaryMap.values()],
    meta: {
      total_neurons: nodeMap.size - phantomCount,
      total_edges: resolvedEdges.length,
      phantoms: phantomCount,
      warnings: graphWarnings.length,
      built_at: new Date().toISOString(),
    },
  };

  console.log(
    `⬡  graph: ${knowledgeGraph.meta.total_neurons} neurons, ` +
    `${resolvedEdges.length} edges, ${phantomCount} phantoms, ` +
    `${boundaryMap.size} boundaries` +
    (graphWarnings.length ? ` (${graphWarnings.length} warnings)` : "")
  );

  return knowledgeGraph;
}

// Initial build
buildGraph();

// ─── SSE + file watching ────────────────────────────────────────────────────

const clients = new Set();

function broadcast(event, data) {
  const msg = enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  for (const send of clients) {
    try { send(msg); } catch { clients.delete(send); }
  }
}

// Debounced graph rebuild — coalesces rapid neuron file changes
let graphRebuildTimer = null;
function debouncedGraphRebuild(filename) {
  if (graphRebuildTimer) clearTimeout(graphRebuildTimer);
  graphRebuildTimer = setTimeout(() => {
    graphRebuildTimer = null;
    buildGraph();
    broadcast("graph-update", graphWithHighlights());
    console.log(`↺  neuron: ${filename}`);
  }, 120);
}

// Watch neurons/ recursively for graph changes
watch(NEURONS, { recursive: true }, (_, filename) => {
  if (filename?.endsWith(".md")) debouncedGraphRebuild(filename);
});

async function dispatch(req, url) {
    // SSE stream
    if (url.pathname === "/events") {
      let send;
      const stream = new ReadableStream({
        start(ctrl) {
          send = (data) => ctrl.enqueue(data);
          clients.add(send);
          send(enc.encode("event: connected\ndata: {}\n\n"));
        },
        cancel() { clients.delete(send); }
      });
      return new Response(stream, { headers: {
        "Content-Type":  "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      }});
    }

    // ─── Systems registry ────────────────────────────────────────────
    if (url.pathname === "/systems") {
      try {
        const raw = readFileSync(join(DIR, "schema", "known_systems.json"), "utf8");
        return new Response(raw, { headers: { "Content-Type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ systems: {}, _default: { hue: 285 } }),
          { headers: { "Content-Type": "application/json" } });
      }
    }

    // ─── Engram Graph API ────────────────────────────────────────────
    if (url.pathname === "/graph") {
      return Response.json(graphWithHighlights());
    }

    // Graph warnings for debugging
    if (url.pathname === "/graph/warnings") {
      return Response.json(graphWarnings);
    }

    // Single neuron content — serves the raw .md file for payload rendering
    if (url.pathname === "/neuron") {
      const id = url.searchParams.get("id") ?? "";
      const node = knowledgeGraph.nodes.find(n => n.id === id);
      if (!node || !node.file) {
        return new Response("Not found", { status: 404 });
      }
      try {
        const content = readFileSync(node.file, "utf8");
        return new Response(content, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    }

    // Rebuild graph on demand (useful for debugging)
    if (url.pathname === "/graph/rebuild" && req.method === "POST") {
      buildGraph();
      return Response.json(graphWithHighlights());
    }

    // ─── MCP — Hermes-facing tool endpoints ──────────────────────────
    // Designed to be wrapped 1:1 by a real MCP server. Each one is a single
    // request/response, JSON in/out, no streaming.

    // GET /mcp/list_neurons — summary list of all real neurons
    if (url.pathname === "/mcp/list_neurons") {
      const items = knowledgeGraph.nodes
        .filter(n => !n.phantom)
        .map(n => ({
          neuron_id:    n.id,
          display_name: n.display_name,
          entity_type:  n.entity_type,
          boundary:     n.boundary,
          source_system: n.source_system,
        }));
      return Response.json({ neurons: items, count: items.length });
    }

    // GET /mcp/list_boundaries — boundary stats
    if (url.pathname === "/mcp/list_boundaries") {
      return Response.json({ boundaries: knowledgeGraph.boundaries });
    }

    // GET /mcp/get_neuron?id=... — full record + raw markdown body
    if (url.pathname === "/mcp/get_neuron") {
      const id = url.searchParams.get("id") ?? "";
      const node = knowledgeGraph.nodes.find(n => n.id === id);
      if (!node) return Response.json({ error: "not_found" }, { status: 404 });
      const edges_out = knowledgeGraph.edges.filter(e => e.source === id);
      const edges_in  = knowledgeGraph.edges.filter(e => e.target === id);
      let body = null;
      if (node.file) {
        try {
          const content = readFileSync(node.file, "utf8");
          body = content.replace(/^---[\s\S]*?---\s*/, "");
        } catch { /* phantom or missing */ }
      }
      return Response.json({
        neuron: node,
        body,
        edges_out,
        edges_in,
        highlight: highlights.get(id) || null,
      });
    }

    // POST /mcp/create_neuron — write a new .md file with frontmatter
    // body: { neuron_id, display_name, entity_type, source_system?, boundary?,
    //         source_uri?, discovery_method, confidence_score, edges?, tags?, notes? }
    if (url.pathname === "/mcp/create_neuron" && req.method === "POST") {
      try {
        const data = await req.json();
        const errs = [];
        if (!data.neuron_id || !/^[a-z0-9][a-z0-9-]*$/.test(data.neuron_id))
          errs.push("neuron_id required (kebab-case)");
        if (!data.display_name) errs.push("display_name required");
        if (!data.entity_type)  errs.push("entity_type required");
        if (data.entity_type && !ENTITY_TYPES.has(data.entity_type))
          errs.push(`unknown entity_type: ${data.entity_type}`);
        if (!data.discovery_method) errs.push("discovery_method required");
        if (data.confidence_score == null) errs.push("confidence_score required");
        if (errs.length) return Response.json({ error: "validation_failed", details: errs }, { status: 400 });

        const file = join(NEURONS, `${data.neuron_id}.md`);
        if (existsSync(file)) return Response.json({ error: "exists", neuron_id: data.neuron_id }, { status: 409 });

        const md = renderNeuronMarkdown(data);
        writeFileSync(file, md, "utf8");
        // Force immediate rebuild so the response reflects new state
        buildGraph();
        pulseActivity(data.neuron_id);
        broadcast("graph-update", graphWithHighlights());
        console.log(`＋  neuron: ${data.neuron_id}`);
        return Response.json({ ok: true, neuron_id: data.neuron_id, file: relative(DATA_DIR, file) });
      } catch (e) {
        return Response.json({ error: "bad_request", message: e.message }, { status: 400 });
      }
    }

    // PUT /mcp/upsert_neuron — idempotent create-or-update, keyed on neuron_id.
    // Merge semantics: incoming fields overwrite existing ones; omitted fields
    // preserve existing values; explicit null clears a field. For the markdown
    // body: `notes` in the payload replaces the body; if omitted, the existing
    // body is preserved. Returns { ok, action: "created" | "updated" }.
    if (url.pathname === "/mcp/upsert_neuron" && req.method === "PUT") {
      try {
        const incoming = await req.json();
        if (!incoming.neuron_id || !/^[a-z0-9][a-z0-9-]*$/.test(incoming.neuron_id)) {
          return Response.json(
            { error: "validation_failed", details: ["neuron_id required (kebab-case)"] },
            { status: 400 },
          );
        }
        if (incoming.entity_type && !ENTITY_TYPES.has(incoming.entity_type)) {
          return Response.json(
            { error: "validation_failed", details: [`unknown entity_type: ${incoming.entity_type}`] },
            { status: 400 },
          );
        }

        const file = join(NEURONS, `${incoming.neuron_id}.md`);
        const exists = existsSync(file);

        let merged;
        let existingBody = "";
        if (exists) {
          const content = readFileSync(file, "utf8");
          const fm = parseFrontmatter(content) || {};
          existingBody = content.replace(/^---[\s\S]*?---\s*/, "").trimEnd();
          merged = { ...fm, ...incoming };
        } else {
          // Brand-new neuron — apply the same required-field validation as create.
          const errs = [];
          if (!incoming.display_name)     errs.push("display_name required");
          if (!incoming.entity_type)      errs.push("entity_type required");
          if (!incoming.discovery_method) errs.push("discovery_method required");
          if (incoming.confidence_score == null) errs.push("confidence_score required");
          if (errs.length) return Response.json({ error: "validation_failed", details: errs }, { status: 400 });
          merged = { ...incoming };
        }

        // Body resolution: explicit notes wins; otherwise keep existing.
        if (incoming.notes == null && existingBody) {
          merged.notes = existingBody;
        }

        const md = renderNeuronMarkdown(merged);
        writeFileSync(file, md, "utf8");
        buildGraph();
        pulseActivity(incoming.neuron_id);
        broadcast("graph-update", graphWithHighlights());
        const action = exists ? "updated" : "created";
        console.log(`↻  upsert (${action}): ${incoming.neuron_id}`);
        return Response.json({
          ok: true,
          action,
          neuron_id: incoming.neuron_id,
          file: relative(DATA_DIR, file),
        });
      } catch (e) {
        return Response.json({ error: "bad_request", message: e.message }, { status: 400 });
      }
    }

    // PUT /mcp/edge — add or update a directed edge from source to target.
    // body: { source, target, type, weight?, bidirectional?, label? }
    // Idempotent: keyed on (source, target, type). Re-adding the same triple
    // replaces weight/bidirectional/label. Source neuron must exist; target
    // can be missing (becomes a phantom node until populated).
    if (url.pathname === "/mcp/edge" && req.method === "PUT") {
      try {
        const { source, target, type, weight, bidirectional, label } = await req.json();
        const errs = [];
        if (!source) errs.push("source required");
        if (!target) errs.push("target required");
        if (!type)   errs.push("type required");
        if (type && !EDGE_TYPES.has(type)) errs.push(`unknown edge type: ${type}`);
        if (source && target && source === target) errs.push("source and target must differ");
        if (errs.length) return Response.json({ error: "validation_failed", details: errs }, { status: 400 });

        const sourceFile = join(NEURONS, `${source}.md`);
        if (!existsSync(sourceFile)) {
          return Response.json({ error: "source_not_found", source }, { status: 404 });
        }

        // Read source neuron, parse frontmatter + body, mutate edges array, write back.
        const content = readFileSync(sourceFile, "utf8");
        const fm = parseFrontmatter(content) || {};
        const body = content.replace(/^---[\s\S]*?---\s*/, "").trimEnd();
        if (!Array.isArray(fm.edges)) fm.edges = [];

        const newEdge = { target, type };
        if (weight != null)   newEdge.weight = weight;
        if (bidirectional)    newEdge.bidirectional = true;
        if (label)            newEdge.label = label;

        const idx = fm.edges.findIndex(e => e.target === target && e.type === type);
        let action;
        if (idx >= 0) { fm.edges[idx] = newEdge; action = "updated"; }
        else          { fm.edges.push(newEdge);  action = "created"; }

        if (body) fm.notes = body;

        writeFileSync(sourceFile, renderNeuronMarkdown(fm), "utf8");
        buildGraph();
        pulseActivity(source);
        pulseActivity(target);
        broadcast("graph-update", graphWithHighlights());
        console.log(`→  edge ${action}: ${source} --${type}--> ${target}`);
        return Response.json({ ok: true, action, source, target, type });
      } catch (e) {
        return Response.json({ error: "bad_request", message: e.message }, { status: 400 });
      }
    }

    // POST /mcp/highlight — set or clear a transient highlight overlay
    // body: { neuron_id, state: critical|warning|active|monitoring|clear, reason? }
    if (url.pathname === "/mcp/highlight" && req.method === "POST") {
      try {
        const { neuron_id, state, reason } = await req.json();
        if (!neuron_id) return Response.json({ error: "neuron_id required" }, { status: 400 });
        const node = knowledgeGraph.nodes.find(n => n.id === neuron_id);
        if (!node) return Response.json({ error: "not_found" }, { status: 404 });
        // Manual highlight always wins over auto-activity pulses. Cancel any
        // pending auto-clear timer so it can't wipe a deliberate signal later.
        cancelActivityTimer(neuron_id);
        if (state === "clear" || state == null) {
          highlights.delete(neuron_id);
        } else if (HIGHLIGHT_STATES.has(state)) {
          highlights.set(neuron_id, { state, reason: reason || null, since: new Date().toISOString() });
        } else {
          return Response.json({ error: `unknown state: ${state}` }, { status: 400 });
        }
        broadcast("graph-update", graphWithHighlights());
        return Response.json({ ok: true, neuron_id, highlight: highlights.get(neuron_id) || null });
      } catch (e) {
        return Response.json({ error: "bad_request", message: e.message }, { status: 400 });
      }
    }

    // GET /mcp/list_highlights — current overlay (manual signals only).
    // Auto-activity pulses are excluded so agents don't read their own
    // write trails as if they were deliberate operational signals.
    if (url.pathname === "/mcp/list_highlights") {
      return Response.json({
        highlights: [...highlights.entries()]
          .filter(([, h]) => !h.auto)
          .map(([id, h]) => ({ neuron_id: id, ...h })),
      });
    }

    // ─── Legacy Canvas API ───────────────────────────────────────────

    // File list — local + imported
    // Canvas HTML
    if (url.pathname === "/" || url.pathname === "/canvas.html") {
      try {
        const html = readFileSync(join(DIR, "canvas.html"), "utf8");
        return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      } catch {
        return new Response("canvas.html not found", { status: 500 });
      }
    }

    return new Response("Not found", { status: 404 });
}

Bun.serve({
  port: PORT,
  fetch: async (req) => {
    const url = new URL(req.url);
    const isMcp = url.pathname.startsWith("/mcp/");
    if (!isMcp) return dispatch(req, url);

    // MCP request: dispatch with logging wrapper.
    const start = Date.now();
    let args = null;
    // Capture JSON body on any verb that carries one. Previously only POST
    // was captured, so PUT-based tools (upsert_neuron, add_edge) logged
    // `args: null` and review.md had to reconstruct intent from stdout.
    if (req.method !== "GET" && req.method !== "HEAD") {
      try { args = await req.clone().json(); } catch {}
    }

    const response = await dispatch(req, url);

    let responseBody = null;
    try { responseBody = await response.clone().json(); } catch {}

    appendCallLog({
      ts: new Date().toISOString(),
      agent: req.headers.get("x-engram-agent") || "unknown",
      method: req.method,
      path: url.pathname + url.search,
      args,
      status: response.status,
      response: responseBody,
      duration_ms: Date.now() - start,
    });

    return response;
  },
});

const neuronCount = readdirSync(NEURONS).filter(f => f.endsWith(".md")).length;
console.log(`\n  Engram — agent memory for infrastructure`);
console.log(`  http://localhost:${PORT}`);
console.log(`  data: ${DATA_DIR}  (${neuronCount} neurons)\n`);

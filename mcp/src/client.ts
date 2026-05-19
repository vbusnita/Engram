// HTTP client for the Engram backend (watch.js).
//
// The only file that knows about URLs. Every tool calls one of these methods —
// no tool should ever `fetch()` directly. Keeping the surface here means a
// change in transport, port, or auth happens in exactly one place.

const ENGRAM_URL = process.env.ENGRAM_URL ?? "http://localhost:3001";

// Agent identity, set once by server.ts after MCP initialize handshake.
// Threads into the X-Engram-Agent header on every backend call so the
// per-request log in watch.js attributes work correctly. Defaults to
// "mcp/unknown" if no clientInfo arrives (shouldn't happen in practice).
let agentId = "mcp/unknown";
export function setAgentId(id: string) {
  agentId = id;
}

function authHeaders(): Record<string, string> {
  return { "X-Engram-Agent": agentId };
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${ENGRAM_URL}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new EngramError(res.status, await safeText(res));
  return (await res.json()) as T;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${ENGRAM_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new EngramError(res.status, await safeText(res));
  return (await res.json()) as T;
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${ENGRAM_URL}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new EngramError(res.status, await safeText(res));
  return (await res.json()) as T;
}

async function safeText(res: Response): Promise<string> {
  try { return await res.text(); } catch { return ""; }
}

export class EngramError extends Error {
  constructor(public status: number, public body: string) {
    super(`Engram backend ${status}: ${body || "(no body)"}`);
    this.name = "EngramError";
  }
}

// ─── Response shapes ────────────────────────────────────────────────────────

export type NeuronSummary = {
  neuron_id: string;
  display_name: string;
  entity_type: string;
  boundary: string;
  source_system: string | null;
};

export type Neuron = {
  id: string;
  display_name: string;
  entity_type: string;
  boundary: string;
  domain: "infrastructure";
  source_system: string | null;
  confidence: number;
  tags: string[];
  source_uri: string | null;
  discovery_method: string | null;
  discovered_at: string | null;
  phantom: boolean;
  file: string | null;
  highlight?: HighlightOverlay;
};

export type Edge = {
  source: string;
  target: string;
  type: string;
  weight: number;
  label: string | null;
};

export type Boundary = {
  id: string;
  node_count: number;
  internal_edges: number;
  external_edges: number;
};

export type HighlightState = "critical" | "warning" | "active" | "monitoring";

export type HighlightOverlay = {
  state: HighlightState;
  reason: string | null;
  since: string;
};

export type AddEdgeInput = {
  source: string;
  target: string;
  type:
    | "connected_to"
    | "depends_on"
    | "routes_to"
    | "manages"
    | "monitors"
    | "authenticates"
    | "contains";
  weight?: number;
  bidirectional?: boolean;
  label?: string;
};

export type CreateNeuronInput = {
  neuron_id: string;
  display_name: string;
  entity_type: "component" | "resource" | "network" | "security" | "device";
  source_system?: string;
  boundary?: string;
  source_uri?: string;
  discovery_method: "api_scan" | "config_read" | "manual" | "inference";
  discovered_at?: string;
  confidence_score: number;
  tags?: string[];
  notes?: string;
  edges?: Array<{
    target: string;
    type: string;
    weight?: number;
    bidirectional?: boolean;
    label?: string;
  }>;
};

// ─── Method surface ─────────────────────────────────────────────────────────

export const engramClient = {
  listNeurons: () =>
    get<{ neurons: NeuronSummary[]; count: number }>("/mcp/list_neurons"),

  getNeuron: (id: string) =>
    get<{
      neuron: Neuron;
      body: string | null;
      edges_out: Edge[];
      edges_in: Edge[];
      highlight: HighlightOverlay | null;
    }>(`/mcp/get_neuron?id=${encodeURIComponent(id)}`),

  listBoundaries: () =>
    get<{ boundaries: Boundary[] }>("/mcp/list_boundaries"),

  listHighlights: () =>
    get<{ highlights: Array<{ neuron_id: string } & HighlightOverlay> }>(
      "/mcp/list_highlights",
    ),

  createNeuron: (input: CreateNeuronInput) =>
    post<{ ok: true; neuron_id: string; file: string } | { error: string; details?: string[] }>(
      "/mcp/create_neuron",
      input,
    ),

  upsertNeuron: (input: Partial<CreateNeuronInput> & { neuron_id: string }) =>
    put<
      | { ok: true; action: "created" | "updated"; neuron_id: string; file: string }
      | { error: string; details?: string[] }
    >("/mcp/upsert_neuron", input),

  addEdge: (input: AddEdgeInput) =>
    put<
      | { ok: true; action: "created" | "updated"; source: string; target: string; type: string }
      | { error: string; details?: string[] }
    >("/mcp/edge", input),

  highlight: (input: {
    neuron_id: string;
    state: HighlightState | "clear";
    reason?: string;
  }) =>
    post<{ ok: true; neuron_id: string; highlight: HighlightOverlay | null }>(
      "/mcp/highlight",
      input,
    ),
};

export const engramUrl = ENGRAM_URL;

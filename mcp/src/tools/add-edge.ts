import type { Tool, ToolHandler } from "../types.js";
import { engramClient, type AddEdgeInput } from "../client.js";

export const addEdgeTool: Tool = {
  name: "add_edge",
  description:
    "Add or update a directed edge between two neurons that already exist (or " +
    "create a phantom target). Use this to record relationships discovered " +
    "AFTER both neurons have been created — that's most discovery work: you " +
    "first scout the hosts, then figure out which depends on which, what " +
    "monitors what, what contains what. Idempotent on (source, target, type) " +
    "— re-adding the same triple replaces weight/label/bidirectional. " +
    "Returns { ok, action: 'created' | 'updated' }. " +
    "Edge types: connected_to (network adjacency), depends_on (A breaks if B " +
    "does), routes_to (traffic flow), manages (A controls B's lifecycle), " +
    "monitors (A reads B's state), authenticates (A handles auth for B), " +
    "contains (A is the parent of B).",
  inputSchema: {
    type: "object",
    properties: {
      source: {
        type: "string",
        description: "neuron_id of the source (the file holding this edge).",
      },
      target: {
        type: "string",
        description:
          "neuron_id of the target. Need not exist yet — becomes a phantom " +
          "node until populated.",
      },
      type: {
        type: "string",
        enum: [
          "connected_to",
          "depends_on",
          "routes_to",
          "manages",
          "monitors",
          "authenticates",
          "contains",
        ],
      },
      weight: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description:
          "Relationship strength — how much does A need B? 0.95 = critical " +
          "(A breaks immediately without B), 0.7 = strong (A is degraded), " +
          "0.5 = moderate (A uses B but has fallbacks), 0.3 = weak (failure " +
          "of B has limited impact on A). NOT a confidence score — if you " +
          "can't justify the edge, don't declare it. Default 0.6.",
      },
      bidirectional: {
        type: "boolean",
        description:
          "Set true when both ends fairly describe the relationship (e.g., " +
          "two routers connected_to each other). Default false.",
      },
      label: {
        type: "string",
        description: "Short free-text qualifier shown on hover.",
      },
    },
    required: ["source", "target", "type"],
    additionalProperties: false,
  },
};

export const addEdgeHandler: ToolHandler = async (args) => {
  const result = await engramClient.addEdge(args as unknown as AddEdgeInput);
  if ("error" in result) {
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      isError: true,
    };
  }
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
};

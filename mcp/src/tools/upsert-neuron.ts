import type { Tool, ToolHandler } from "../types.js";
import { engramClient, type CreateNeuronInput } from "../client.js";

export const upsertNeuronTool: Tool = {
  name: "upsert_neuron",
  description:
    "Idempotent create-or-update for a neuron, keyed on neuron_id. " +
    "Use this as the default writer when scouting: you don't have to check " +
    "whether the neuron exists first. Merge semantics — fields in the payload " +
    "overwrite existing ones, omitted fields preserve existing values, explicit " +
    "null clears a field. For new neurons, the same required fields as create_neuron " +
    "apply (display_name, entity_type, discovery_method, confidence_score). For " +
    "existing neurons, only neuron_id is required; everything else is optional. " +
    "If `notes` is provided it replaces the markdown body; if omitted, the existing " +
    "body is preserved. Returns { ok, action: 'created' | 'updated' }.",
  inputSchema: {
    type: "object",
    properties: {
      neuron_id: {
        type: "string",
        pattern: "^[a-z0-9][a-z0-9-]*$",
        description: "Kebab-case unique id, e.g. 'home-gateway'.",
      },
      display_name: { type: "string" },
      entity_type: {
        type: "string",
        enum: ["component", "resource", "network", "security", "device"],
      },
      source_system: { type: "string" },
      boundary: { type: "string" },
      source_uri: { type: "string" },
      discovery_method: {
        type: "string",
        enum: ["api_scan", "config_read", "manual", "inference"],
      },
      discovered_at: { type: "string" },
      confidence_score: { type: "number", minimum: 0, maximum: 1 },
      tags: { type: "array", items: { type: "string" } },
      notes: { type: "string" },
      edges: {
        type: "array",
        items: {
          type: "object",
          properties: {
            target: { type: "string" },
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
            weight: { type: "number", minimum: 0, maximum: 1 },
            bidirectional: { type: "boolean" },
            label: { type: "string" },
          },
          required: ["target", "type"],
        },
      },
    },
    required: ["neuron_id"],
    additionalProperties: false,
  },
};

export const upsertNeuronHandler: ToolHandler = async (args) => {
  const result = await engramClient.upsertNeuron(args as unknown as CreateNeuronInput);
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

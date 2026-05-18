import type { Tool, ToolHandler } from "../types.js";
import { engramClient, type CreateNeuronInput } from "../client.js";

export const createNeuronTool: Tool = {
  name: "create_neuron",
  description:
    "Create a new neuron in Engram. Use this after scouting/discovering a " +
    "piece of infrastructure that isn't documented yet. The neuron_id must be " +
    "globally unique kebab-case. entity_type is one of: component, resource, " +
    "network, security, device. discovery_method describes how it was found " +
    "(api_scan, config_read, manual, inference). Optional notes get appended " +
    "to the markdown body as the operation log.",
  inputSchema: {
    type: "object",
    properties: {
      neuron_id: {
        type: "string",
        pattern: "^[a-z0-9][a-z0-9-]*$",
        description: "Kebab-case unique id, e.g. 'home-gateway'.",
      },
      display_name: {
        type: "string",
        description: "Human-readable label.",
      },
      entity_type: {
        type: "string",
        enum: ["component", "resource", "network", "security", "device"],
      },
      source_system: {
        type: "string",
        description: "e.g. proxmox, unifi, truenas, macos, pfsense.",
      },
      boundary: {
        type: "string",
        description: "Logical group (kebab-case), e.g. 'home-lab', 'dmz'.",
      },
      source_uri: {
        type: "string",
        description: "Management URL or source-of-truth URI.",
      },
      discovery_method: {
        type: "string",
        enum: ["api_scan", "config_read", "manual", "inference"],
      },
      discovered_at: {
        type: "string",
        description: "ISO-8601 timestamp. Defaults to now if omitted.",
      },
      confidence_score: {
        type: "number",
        minimum: 0,
        maximum: 1,
      },
      tags: {
        type: "array",
        items: { type: "string" },
      },
      notes: {
        type: "string",
        description: "Free-form markdown body — operation history, context.",
      },
      edges: {
        type: "array",
        description:
          "Edges from this neuron to others. Targets may not exist yet — " +
          "they become phantom nodes until populated.",
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
    required: ["neuron_id", "display_name", "entity_type", "discovery_method", "confidence_score"],
    additionalProperties: false,
  },
};

export const createNeuronHandler: ToolHandler = async (args) => {
  const result = await engramClient.createNeuron(args as unknown as CreateNeuronInput);
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

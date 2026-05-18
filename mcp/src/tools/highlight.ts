import type { Tool, ToolHandler } from "../types.js";
import { engramClient, type HighlightState } from "../client.js";

export const highlightTool: Tool = {
  name: "highlight",
  description:
    "Set or clear a transient highlight on a neuron. Highlights pulse the " +
    "neuron on the live canvas — use them to surface operational signals " +
    "while investigating: critical = active incident, warning = needs " +
    "attention, active = work in progress, monitoring = under observation, " +
    "clear = remove. Highlights are runtime-only and do NOT modify the " +
    "neuron's file.",
  inputSchema: {
    type: "object",
    properties: {
      neuron_id: { type: "string" },
      state: {
        type: "string",
        enum: ["critical", "warning", "active", "monitoring", "clear"],
      },
      reason: {
        type: "string",
        description: "Optional human-readable note explaining the highlight.",
      },
    },
    required: ["neuron_id", "state"],
    additionalProperties: false,
  },
};

export const highlightHandler: ToolHandler = async (args) => {
  const result = await engramClient.highlight({
    neuron_id: String(args.neuron_id ?? ""),
    state: args.state as HighlightState | "clear",
    reason: args.reason as string | undefined,
  });
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
};

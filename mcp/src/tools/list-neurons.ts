import type { Tool, ToolHandler } from "../types.js";
import { engramClient } from "../client.js";

export const listNeuronsTool: Tool = {
  name: "list_neurons",
  description:
    "List every real neuron in Engram with its id, display name, entity type, " +
    "boundary, and source system. Use this to get an overview of what " +
    "infrastructure is already documented before deciding what to scout or update.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
};

export const listNeuronsHandler: ToolHandler = async () => {
  const result = await engramClient.listNeurons();
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
};

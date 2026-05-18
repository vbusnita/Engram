import type { Tool, ToolHandler } from "../types.js";
import { engramClient } from "../client.js";

export const getNeuronTool: Tool = {
  name: "get_neuron",
  description:
    "Fetch full details for a single neuron: frontmatter fields, the markdown " +
    "body (operation history, notes), outgoing and incoming edges, and any " +
    "active highlight overlay. Pass the neuron's id (kebab-case slug).",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "The neuron_id (kebab-case), e.g. 'home-gateway'.",
      },
    },
    required: ["id"],
    additionalProperties: false,
  },
};

export const getNeuronHandler: ToolHandler = async (args) => {
  const id = String(args.id ?? "");
  if (!id) {
    return {
      content: [{ type: "text", text: "id is required" }],
      isError: true,
    };
  }
  const result = await engramClient.getNeuron(id);
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
};

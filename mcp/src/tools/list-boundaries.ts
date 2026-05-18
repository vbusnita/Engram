import type { Tool, ToolHandler } from "../types.js";
import { engramClient } from "../client.js";

export const listBoundariesTool: Tool = {
  name: "list_boundaries",
  description:
    "List all boundaries (logical groupings) in Engram with their node counts " +
    "and edge stats. Use this to understand how the documented infrastructure " +
    "is partitioned (e.g. home-lab, dmz, core-network) before adding new neurons.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
};

export const listBoundariesHandler: ToolHandler = async () => {
  const result = await engramClient.listBoundaries();
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
};

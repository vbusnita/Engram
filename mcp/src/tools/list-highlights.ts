import type { Tool, ToolHandler } from "../types.js";
import { engramClient } from "../client.js";

export const listHighlightsTool: Tool = {
  name: "list_highlights",
  description:
    "List all neurons currently flagged with a highlight overlay (critical, " +
    "warning, active, monitoring). Highlights are transient and indicate " +
    "ongoing operational signals — read this to know what an agent or operator " +
    "is currently focused on.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
};

export const listHighlightsHandler: ToolHandler = async () => {
  const result = await engramClient.listHighlights();
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
};

import type { Tool, ToolHandler } from "../types.js";
import { engramClient } from "../client.js";

export const appendNotesTool: Tool = {
  name: "append_notes",
  description:
    "Append a timestamped block of text to the markdown body of an existing " +
    "neuron. This is how scouts leave context for future scouts: what you " +
    "probed, what you found, why you declared (or refused to declare) an " +
    "edge, what was ruled out and why. Future agents reading the neuron " +
    "via get_neuron see your block dated and bylined with your agent " +
    "identity. NOT idempotent — each call appends a new block. Returns 404 " +
    "if the neuron doesn't exist (call create_neuron or upsert_neuron " +
    "first; append_notes does NOT auto-create). Per-call text should stay " +
    "under 4 KB for readability; hard limit is 64 KB (413 above that).",
  inputSchema: {
    type: "object",
    properties: {
      neuron_id: {
        type: "string",
        description: "neuron_id of the existing neuron to append to.",
      },
      text: {
        type: "string",
        description:
          "Markdown content to append. Will be wrapped in a timestamped " +
          "### header. Keep under 4 KB per call; hard limit 64 KB.",
      },
      author: {
        type: "string",
        description:
          "Optional override for the byline. Defaults to the X-Engram-Agent " +
          "header set from MCP clientInfo. Leave unset in normal use.",
      },
    },
    required: ["neuron_id", "text"],
    additionalProperties: false,
  },
};

export const appendNotesHandler: ToolHandler = async (args) => {
  const result = await engramClient.appendNotes({
    neuron_id: String(args.neuron_id ?? ""),
    text: String(args.text ?? ""),
    author: args.author as string | undefined,
  });
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
};

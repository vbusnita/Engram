// Tool registry. Adding a tool: add the import and the entry. That's it.
// Order here is the order an MCP client sees in tools/list.

import type { ToolEntry } from "../types.js";

import { listNeuronsTool,    listNeuronsHandler }    from "./list-neurons.js";
import { getNeuronTool,      getNeuronHandler }      from "./get-neuron.js";
import { listBoundariesTool, listBoundariesHandler } from "./list-boundaries.js";
import { listHighlightsTool, listHighlightsHandler } from "./list-highlights.js";
import { createNeuronTool,   createNeuronHandler }   from "./create-neuron.js";
import { upsertNeuronTool,   upsertNeuronHandler }   from "./upsert-neuron.js";
import { highlightTool,      highlightHandler }      from "./highlight.js";

export const tools: ToolEntry[] = [
  { def: listNeuronsTool,    handler: listNeuronsHandler },
  { def: getNeuronTool,      handler: getNeuronHandler },
  { def: listBoundariesTool, handler: listBoundariesHandler },
  { def: listHighlightsTool, handler: listHighlightsHandler },
  { def: createNeuronTool,   handler: createNeuronHandler },
  { def: upsertNeuronTool,   handler: upsertNeuronHandler },
  { def: highlightTool,      handler: highlightHandler },
];

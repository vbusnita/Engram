// Shared types for the Engram MCP server.
//
// Tool: the public-facing definition an MCP client sees in tools/list.
// ToolHandler: the function the server calls when an agent invokes the tool.
// Tools must export both. The registry in tools/index.ts pairs them by name.

export type JsonSchema = {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type Tool = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
};

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

export type ToolEntry = {
  def: Tool;
  handler: ToolHandler;
};

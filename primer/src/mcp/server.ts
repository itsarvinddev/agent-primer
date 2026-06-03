// The primer MCP server (stdio). stdout is owned by the transport (JSON-RPC only);
// everything human goes to stderr. The launcher already suppressed Node's
// experimental warning, so the very first stdout line is guaranteed to be JSON-RPC.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { SERVER_INSTRUCTIONS } from './instructions.js';
import { TOOLS, dispatch } from './tools.js';
import { VERSION } from '../version.js';

export async function serveMcp(): Promise<void> {
  const server = new Server(
    { name: 'primer', version: VERSION },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    return dispatch(req.params.name, (req.params.arguments ?? {}) as Record<string, unknown>);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('primer MCP server ready (stdio)\n');
}

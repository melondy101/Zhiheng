import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { exportSessionToObsidian } from '../src/lib/obsidian-export';
import type { Session } from '../src/lib/providers';

const server = new McpServer({ name: 'zhiyan-obsidian', version: '0.1.0' });
server.registerTool('export_report_to_obsidian', {
  description: 'Export a completed Zhiyan session as an editable Markdown note in the configured Obsidian Vault.',
  inputSchema: {
    session: z.record(z.string(), z.unknown()).describe('Completed Zhiyan session JSON'),
    relativePath: z.string().optional().describe('Optional Vault-relative .md path'),
  },
}, async ({ session, relativePath }) => {
  try {
    const result = await exportSessionToObsidian(session as unknown as Session, relativePath);
    return { content: [{ type: 'text', text: JSON.stringify({ ok: true, ...result }) }] };
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : 'Export failed' }] };
  }
});

await server.connect(new StdioServerTransport());

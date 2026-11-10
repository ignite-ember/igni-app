/** Seed for the composer — instead of building a form, let the agent
 *  collect the details and edit `.mcp.json` itself. Frames the task
 *  up front so the agent knows where each location lives and which
 *  JSON shape to write. */
export const ADD_SERVER_PROMPT = `Help me set up a new MCP server.

Ask me which one I want to add (name, transport, command/args/env or URL) and which scope to save it under:
- **Project · shared** → \`./.mcp.json\` (committed, shared with the team)
- **Project · local** → \`./.igni/.mcp.json\` (gitignored, just this checkout)
- **User · global** → \`~/.igni/.mcp.json\` (this machine, all projects)

Then merge the entry into the chosen \`.mcp.json\` under the \`mcpServers\` key, creating the file if it doesn't exist. Use this shape:

\`\`\`json
{
  "mcpServers": {
    "<name>": { "type": "stdio", "command": "...", "args": [...], "env": {...} }
  }
}
\`\`\`

For SSE/HTTP servers, use \`"type": "sse"\` with a \`"url"\` field instead.

`;

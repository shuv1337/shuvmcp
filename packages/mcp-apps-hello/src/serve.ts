/**
 * Run the hello MCP Apps server over stdio.
 *
 *   npm run serve
 *
 * Add it to an MCP Apps-capable host (Claude, ChatGPT, Goose, VS Code) as a stdio
 * server, then ask the model to "greet Ada" to render the interactive card.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./app.js";

const server = buildServer();
await server.connect(new StdioServerTransport());
// stderr — stdout carries the JSON-RPC stream.
console.error("mcp-apps-hello: stdio server up (greet, record_reaction, ui://hello/view.html)");

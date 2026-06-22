/**
 * A minimal MCP Apps server — the native TypeScript analog of a FastMCP Prefab app.
 *
 * FastMCP mapping:
 *   @app.ui   (entry-point tool the model calls)  -> `greet` + registerAppTool
 *   @app.tool (backend tool the UI calls)         -> `record_reaction`
 *   prefab-ui renderer + Prefab component tree    -> the ui:// HTML resource (widget.html)
 *
 * The whole MCP Apps "substrate" is just: advertise the io.modelcontextprotocol/ui
 * extension, serve a ui:// HTML resource, and stamp `_meta.ui.resourceUri` on the tool.
 * The ext-apps server helpers do the metadata normalization.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  EXTENSION_ID,
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { WIDGET_HTML } from "./widget.js";

export const VIEW_URI = "ui://hello/view.html";

export function buildServer(): McpServer {
  // Per-server reaction tally so each instance is isolated.
  const reactions = new Map<string, number>();

  const server = new McpServer(
    { name: "mcp-apps-hello", version: "0.1.0" },
    { capabilities: { extensions: { [EXTENSION_ID]: {} } } },
  );

  // The HTML view (the "renderer"). CSP whitelists esm.sh so the widget can load
  // the official @modelcontextprotocol/ext-apps App client at runtime.
  registerAppResource(
    server,
    "Hello view",
    VIEW_URI,
    {
      _meta: {
        ui: {
          csp: {
            resourceDomains: ["https://esm.sh"],
            connectDomains: ["https://esm.sh"],
          },
        },
      },
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: RESOURCE_MIME_TYPE, text: WIDGET_HTML }],
    }),
  );

  // Entry-point tool the model calls; the result opens the view (@app.ui analog).
  registerAppTool(
    server,
    "greet",
    {
      description: "Greet someone with an interactive card.",
      inputSchema: { name: z.string().describe("Who to greet") },
      outputSchema: {
        name: z.string(),
        greeting: z.string(),
        reactions: z.record(z.number()),
      },
      _meta: { ui: { resourceUri: VIEW_URI } },
    },
    async ({ name }) => {
      const greeting = `Hello, ${name}! 👋`;
      const structuredContent = {
        name,
        greeting,
        reactions: Object.fromEntries(reactions),
      };
      return { content: [{ type: "text", text: greeting }], structuredContent };
    },
  );

  // Backend tool the UI calls via app.callServerTool (@app.tool analog).
  // Marked app-only so the model doesn't invoke it directly.
  server.registerTool(
    "record_reaction",
    {
      description: "Record a reaction clicked in the greeting card (called by the UI).",
      inputSchema: { reaction: z.string() },
      outputSchema: {
        reaction: z.string(),
        count: z.number(),
        reactions: z.record(z.number()),
      },
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ reaction }) => {
      const count = (reactions.get(reaction) ?? 0) + 1;
      reactions.set(reaction, count);
      const structuredContent = {
        reaction,
        count,
        reactions: Object.fromEntries(reactions),
      };
      return {
        content: [{ type: "text", text: `Recorded ${reaction} (total ${count}).` }],
        structuredContent,
      };
    },
  );

  return server;
}

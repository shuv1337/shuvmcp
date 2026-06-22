import { test } from "node:test";
import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { EXTENSION_ID, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";

import { buildServer, VIEW_URI } from "../src/app.js";

async function connectClient(): Promise<Client> {
  const server = buildServer();
  const client = new Client({ name: "c", version: "0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

test("advertises the io.modelcontextprotocol/ui extension", async () => {
  const client = await connectClient();
  const caps = client.getServerCapabilities() as { extensions?: Record<string, unknown> };
  assert.ok(caps.extensions && EXTENSION_ID in caps.extensions, "extension must be advertised");
});

test("serves the ui:// view resource with the MCP Apps mime type", async () => {
  const client = await connectClient();
  const { resources } = await client.listResources();
  const view = resources.find((r) => r.uri === VIEW_URI);
  assert.ok(view, "view resource is listed");
  assert.equal(view.mimeType, RESOURCE_MIME_TYPE);

  const read = await client.readResource({ uri: VIEW_URI });
  const item = read.contents[0];
  assert.ok(item && "text" in item && item.text.includes("<!doctype html"));
  assert.match(String(item.text), /callServerTool/); // the widget wires the backend call
});

test("greet links to the view and returns structured content", async () => {
  const client = await connectClient();
  const { tools } = await client.listTools();
  const greet = tools.find((t) => t.name === "greet");
  assert.ok(greet, "greet tool exists");
  const ui = greet._meta?.ui as { resourceUri?: string } | undefined;
  assert.equal(ui?.resourceUri, VIEW_URI);

  const res = await client.callTool({ name: "greet", arguments: { name: "Ada" } });
  const out = res.structuredContent as { greeting?: string; name?: string } | undefined;
  assert.equal(out?.name, "Ada");
  assert.equal(out?.greeting, "Hello, Ada! 👋");
});

test("record_reaction is app-only and tallies per server", async () => {
  const client = await connectClient();
  const { tools } = await client.listTools();
  const rr = tools.find((t) => t.name === "record_reaction");
  assert.ok(rr, "record_reaction tool exists");
  const ui = rr._meta?.ui as { visibility?: string[] } | undefined;
  assert.deepEqual(ui?.visibility, ["app"]);

  const first = await client.callTool({ name: "record_reaction", arguments: { reaction: "👍" } });
  assert.equal((first.structuredContent as { count?: number }).count, 1);
  const second = await client.callTool({ name: "record_reaction", arguments: { reaction: "👍" } });
  assert.equal((second.structuredContent as { count?: number }).count, 2);
});

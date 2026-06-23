# mcp-apps-hello

A minimal, working **MCP Apps** (`io.modelcontextprotocol/ui`) interactive-UI server — the
native TypeScript analog of a **FastMCP Prefab app**. It exists to make the
Prefab-replacement ergonomics concrete: the model calls a tool, the host renders an
interactive HTML card, and a button in the card calls a backend tool through the host.

Built on the stock [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
plus the official [`@modelcontextprotocol/ext-apps`](https://www.npmjs.com/package/@modelcontextprotocol/ext-apps)
server helpers and view client.

## How it maps to FastMCP Prefab

| FastMCP (Python) | Here (TypeScript) |
| --- | --- |
| `@app.ui` entry-point tool the model calls | `greet` via `registerAppTool` (`_meta.ui.resourceUri`) |
| `@app.tool` backend tool the UI calls | `record_reaction` (marked `_meta.ui.visibility: ["app"]`) |
| `prefab-ui` Python component tree | hand-authored HTML/JS in `src/widget.html` |
| Prefab JS renderer served at `ui://` | the same `ui://hello/view.html` resource — **but you write the HTML** |
| `meta.ui` / CSP / capability negotiation | identical wire shape; `ext-apps` normalizes the `_meta` |
| host renders in a sandboxed iframe | same — Claude, ChatGPT, Goose, VS Code render `ui://` |

The point: the **protocol substrate is tiny and ports cleanly** (advertise the extension,
serve a `ui://` HTML resource, stamp `_meta.ui.resourceUri`). What you *don't* get for free
is Prefab's component library — you author the view as HTML/JS (or, in a real app, with
MCP-UI Remote DOM / `apps-sdk-ui` / your own components).

## Run & verify

```bash
npm install
npm run typecheck   # tsc against the real SDK + ext-apps types
npm test            # in-memory client asserts the MCP Apps wire contract
npm run build
npm run serve       # stdio server for an MCP Apps host
```

`npm test` proves, over an in-memory client↔server connection, that the server:

- advertises `io.modelcontextprotocol/ui` in its capabilities,
- serves `ui://hello/view.html` with mime `text/html;profile=mcp-app`,
- exposes `greet` linked to the view via `_meta.ui.resourceUri`, returning structured content,
- exposes `record_reaction` as an app-only backend tool that tallies reactions.

## See the widget

Open `src/widget.html` directly in a browser. It detects it isn't inside a host and renders
in **preview mode** — the styled greeting card with working reaction buttons (tallied
locally). Inside a real MCP Apps host it instead loads the official `App` client, receives
the `greet` result via `ui/notifications/tool-result`, and routes button clicks to
`record_reaction` through `app.callServerTool(...)`.

To try it for real, register the stdio server with an MCP Apps-capable host and ask the
model to "greet Ada".

## What's verifiable here vs not

- **Server side (tested):** capability negotiation, the `ui://` resource, tool `_meta`, and
  tool results are asserted end-to-end. This is the part a FastMCP port actually owns.
- **View↔host bridge (not headless-testable):** the iframe rendering and postMessage
  handshake require a real host. The widget targets the documented `@modelcontextprotocol/ext-apps`
  `App` API (`connect`, `ontoolinput`, `ontoolresult`, `callServerTool`) and reads result
  payloads defensively; adjust per host if needed.

## Notes

- The widget loads the `App` client from `https://esm.sh/@modelcontextprotocol/ext-apps@…/app-with-deps`
  at runtime, so the resource declares `_meta.ui.csp.resourceDomains`/`connectDomains` for
  `esm.sh`. A production app would bundle the client and host it under its own CSP instead.
- Streaming (`ontoolinputpartial`) — the basis of FastMCP's *Generative* apps — is exposed by
  the same `App` client and would let a widget render progressively as the model writes
  arguments.

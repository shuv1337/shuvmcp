# skills-as-resources

A TypeScript **reference implementation** of the
[Skills-as-Resources MCP wire spec](../../spec/skills-as-resources.md), built on the
official [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk).

It exposes filesystem *agent skills* (`SKILL.md` directories) over MCP as plain
**resources** and **resource templates** — no protocol extension, no special host
support — and provides a client for discovering and downloading them. A server built
with this package interoperates on the wire with FastMCP's Python skills client, and
vice-versa.

## Why this exists

Porting FastMCP's Skills provider to another language is the one feature that crosses the
language boundary cleanly: it's standard MCP resources plus a small amount of filesystem
logic. The durable asset is the **wire contract**, not the code — so this package is a
faithful, dependency-light implementation of that contract, with two deliberate,
backward-compatible improvements over the FastMCP reference (see the spec's §11):

1. **Discovery by the `_manifest` URI**, not a hardcoded `/SKILL.md` suffix — so skills
   with a custom main file are discoverable (the `interop.test.ts` "non-default main file"
   case demonstrates the fix).
2. **`mainFile`** is recorded in the manifest (defaulting to `SKILL.md` when absent).

## Install & verify

```bash
npm install
npm run typecheck   # tsc against the real SDK types
npm test            # pure-core conformance + in-memory client<->server round trip
npm run build       # emit dist/
```

## Server

```ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SkillsProvider, registerSkills } from "skills-as-resources";

const provider = new SkillsProvider({
  roots: [`${process.env.HOME}/.claude/skills`], // or `skillDir` for a single skill
  supportingFiles: "template",                   // or "resources" (the interoperable baseline)
  reload: true,
});
await provider.load();

const server = new Server(
  { name: "skills", version: "0.1.0" },
  { capabilities: { resources: {} } },
);
registerSkills(server, provider);
await server.connect(new StdioServerTransport());
```

Or run the bundled example directly:

```bash
npm run serve -- ~/.claude/skills
```

## Client

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { listSkills, getSkillManifest, downloadSkill, syncSkills } from "skills-as-resources";

const client = new Client({ name: "app", version: "0.1.0" });
// ...connect a transport...

const skills = await listSkills(client);                       // discovers via _manifest
const manifest = await getSkillManifest(client, skills[0].name);
await downloadSkill(client, skills[0].name, "~/.local/skills", { verify: true });
await syncSkills(client, "~/.local/skills");                   // download all
```

## Conformance notes

- **`resources` mode is the interoperable baseline** (spec §5.1) and needs no URI-template
  support. **`template` mode** advertises `skill://{name}/{path*}`; this implementation
  resolves reads by parsing the URI itself, so it does not depend on the SDK's URI-template
  engine supporting greedy `{path*}` capture.
- **Integrity (spec §6):** `downloadSkill({ verify: true })` checks each file's SHA-256
  against the manifest. Files transferred as text can be mutated by encoding/newline
  translation; for binary or integrity-critical files the server returns base64 blobs.
- **Not implemented:** server-side pagination of `resources/list` (all resources are
  returned in one page) and the optional `_meta` discovery hint is emitted as
  `_meta.skills.{role,skill}` (the client also reads it but never requires it).

## Layout

| Path | Purpose |
| --- | --- |
| `src/core.ts` | Pure, SDK-free logic (URI parse, manifest, hashing, frontmatter, guards) |
| `src/server.ts` | `SkillsProvider` + `registerSkills(server, …)` |
| `src/client.ts` | `listSkills` / `getSkillManifest` / `downloadSkill` / `syncSkills` |
| `src/examples/serve.ts` | Runnable stdio server |
| `test/core.test.ts` | Pure conformance tests (no SDK) |
| `test/interop.test.ts` | In-memory client↔server round trip, incl. the custom-main-file fix |

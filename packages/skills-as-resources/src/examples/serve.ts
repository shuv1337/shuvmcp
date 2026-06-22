/**
 * Runnable example: serve agent skills from a directory over stdio.
 *
 *   npm run serve                      # serves ~/.claude/skills
 *   npm run serve -- /path/to/skills   # serves a custom root
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as os from "node:os";
import * as path from "node:path";

import { SkillsProvider, registerSkills } from "../index.js";

const root = process.argv[2] ?? path.join(os.homedir(), ".claude", "skills");

const provider = new SkillsProvider({ roots: [root], reload: true });
await provider.load();

const server = new Server(
  { name: "skills-as-resources", version: "0.1.0" },
  { capabilities: { resources: {} } },
);
registerSkills(server, provider);

await server.connect(new StdioServerTransport());
// Log to stderr so it doesn't corrupt the stdio JSON-RPC stream on stdout.
console.error(`skills-as-resources: serving skills from ${root}`);

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { SkillsProvider, registerSkills } from "../src/server.js";
import { listSkills, getSkillManifest, downloadSkill } from "../src/client.js";

async function buildSkillRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "skills-root-"));
  const skillDir = path.join(root, "pdf-processing");
  await mkdir(path.join(skillDir, "scripts"), { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    "---\ndescription: PDF helper\n---\n# PDF\nbody\n",
  );
  await writeFile(path.join(skillDir, "reference.md"), "ref content\n");
  await writeFile(path.join(skillDir, "scripts", "extract.py"), "print('x')\n");
  return root;
}

async function connect(provider: SkillsProvider): Promise<Client> {
  const server = new Server(
    { name: "t", version: "0" },
    { capabilities: { resources: {} } },
  );
  registerSkills(server, provider);
  const client = new Client({ name: "c", version: "0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

test("end-to-end: discover, manifest, download with hash verification", async () => {
  const root = await buildSkillRoot();
  const provider = new SkillsProvider({ roots: [root], supportingFiles: "template" });
  await provider.load();
  const client = await connect(provider);

  const skills = await listSkills(client);
  assert.equal(skills.length, 1);
  assert.equal(skills[0]?.name, "pdf-processing");
  assert.equal(skills[0]?.description, "PDF helper");
  assert.equal(skills[0]?.manifestUri, "skill://pdf-processing/_manifest");

  const manifest = await getSkillManifest(client, "pdf-processing");
  assert.equal(manifest.mainFile, "SKILL.md");
  assert.deepEqual(
    manifest.files.map((f) => f.path).sort(),
    ["SKILL.md", "reference.md", "scripts/extract.py"].sort(),
  );

  const target = await mkdtemp(path.join(tmpdir(), "skills-dl-"));
  const dest = await downloadSkill(client, "pdf-processing", target, { verify: true });
  assert.equal(
    await readFile(path.join(dest, "scripts", "extract.py"), "utf-8"),
    "print('x')\n",
  );
  assert.equal(await readFile(path.join(dest, "reference.md"), "utf-8"), "ref content\n");
});

test("discovery works with a non-default main file (the SKILL.md-suffix bug fix)", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skills-root-"));
  const skillDir = path.join(root, "custom");
  await mkdir(skillDir, { recursive: true });
  await writeFile(path.join(skillDir, "AGENT.md"), "# Custom\nhello\n");

  const provider = new SkillsProvider({ roots: [root], mainFileName: "AGENT.md" });
  await provider.load();
  const client = await connect(provider);

  // A client keying on `/SKILL.md` would see nothing here; manifest discovery finds it.
  const skills = await listSkills(client);
  assert.equal(skills.length, 1);
  assert.equal(skills[0]?.name, "custom");

  const manifest = await getSkillManifest(client, "custom");
  assert.equal(manifest.mainFile, "AGENT.md");
});

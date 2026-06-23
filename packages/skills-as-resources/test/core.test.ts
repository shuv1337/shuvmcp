import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import {
  parseSkillUri,
  skillUri,
  hashBytes,
  parseFrontmatter,
  deriveDescription,
  buildManifest,
  manifestJson,
  safeJoin,
  scanSkillFiles,
  guessMime,
  isTextMime,
} from "../src/core.js";

test("parseSkillUri splits on the first slash only (spec §3)", () => {
  assert.deepEqual(parseSkillUri("skill://my-skill/SKILL.md"), {
    name: "my-skill",
    fileRef: "SKILL.md",
  });
  assert.deepEqual(parseSkillUri("skill://s/scripts/a/b.py"), {
    name: "s",
    fileRef: "scripts/a/b.py",
  });
  assert.equal(parseSkillUri("skill://noslash"), null);
  assert.equal(parseSkillUri("https://example.com/x"), null);
  assert.equal(skillUri("s", "scripts/a.py"), "skill://s/scripts/a.py");
});

test("hashBytes is sha256:<hex> over raw bytes (spec §6.1)", () => {
  const h = hashBytes(Buffer.from("hello"));
  assert.match(h, /^sha256:[0-9a-f]{64}$/);
  assert.equal(h, "sha256:" + createHash("sha256").update("hello").digest("hex"));
});

test("frontmatter parsing matches the minimal subset (spec §8)", () => {
  const c = `---\ndescription: "Does PDF things"\ntags: [a, b, c]\nname: 'quoted'\n---\n# Title\nbody`;
  const { frontmatter, body } = parseFrontmatter(c);
  assert.equal(frontmatter.description, "Does PDF things");
  assert.deepEqual(frontmatter.tags, ["a", "b", "c"]);
  assert.equal(frontmatter.name, "quoted");
  assert.match(body, /# Title/);

  assert.deepEqual(parseFrontmatter("no frontmatter").frontmatter, {});
});

test("deriveDescription precedence (spec §8)", () => {
  assert.equal(
    deriveDescription(`---\ndescription: From FM\n---\n# Heading\n`, "x"),
    "From FM",
  );
  assert.equal(deriveDescription("# Heading Only\n\nmore", "x"), "Heading Only");
  assert.equal(deriveDescription("plain first line\nsecond", "x"), "plain first line");
  assert.equal(deriveDescription("", "fallback"), "Skill: fallback");
});

test("manifest shape includes skill, mainFile, files (spec §6.1)", () => {
  const m = buildManifest("s", "SKILL.md", [
    { path: "SKILL.md", size: 3, hash: "sha256:abc" },
  ]);
  const parsed = JSON.parse(manifestJson(m));
  assert.equal(parsed.skill, "s");
  assert.equal(parsed.mainFile, "SKILL.md");
  assert.equal(parsed.files[0].path, "SKILL.md");
  assert.equal(parsed.files[0].size, 3);
});

test("safeJoin blocks traversal and absolute paths (spec §9.1)", () => {
  const base = path.join(tmpdir(), "base");
  assert.equal(safeJoin(base, "a/b.txt"), path.resolve(base, "a/b.txt"));
  assert.equal(safeJoin(base, "../escape"), null);
  assert.equal(safeJoin(base, "/abs"), null);
});

test("guessMime / isTextMime", () => {
  assert.equal(guessMime("a.md"), "text/markdown");
  assert.equal(guessMime("a.py"), "text/x-python");
  assert.equal(guessMime("a.png"), "application/octet-stream");
  assert.equal(isTextMime("text/markdown"), true);
  assert.equal(isTextMime("application/json"), false);
});

test("scanSkillFiles returns sorted POSIX paths with hashes", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "skill-"));
  await writeFile(path.join(dir, "SKILL.md"), "# A\nhi");
  await mkdir(path.join(dir, "scripts"));
  await writeFile(path.join(dir, "scripts", "x.py"), "print(1)");

  const files = await scanSkillFiles(dir);
  assert.deepEqual(
    files.map((f) => f.path),
    ["SKILL.md", "scripts/x.py"],
  );
  for (const f of files) assert.match(f.hash, /^sha256:[0-9a-f]{64}$/);
});

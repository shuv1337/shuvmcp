/**
 * Client side: discover, inspect, and download skills from any conforming MCP
 * server (spec §7, §9). Discovery is by the `_manifest` URI pattern — NOT by a
 * hardcoded `/SKILL.md` suffix — so skills with a custom main file are visible.
 */

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Resource } from "@modelcontextprotocol/sdk/types.js";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import {
  DEFAULT_MAIN_FILE,
  MANIFEST_REF,
  type SkillFileEntry,
  type SkillManifest,
  hashBytes,
  parseSkillUri,
  skillUri,
} from "./core.js";

export interface SkillSummary {
  name: string;
  description: string;
  manifestUri: string;
}

export interface DownloadOptions {
  /** Overwrite an existing skill directory. Default false. */
  overwrite?: boolean;
  /** Verify each file's SHA-256 against the manifest after download. Default false. */
  verify?: boolean;
}

type Role = "manifest" | "main" | "file";

function metaRole(resource: Resource, fileRef: string): Role {
  const meta = (resource._meta ?? {}) as Record<string, unknown>;
  const hint = meta["skills"] as { role?: string } | undefined;
  if (fileRef === MANIFEST_REF) return "manifest";
  if (hint?.role === "main") return "main";
  // Fall back to the conventional main-file name when no `_meta` hint exists.
  if (fileRef === DEFAULT_MAIN_FILE) return "main";
  return "file";
}

async function listAllResources(client: Client): Promise<Resource[]> {
  const all: Resource[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listResources(cursor ? { cursor } : undefined);
    all.push(...page.resources);
    cursor = page.nextCursor;
  } while (cursor);
  return all;
}

/**
 * Discover skills by enumerating resources and matching `skill://{name}/_manifest`
 * (spec §7). A skill is reported only if it exposes a manifest. Description is
 * best-effort from the main-file resource; `getSkillManifest` is authoritative.
 */
export async function listSkills(client: Client): Promise<SkillSummary[]> {
  const resources = await listAllResources(client);
  const byName = new Map<string, SkillSummary>();

  for (const r of resources) {
    const parsed = parseSkillUri(String(r.uri));
    if (!parsed) continue;
    const role = metaRole(r, parsed.fileRef);

    let entry = byName.get(parsed.name);
    if (!entry) {
      entry = { name: parsed.name, description: "", manifestUri: "" };
      byName.set(parsed.name, entry);
    }
    if (role === "manifest") entry.manifestUri = String(r.uri);
    else if (role === "main" && r.description) entry.description = r.description;
  }

  return [...byName.values()].filter((e) => e.manifestUri.length > 0);
}

/** Read and validate a skill's manifest (spec §6.1). */
export async function getSkillManifest(
  client: Client,
  skillName: string,
): Promise<SkillManifest> {
  const res = await client.readResource({ uri: skillUri(skillName, MANIFEST_REF) });
  const first = res.contents[0];
  if (!first || !("text" in first) || typeof first.text !== "string") {
    throw new Error(`No manifest text for skill: ${skillName}`);
  }

  let data: unknown;
  try {
    data = JSON.parse(first.text);
  } catch {
    throw new Error(`Invalid manifest JSON for skill: ${skillName}`);
  }

  const obj = data as { skill?: unknown; mainFile?: unknown; files?: unknown };
  if (typeof obj.skill !== "string" || !Array.isArray(obj.files)) {
    throw new Error(`Invalid manifest shape for skill: ${skillName}`);
  }

  const files: SkillFileEntry[] = obj.files.map((f) => {
    const e = f as { path: unknown; size: unknown; hash: unknown };
    return { path: String(e.path), size: Number(e.size), hash: String(e.hash) };
  });
  const mainFile = typeof obj.mainFile === "string" ? obj.mainFile : DEFAULT_MAIN_FILE;

  return { skill: obj.skill, mainFile, files };
}

/**
 * Download a skill and all its files into `{targetDir}/{skillName}` (spec §9).
 * Enforces path-traversal safety and (optionally) verifies SHA-256 hashes.
 */
export async function downloadSkill(
  client: Client,
  skillName: string,
  targetDir: string,
  opts: DownloadOptions = {},
): Promise<string> {
  const base = path.resolve(targetDir);
  const skillDir = path.resolve(base, skillName);
  if (skillDir !== base && !skillDir.startsWith(base + path.sep)) {
    throw new Error(`Skill name ${skillName} would escape the target directory.`);
  }

  if (!opts.overwrite) {
    const exists = await fs.access(skillDir).then(
      () => true,
      () => false,
    );
    if (exists) {
      throw new Error(`Skill directory already exists: ${skillDir}. Pass overwrite to replace.`);
    }
  }

  const manifest = await getSkillManifest(client, skillName);
  await fs.mkdir(skillDir, { recursive: true });

  for (const f of manifest.files) {
    if (path.isAbsolute(f.path)) continue;
    const dest = path.resolve(skillDir, ...f.path.split("/"));
    if (dest !== skillDir && !dest.startsWith(skillDir + path.sep)) continue;

    const res = await client.readResource({ uri: skillUri(skillName, f.path) });
    const content = res.contents[0];
    if (!content) continue;

    let bytes: Buffer;
    if ("text" in content && typeof content.text === "string") {
      bytes = Buffer.from(content.text, "utf-8");
    } else if ("blob" in content && typeof content.blob === "string") {
      bytes = Buffer.from(content.blob, "base64");
    } else {
      continue;
    }

    if (opts.verify && hashBytes(bytes) !== f.hash) {
      throw new Error(`Hash mismatch for ${skillName}/${f.path} (see spec §6 integrity hazard).`);
    }

    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, bytes);
  }

  return skillDir;
}

/** Download every discovered skill; skips existing ones unless `overwrite`. */
export async function syncSkills(
  client: Client,
  targetDir: string,
  opts: DownloadOptions = {},
): Promise<string[]> {
  const skills = await listSkills(client);
  const downloaded: string[] = [];
  for (const s of skills) {
    try {
      downloaded.push(await downloadSkill(client, s.name, targetDir, opts));
    } catch (err) {
      if (err instanceof Error && err.message.includes("already exists")) continue;
      throw err;
    }
  }
  return downloaded;
}

/**
 * Core, SDK-agnostic logic for the Skills-as-Resources wire spec.
 *
 * Pure functions only — no MCP SDK imports — so the conformance-critical pieces
 * (URI parsing, manifest shape, hashing, frontmatter, path-traversal guards) are
 * unit-testable in isolation. See ../../../spec/skills-as-resources.md.
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";

export const SKILL_SCHEME = "skill://";
export const MANIFEST_REF = "_manifest";
export const DEFAULT_MAIN_FILE = "SKILL.md";

export type SupportingFilesMode = "resources" | "template";

export interface SkillFileEntry {
  /** POSIX-style path relative to the skill directory. */
  path: string;
  /** File size in bytes. */
  size: number;
  /** Content hash as `<alg>:<lowercase-hex>` over the raw bytes. */
  hash: string;
}

export interface SkillManifest {
  skill: string;
  mainFile: string;
  files: SkillFileEntry[];
}

export interface ParsedSkillUri {
  name: string;
  fileRef: string;
}

/**
 * Parse a `skill://{name}/{file-ref}` URI per spec §3: strip the scheme and
 * split on the FIRST `/` into exactly two non-empty parts. Returns null for
 * anything that is not a valid skill resource URI.
 */
export function parseSkillUri(uri: string): ParsedSkillUri | null {
  if (!uri.startsWith(SKILL_SCHEME)) return null;
  const rest = uri.slice(SKILL_SCHEME.length);
  const idx = rest.indexOf("/");
  if (idx < 0) return null;
  const name = rest.slice(0, idx);
  const fileRef = rest.slice(idx + 1);
  if (name.length === 0 || fileRef.length === 0) return null;
  return { name, fileRef };
}

export function skillUri(name: string, fileRef: string): string {
  return `${SKILL_SCHEME}${name}/${fileRef}`;
}

/** SHA-256 of raw bytes, formatted as `sha256:<lowercase-hex>` (spec §6.1). */
export function hashBytes(bytes: Uint8Array): string {
  return "sha256:" + createHash("sha256").update(bytes).digest("hex");
}

/**
 * Minimal YAML-frontmatter subset matching the FastMCP reference (spec §8):
 * a leading `---` block closed by a line matching `\n---\s*\n`, then flat
 * `key: value` lines with surrounding quotes stripped and flat `[a, b, c]`
 * lists. No nested structures or typed scalars.
 */
export function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  if (!content.startsWith("---")) return { frontmatter: {}, body: content };
  const after = content.slice(3);
  const close = after.match(/\n---\s*\n/);
  if (!close || close.index === undefined) return { frontmatter: {}, body: content };

  const fmText = after.slice(0, close.index);
  const body = after.slice(close.index + close[0].length);
  const frontmatter: Record<string, unknown> = {};

  for (const line of fmText.trim().split("\n")) {
    const ci = line.indexOf(":");
    if (ci < 0) continue;
    const key = line.slice(0, ci).trim();
    let value = line.slice(ci + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      frontmatter[key] = value.slice(1, -1);
      continue;
    }
    if (value.startsWith("[") && value.endsWith("]")) {
      frontmatter[key] = value
        .slice(1, -1)
        .split(",")
        .map((it) => it.trim().replace(/^["']+|["']+$/g, ""))
        .filter((it) => it.length > 0);
      continue;
    }
    frontmatter[key] = value;
  }

  return { frontmatter, body };
}

/** Derive a skill description from frontmatter or the body (spec §8). */
export function deriveDescription(content: string, skillName: string): string {
  const { frontmatter, body } = parseFrontmatter(content);
  const fmDesc = frontmatter["description"];
  if (typeof fmDesc === "string" && fmDesc.length > 0) return fmDesc;

  for (const raw of body.trim().split("\n")) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (line.startsWith("#")) return line.replace(/^#+/, "").trim().slice(0, 200);
    return line.slice(0, 200);
  }
  return `Skill: ${skillName}`;
}

async function walkFiles(baseDir: string, relDir = ""): Promise<string[]> {
  const here = relDir ? path.join(baseDir, ...relDir.split("/")) : baseDir;
  const entries = await fs.readdir(here, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    const rel = relDir ? `${relDir}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push(...(await walkFiles(baseDir, rel)));
    } else if (e.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

/**
 * Scan a skill directory recursively, returning every file with its POSIX
 * relative path, byte size, and `sha256:` hash, sorted by path (spec §6.1).
 */
export async function scanSkillFiles(skillDir: string): Promise<SkillFileEntry[]> {
  const rels = (await walkFiles(skillDir)).sort();
  const files: SkillFileEntry[] = [];
  for (const rel of rels) {
    const abs = path.join(skillDir, ...rel.split("/"));
    const bytes = await fs.readFile(abs);
    files.push({ path: rel, size: bytes.byteLength, hash: hashBytes(bytes) });
  }
  return files;
}

export function buildManifest(
  name: string,
  mainFile: string,
  files: SkillFileEntry[],
): SkillManifest {
  return { skill: name, mainFile, files };
}

export function manifestJson(manifest: SkillManifest): string {
  return JSON.stringify(manifest, null, 2);
}

/**
 * Resolve `relPath` under `baseDir`, returning the absolute path only if it
 * stays inside `baseDir`. Rejects absolute paths and `..` escapes (spec §9.1).
 */
export function safeJoin(baseDir: string, relPath: string): string | null {
  if (path.isAbsolute(relPath)) return null;
  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, ...relPath.split("/"));
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
  return resolved;
}

const TEXT_MIME_BY_EXT: Record<string, string> = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".ts": "text/plain",
  ".py": "text/x-python",
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".csv": "text/csv",
  ".xml": "text/xml",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".toml": "text/plain",
  ".ini": "text/plain",
  ".cfg": "text/plain",
  ".sh": "text/x-shellscript",
  ".rst": "text/plain",
};

/**
 * Guess a MIME type from a file path. Returns a `text/*` type for known text
 * extensions, otherwise `application/octet-stream`. Override as needed; this is
 * intentionally a small, dependency-free table.
 */
export function guessMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return TEXT_MIME_BY_EXT[ext] ?? "application/octet-stream";
}

export function isTextMime(mime: string): boolean {
  return mime.startsWith("text/");
}

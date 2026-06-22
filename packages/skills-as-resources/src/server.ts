/**
 * Server side: expose filesystem skills as MCP resources + a resource template,
 * conforming to spec §4–§7. Built on the low-level `Server` request handlers so
 * the exact wire shape (URIs, MIME types, manifest, `_meta` hints) is explicit.
 */

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  Resource,
  ResourceTemplate,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import {
  DEFAULT_MAIN_FILE,
  MANIFEST_REF,
  SKILL_SCHEME,
  type SkillFileEntry,
  type SupportingFilesMode,
  buildManifest,
  deriveDescription,
  guessMime,
  isTextMime,
  manifestJson,
  parseSkillUri,
  safeJoin,
  scanSkillFiles,
  skillUri,
} from "./core.js";

export interface SkillsProviderOptions {
  /** Serve a single skill directory (its basename becomes the skill name). */
  skillDir?: string;
  /** Scan these roots; each subdirectory containing the main file is a skill. */
  roots?: string[];
  /** Main file name. Default `SKILL.md`. */
  mainFileName?: string;
  /** How supporting files are exposed (spec §5). Default `template`. */
  supportingFiles?: SupportingFilesMode;
  /** Re-scan the filesystem on each request. Default false. */
  reload?: boolean;
}

interface LoadedSkill {
  name: string;
  dir: string;
  mainFile: string;
  description: string;
  files: SkillFileEntry[];
}

async function realContainedPath(
  baseDir: string,
  relPath: string,
): Promise<string | null> {
  const lexicalPath = safeJoin(baseDir, relPath);
  if (!lexicalPath) return null;

  let realBase: string;
  let realTarget: string;
  try {
    [realBase, realTarget] = await Promise.all([
      fs.realpath(baseDir),
      fs.realpath(lexicalPath),
    ]);
  } catch {
    return null;
  }

  if (realTarget !== realBase && !realTarget.startsWith(realBase + path.sep)) {
    return null;
  }
  return realTarget;
}

export class SkillsProvider {
  private readonly skillDir?: string;
  private readonly roots: string[];
  private readonly mainFileName: string;
  private readonly supportingFiles: SupportingFilesMode;
  private readonly reload: boolean;
  private skills: Map<string, LoadedSkill> | null = null;

  constructor(opts: SkillsProviderOptions) {
    if (!opts.skillDir && (!opts.roots || opts.roots.length === 0)) {
      throw new Error("SkillsProvider requires either `skillDir` or `roots`.");
    }
    this.skillDir = opts.skillDir ? path.resolve(opts.skillDir) : undefined;
    this.roots = (opts.roots ?? []).map((r) => path.resolve(r));
    this.mainFileName = opts.mainFileName ?? DEFAULT_MAIN_FILE;
    this.supportingFiles = opts.supportingFiles ?? "template";
    this.reload = opts.reload ?? false;
  }

  /** Scan the filesystem and (re)build the in-memory skill set. */
  async load(): Promise<void> {
    const skills = new Map<string, LoadedSkill>();
    const candidateDirs: string[] = [];

    if (this.skillDir) candidateDirs.push(this.skillDir);
    for (const root of this.roots) {
      let entries;
      try {
        entries = await fs.readdir(root, { withFileTypes: true });
      } catch {
        continue; // missing root is fine
      }
      for (const e of entries) {
        if (e.isDirectory()) candidateDirs.push(path.join(root, e.name));
      }
    }

    for (const dir of candidateDirs) {
      const name = path.basename(dir);
      if (skills.has(name)) continue; // first-wins de-dup (spec Appendix B)

      const mainPath = await realContainedPath(dir, this.mainFileName);
      if (!mainPath) continue;
      let content: string;
      try {
        content = await fs.readFile(mainPath, "utf-8");
      } catch {
        continue; // no main file -> not a skill
      }

      const files = await scanSkillFiles(dir);
      skills.set(name, {
        name,
        dir,
        mainFile: this.mainFileName,
        description: deriveDescription(content, name),
        files,
      });
    }

    this.skills = skills;
  }

  private async ensure(): Promise<Map<string, LoadedSkill>> {
    if (this.skills === null || this.reload) await this.load();
    return this.skills as Map<string, LoadedSkill>;
  }

  async listResources(): Promise<Resource[]> {
    const skills = await this.ensure();
    const out: Resource[] = [];

    for (const s of skills.values()) {
      out.push({
        uri: skillUri(s.name, s.mainFile),
        name: `${s.name}/${s.mainFile}`,
        description: s.description,
        mimeType: "text/markdown",
        _meta: { skills: { role: "main", skill: s.name } },
      });
      out.push({
        uri: skillUri(s.name, MANIFEST_REF),
        name: `${s.name}/${MANIFEST_REF}`,
        description: `File listing for ${s.name}`,
        mimeType: "application/json",
        _meta: { skills: { role: "manifest", skill: s.name } },
      });

      if (this.supportingFiles === "resources") {
        for (const f of s.files) {
          if (f.path === s.mainFile) continue;
          out.push({
            uri: skillUri(s.name, f.path),
            name: `${s.name}/${f.path}`,
            description: `File from ${s.name} skill`,
            mimeType: guessMime(f.path),
            _meta: { skills: { role: "file", skill: s.name } },
          });
        }
      }
    }

    return out;
  }

  async listResourceTemplates(): Promise<ResourceTemplate[]> {
    if (this.supportingFiles !== "template") return [];
    const skills = await this.ensure();
    const out: ResourceTemplate[] = [];
    for (const s of skills.values()) {
      out.push({
        uriTemplate: `${SKILL_SCHEME}${s.name}/{path*}`,
        name: `${s.name}_files`,
        description: `Access files within ${s.name}`,
        mimeType: "application/octet-stream",
        _meta: { skills: { role: "file", skill: s.name } },
      });
    }
    return out;
  }

  /**
   * Resolve a `skill://` URI to MCP resource contents, or null if it is not a
   * skill resource this provider serves. Reads of any existing in-skill file
   * succeed in both modes (mode only governs what is *listed*, per spec §5).
   */
  async readResource(uri: string): Promise<ReadResourceResult["contents"] | null> {
    const parsed = parseSkillUri(uri);
    if (!parsed) return null;

    const skills = await this.ensure();
    const s = skills.get(parsed.name);
    if (!s) return null;

    if (parsed.fileRef === MANIFEST_REF) {
      const manifest = buildManifest(s.name, s.mainFile, s.files);
      return [{ uri, mimeType: "application/json", text: manifestJson(manifest) }];
    }

    const abs = await realContainedPath(s.dir, parsed.fileRef);
    if (!abs) return null;
    let stat;
    try {
      stat = await fs.stat(abs);
    } catch {
      return null;
    }
    if (!stat.isFile()) return null;

    const mime = parsed.fileRef === s.mainFile ? "text/markdown" : guessMime(parsed.fileRef);
    if (isTextMime(mime)) {
      return [{ uri, mimeType: mime, text: await fs.readFile(abs, "utf-8") }];
    }
    const blob = (await fs.readFile(abs)).toString("base64");
    return [{ uri, mimeType: mime, blob }];
  }
}

/**
 * Wire one or more {@link SkillsProvider}s onto a low-level MCP `Server` by
 * registering the `resources/list`, `resources/templates/list`, and
 * `resources/read` request handlers. Providers are consulted in order; the
 * first to resolve a read wins.
 */
export function registerSkills(
  server: Server,
  providers: SkillsProvider | SkillsProvider[],
): void {
  const list = Array.isArray(providers) ? providers : [providers];

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const resources: Resource[] = [];
    for (const p of list) resources.push(...(await p.listResources()));
    return { resources };
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    const resourceTemplates: ResourceTemplate[] = [];
    for (const p of list) resourceTemplates.push(...(await p.listResourceTemplates()));
    return { resourceTemplates };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const uri = req.params.uri;
    for (const p of list) {
      const contents = await p.readResource(uri);
      if (contents) return { contents };
    }
    throw new Error(`Resource not found: ${uri}`);
  });
}

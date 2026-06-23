/**
 * skills-as-resources — reference implementation of the Skills-as-Resources MCP
 * wire spec (../../spec/skills-as-resources.md) on @modelcontextprotocol/sdk.
 */

export {
  SKILL_SCHEME,
  MANIFEST_REF,
  DEFAULT_MAIN_FILE,
  type SupportingFilesMode,
  type SkillFileEntry,
  type SkillManifest,
  type ParsedSkillUri,
  parseSkillUri,
  skillUri,
  hashBytes,
  parseFrontmatter,
  deriveDescription,
  scanSkillFiles,
  buildManifest,
  manifestJson,
  safeJoin,
  guessMime,
  isTextMime,
} from "./core.js";

export {
  type SkillsProviderOptions,
  SkillsProvider,
  registerSkills,
} from "./server.js";

export {
  type SkillSummary,
  type DownloadOptions,
  listSkills,
  getSkillManifest,
  downloadSkill,
  syncSkills,
} from "./client.js";

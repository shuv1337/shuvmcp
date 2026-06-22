# Skills-as-Resources — MCP Wire Specification

**Status:** Draft 0.1 · **Layer:** Convention over standard MCP (no protocol extension) · **Last updated:** 2026-06-21

## Abstract

This document specifies a **language-neutral wire contract** for exposing filesystem
*agent skills* — `SKILL.md`-style directories used by Claude Code, Cursor, Codex, Goose,
and others — over the Model Context Protocol (MCP) as ordinary **resources** and
**resource templates**. It requires no MCP protocol extension and no special SDK support:
any MCP implementation that can serve resources and resource templates can implement it.

A server in any language that conforms to this contract interoperates with a client in any
language, and with the existing FastMCP Python implementation. The spec is derived from
that implementation and is interoperable with it, with two deliberate, backward-compatible
improvements called out in [§11](#11-relationship-to-the-fastmcp-reference-implementation).

## 1. Motivation

Agent skills live in platform-specific directories (`~/.claude/skills/`, `~/.cursor/skills/`,
…). Exposing them over MCP lets any MCP client discover, read, and copy skills from any
server, independent of the host platform. Because skills are just files plus a small amount
of metadata, the entire feature reduces to a **URI scheme** + a **manifest shape** + a
**discovery rule**. This document fixes those three things so implementations interoperate.

## 2. Terminology

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, **MAY**, and
**RECOMMENDED** are to be interpreted as described in RFC 2119.

- **Skill** — a directory containing a *main file* (default `SKILL.md`) and zero or more
  *supporting files*. The directory name is the skill's canonical identifier.
- **Main file** — the skill's entry-point document. Conventionally `SKILL.md`, but a server
  MAY use another name; clients MUST NOT assume the name (see [§7](#7-discovery)).
- **Supporting file** — any other file in the skill directory, at any nesting depth.
- **Manifest** — a synthetic JSON document, not a real file, listing the skill's files with
  sizes and content hashes. Served at a reserved URI.
- **Server** — an MCP server exposing skills. **Client** — an MCP client consuming them.

## 3. The `skill://` URI scheme

All skill resources use the custom URI scheme `skill://`. The authority/path grammar is:

```
skill-uri   = "skill://" skill-name "/" file-ref
skill-name  = 1*( unreserved )      ; a single path segment; MUST NOT contain "/"
file-ref    = "_manifest"           ; the reserved manifest path
            / rel-path              ; a POSIX-style relative path, MAY contain "/"
rel-path    = segment *( "/" segment )
```

Parsing rule (normative): given a URI beginning with `skill://`, strip the `skill://`
prefix and split the remainder on the **first** `/` into exactly two parts,
`skill-name` and `file-ref`. A URI with no `/` after the scheme is not a valid skill
resource URI.

- `skill-name` is the skill directory name and the canonical identifier.
- `file-ref` of `_manifest` is **reserved** for the synthetic manifest. A server MUST NOT
  serve an on-disk file at `_manifest`; if such a file exists it is shadowed by the manifest.
- All other `file-ref` values are POSIX relative paths (forward slashes) of files within the
  skill directory. Backslashes MUST NOT appear; servers MUST normalize OS paths to POSIX.

## 4. Resources a server exposes

For each skill, a conforming server MUST expose:

| Resource | URI | MIME type | Required |
| --- | --- | --- | --- |
| Main file | `skill://{name}/{mainFile}` | `text/markdown` | MUST |
| Manifest | `skill://{name}/_manifest` | `application/json` | MUST |
| Supporting files | `skill://{name}/{path}` | guessed (see [§6](#6-content-transfer-and-encoding)) | mode-dependent ([§5](#5-supporting-file-exposure-modes)) |

- The main-file and manifest resources MUST appear in `resources/list`.
- The main-file resource's `description` SHOULD be the skill's human-readable description
  (see [§8](#8-server-side-description-derivation-informative)).
- Servers MAY attach implementation-specific data under each resource's `_meta`. Clients
  MUST NOT depend on any `_meta` field for correctness; `_meta` is advisory only. (A
  RECOMMENDED discovery marker is defined in [§7](#7-discovery), but it is an optimization,
  not a requirement.)

## 5. Supporting-file exposure modes

A server exposes supporting files in exactly one of two modes. The mode is a server
configuration choice and is observable by the client (a `resources/templates/list` entry is
present in `template` mode and absent in `resources` mode).

### 5.1 `resources` mode (enumerated)

Every supporting file is listed individually in `resources/list` as
`skill://{name}/{path}`. The main file and `_manifest` are not duplicated. No resource
template is exposed. This mode requires no URI-template support and is the **interoperable
baseline**: every conforming client and server MUST support it.

### 5.2 `template` mode (on-demand)

Supporting files are **not** listed in `resources/list`. Instead the server exposes a single
resource template:

```
uriTemplate: skill://{name}/{path*}
parameters:  { "type": "object",
               "properties": { "path": { "type": "string" } },
               "required": ["path"] }
```

The `{path*}` operator is RFC 6570 level-4 *path-style explode*: it MUST capture a value that
**may contain `/`**, so a single template matches nested files such as
`skill://my-skill/scripts/helpers/util.py`. Clients discover the file set by reading the
manifest, then read each file by expanding the template.

> **Implementation note.** Many MCP SDK URI-template engines match only single-segment
> `{var}` and will not capture across `/`. If the target SDK lacks greedy `{path*}` capture,
> the server SHOULD fall back to `resources` mode rather than silently truncating paths.
> `template` mode is an optimization for skills with many files; `resources` mode is always
> correct.

## 6. Content transfer and encoding

A file is transferred using standard MCP resource contents:

- If the file's guessed MIME type begins with `text/`, the server SHOULD return it as
  `TextResourceContents` (`text` field, UTF-8).
- Otherwise the server SHOULD return it as `BlobResourceContents` (`blob` field, base64 of
  the raw bytes).
- The main file is always `text/markdown` (text). The manifest is always `application/json`
  (text).

Clients MUST accept **both** `TextResourceContents` and `BlobResourceContents` for any
supporting file and MUST NOT assume a file's transfer form from its extension, because MIME
guessing differs across implementations.

> **Integrity hazard (normative guidance).** Manifest hashes are computed over the file's
> **raw bytes** ([§6.1 of the manifest](#61-manifest-object)). Transferring a file as
> *text* can mutate bytes (newline translation, re-encoding), so a naively re-serialized text
> file MAY NOT match its manifest hash. Implementations that need verifiable integrity SHOULD
> transfer integrity-checked files as `blob`, and clients SHOULD verify the SHA-256 of the
> bytes they persist against the manifest hash. A mismatch SHOULD be surfaced, not silently
> accepted.

### 6.1 Manifest object

The manifest served at `skill://{name}/_manifest` is a JSON object:

```json
{
  "skill": "pdf-processing",
  "mainFile": "SKILL.md",
  "files": [
    { "path": "SKILL.md",            "size": 1843, "hash": "sha256:9f86d0…" },
    { "path": "reference.md",        "size":  920, "hash": "sha256:2c2624…" },
    { "path": "scripts/extract.py",  "size": 4096, "hash": "sha256:18ac34…" }
  ]
}
```

Normative field rules:

- `skill` (string, REQUIRED) — the skill name; MUST equal the `{name}` in the manifest URI.
- `mainFile` (string, RECOMMENDED) — the main file's `path` within `files`. If absent,
  clients MUST default to `"SKILL.md"`. Servers using a non-default main file MUST set this.
- `files` (array, REQUIRED) — every file in the skill directory, **including the main file**.
  The `_manifest` itself is synthetic and MUST NOT appear. Each entry:
  - `path` (string, REQUIRED) — POSIX relative path within the skill directory.
  - `size` (integer, REQUIRED) — file size in bytes.
  - `hash` (string, REQUIRED) — content hash as `"<alg>:<lowercase-hex>"`. Implementations
    MUST emit `sha256:` and MUST be able to verify `sha256:`; other algorithms MAY be added
    but MUST carry the `<alg>:` prefix. The hash is over the file's raw bytes.
- `files` SHOULD be emitted in a deterministic order. Sorting by `path` is RECOMMENDED for
  diff-friendly output; the FastMCP reference instead emits filesystem-traversal order
  (`sorted(rglob("*"))`), which usually but not always coincides. Clients MUST NOT rely on
  ordering for correctness.
- Parsers MUST ignore unknown fields. JSON formatting (indentation) is not significant.

## 7. Discovery

A client discovers skills by enumerating `resources/list` and selecting resources whose URI
matches the manifest pattern:

```
^skill://([^/]+)/_manifest$
```

The captured group is the skill name. For each match, the client reads the manifest to obtain
`mainFile` and `files`. This is the **normative discovery mechanism**. It is robust to the
main file having any name, and it interoperates with existing FastMCP servers (which already
list a `_manifest` resource per skill).

- Clients MUST NOT discover skills solely by matching a hardcoded main-file URI suffix such as
  `/SKILL.md`; doing so makes skills with a custom main file invisible. (This corrects a
  defect in the reference implementation — see [§11](#11-relationship-to-the-fastmcp-reference-implementation).)
- Servers SHOULD additionally mark the manifest and main-file resources with a discovery
  hint under `_meta` so that hosts MAY identify them without reading every manifest:

  ```json
  "_meta": { "skills": { "role": "manifest", "skill": "pdf-processing" } }
  ```

  with `role` one of `"manifest"`, `"main"`, or `"file"`. This is an OPTIONAL optimization;
  clients MUST function using URI-pattern discovery alone. (The FastMCP reference currently
  emits a different, FastMCP-namespaced shape — `_meta.fastmcp.skill = { "name", "is_manifest" }`
  — on its main-file and manifest resources; clients MAY read that form for interoperability,
  but MUST NOT require it.)

## 8. Server-side description derivation (informative)

This section is non-normative; it documents the reference behavior so servers can match it.
The skill description shown to clients is derived as:

1. The `description` value from the main file's YAML frontmatter, if present and non-empty.
2. Otherwise, the first non-empty line of the body: if it is a Markdown heading, the heading
   text with leading `#` and whitespace stripped; otherwise the line itself — truncated to
   200 characters.
3. Otherwise, `"Skill: {name}"`.

Frontmatter parsing in the reference is a deliberately minimal subset of YAML: a leading
`---` block terminated by a line matching `\n---\s*\n`, then flat `key: value` lines with
optional surrounding quotes stripped and flat `[a, b, c]` lists. Nested structures, block
scalars, and typed scalars are not interpreted. Servers MAY use a full YAML parser; doing so
is more correct but can change which `description` is produced for exotic frontmatter.

## 9. Client operations

A conforming client SHOULD provide:

- **list** — discover skills per [§7](#7-discovery), returning `{ name, description, manifestUri }`.
  `description` comes from the main-file resource's `description` field when available.
- **manifest** — read and parse `skill://{name}/_manifest` into `{ skill, mainFile, files }`.
- **download** — given a skill name and a target directory, read the manifest, then read each
  `files[*]` entry via `skill://{name}/{path}` and write it under `{target}/{name}/{path}`,
  creating parent directories. Clients SHOULD verify hashes ([§6](#6-content-transfer-and-encoding)).
- **sync** — download every discovered skill.

### 9.1 Path-traversal safety (normative)

Both servers and clients MUST prevent path traversal:

- A server resolving `skill://{name}/{path}` MUST reject any `path` whose resolved location is
  not inside the skill directory (e.g. resolve symlinks/`..` and assert containment).
- A client writing `files[*].path` MUST reject absolute paths and any entry whose resolved
  destination escapes `{target}/{name}`.

Entries that fail these checks MUST be skipped or cause a hard error; they MUST NOT be served
or written.

## 10. Conformance

A **minimal interoperable implementation**:

- Server: exposes, per skill, the main-file resource, the manifest resource (with `skill`,
  `mainFile`, and `files` carrying `path`/`size`/`sha256:` hashes), and supporting files in
  `resources` mode. Enforces [§9.1](#91-path-traversal-safety-normative).
- Client: discovers via the `_manifest` URI pattern ([§7](#7-discovery)), reads manifests,
  downloads files in `resources` mode, verifies hashes, enforces [§9.1](#91-path-traversal-safety-normative).

`template` mode and the `_meta.skills` discovery hint are OPTIONAL; an implementation that
omits them is still conformant.

## 11. Relationship to the FastMCP reference implementation

This spec is derived from FastMCP's `fastmcp.server.providers.skills` and
`fastmcp.utilities.skills`. It is wire-interoperable with that implementation, with two
deliberate, backward-compatible changes:

1. **Discovery by manifest, not by `/SKILL.md`.** The FastMCP client
   (`utilities/skills.py`) discovers skills by matching the URI suffix `/SKILL.md`, so a
   server configured with a non-default `main_file_name` is invisible to it. This spec
   mandates discovery via the `_manifest` URI ([§7](#7-discovery)), which works for any main
   file and still finds existing FastMCP skills (they expose `_manifest`).
2. **`mainFile` in the manifest.** The reference manifest is `{ skill, files }` with no
   indication of the entry point, forcing the `/SKILL.md` assumption. This spec adds the
   RECOMMENDED `mainFile` field and defines the `"SKILL.md"` default when it is absent, so
   spec-compliant clients still read older FastMCP manifests correctly.

Everything else — the `skill://` scheme, the first-slash split, the reserved `_manifest`
path, the `sha256:`-prefixed hashes over raw bytes, the `{path*}` template, the two
supporting-file modes, and the path-traversal guards — matches the reference behavior exactly.

## Appendix A — Worked example

Skill directory (`mainFile = SKILL.md`):

```
pdf-processing/
├── SKILL.md
├── reference.md
└── scripts/
    └── extract.py
```

Resources in `template` mode (`resources/list`):

```
skill://pdf-processing/SKILL.md      (text/markdown)
skill://pdf-processing/_manifest     (application/json)
```

Resource template (`resources/templates/list`):

```
skill://pdf-processing/{path*}
```

Reading `skill://pdf-processing/_manifest`:

```json
{
  "skill": "pdf-processing",
  "mainFile": "SKILL.md",
  "files": [
    { "path": "SKILL.md",           "size": 1843, "hash": "sha256:9f86d0…" },
    { "path": "reference.md",       "size":  920, "hash": "sha256:2c2624…" },
    { "path": "scripts/extract.py", "size": 4096, "hash": "sha256:18ac34…" }
  ]
}
```

A client then reads `skill://pdf-processing/scripts/extract.py` (template-expanded), receives
`TextResourceContents` or `BlobResourceContents`, verifies the SHA-256 of the bytes against
the manifest, and writes `{target}/pdf-processing/scripts/extract.py`.

## Appendix B — Vendor skill directories (informative)

Preset roots used by the reference vendor providers, for reference when building a discovery
front-end:

| Platform | Root(s) |
| --- | --- |
| Claude | `~/.claude/skills` |
| Cursor | `~/.cursor/skills` |
| VS Code | `~/.copilot/skills` |
| GitHub Copilot | `~/.copilot/skills` |
| Codex | `/etc/codex/skills`, `~/.codex/skills` (system first) |
| Gemini | `~/.gemini/skills` |
| Goose | `~/.config/agents/skills` |
| OpenCode | `~/.config/opencode/skills` |

When scanning multiple roots, a skill name found in an earlier root takes precedence
(first-wins de-duplication).

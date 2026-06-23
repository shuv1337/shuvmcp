"""Client utilities for discovering and downloading skills from MCP servers."""

from __future__ import annotations

import base64
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

import mcp.types

if TYPE_CHECKING:
    from fastmcp.client import Client


@dataclass
class SkillSummary:
    """Summary information about a skill available on a server."""

    name: str
    description: str
    uri: str


@dataclass
class SkillFile:
    """Information about a file within a skill."""

    path: str
    size: int
    hash: str
    executable: bool = False


@dataclass
class SkillManifest:
    """Full manifest of a skill including all files."""

    name: str
    files: list[SkillFile]


async def list_skills(client: Client) -> list[SkillSummary]:
    """List all available skills from an MCP server.

    Discovers skills by finding resources with URIs matching the
    `skill://{name}/SKILL.md` pattern.

    Args:
        client: Connected FastMCP client

    Returns:
        List of SkillSummary objects with name, description, and URI

    Example:
        ```python
        from fastmcp import Client
        from fastmcp.utilities.skills import list_skills

        async with Client("http://skills-server/mcp") as client:
            skills = await list_skills(client)
            for skill in skills:
                print(f"{skill.name}: {skill.description}")
        ```
    """
    resources = await client.list_resources()
    skills = []

    for resource in resources:
        uri = str(resource.uri)
        # Match skill://{name}/SKILL.md pattern
        if uri.startswith("skill://") and uri.endswith("/SKILL.md"):
            # Extract skill name from URI
            path_part = uri[len("skill://") :]
            name = path_part.rsplit("/", 1)[0]
            skills.append(
                SkillSummary(
                    name=name,
                    description=resource.description or "",
                    uri=uri,
                )
            )

    return skills


async def get_skill_manifest(client: Client, skill_name: str) -> SkillManifest:
    """Get the manifest for a specific skill.

    Args:
        client: Connected FastMCP client
        skill_name: Name of the skill

    Returns:
        SkillManifest with file listing

    Raises:
        ValueError: If manifest cannot be read or parsed
    """
    manifest_uri = f"skill://{skill_name}/_manifest"
    result = await client.read_resource(manifest_uri)

    if not result:
        raise ValueError(f"Could not read manifest for skill: {skill_name}")

    content = result[0]
    if isinstance(content, mcp.types.TextResourceContents):
        try:
            manifest_data = json.loads(content.text)
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid manifest JSON for skill: {skill_name}") from e
    else:
        raise ValueError(f"Unexpected manifest format for skill: {skill_name}")

    try:
        return SkillManifest(
            name=manifest_data["skill"],
            files=[
                SkillFile(
                    path=f["path"],
                    size=f["size"],
                    hash=f["hash"],
                    executable=bool(f.get("executable", False)),
                )
                for f in manifest_data["files"]
            ],
        )
    except (KeyError, TypeError) as e:
        raise ValueError(f"Invalid manifest format for skill: {skill_name}") from e


async def download_skill(
    client: Client,
    skill_name: str,
    target_dir: str | Path,
    *,
    overwrite: bool = False,
    verify: bool = True,
) -> Path:
    """Download a skill and all its files to a local directory.

    Creates a subdirectory named after the skill containing all files. Restores
    the executable bit for files the manifest marks ``executable`` (spec §6.1),
    so a skill's scripts are runnable after download.

    Args:
        client: Connected FastMCP client
        skill_name: Name of the skill to download
        target_dir: Directory where skill folder will be created
        overwrite: If True, overwrite existing skill directory. If False
            (default), raise FileExistsError if directory exists.
        verify: If True (default), verify each file's SHA-256 against the
            manifest hash before keeping it and raise on mismatch (spec §6).
            A server that serves text files in text mode may newline-translate
            them; serve such files as binary blobs for byte-exact integrity.

    Returns:
        Path to the downloaded skill directory

    Raises:
        ValueError: If skill cannot be found/downloaded, or a hash mismatches
        FileExistsError: If skill directory exists and overwrite=False

    Example:
        ```python
        from fastmcp import Client
        from fastmcp.utilities.skills import download_skill

        async with Client("http://skills-server/mcp") as client:
            skill_path = await download_skill(
                client,
                "pdf-processing",
                "~/.claude/skills"
            )
            print(f"Downloaded to: {skill_path}")
        ```
    """
    target_dir = Path(target_dir).expanduser().resolve()
    skill_dir = (target_dir / skill_name).resolve()

    # Security: ensure skill_dir stays within target_dir
    if not skill_dir.is_relative_to(target_dir):
        raise ValueError(f"Skill name {skill_name!r} would escape the target directory")

    # Check if directory exists
    if skill_dir.exists() and not overwrite:
        raise FileExistsError(
            f"Skill directory already exists: {skill_dir}. "
            "Use overwrite=True to replace."
        )

    # Get manifest to know what files to download
    manifest = await get_skill_manifest(client, skill_name)

    # Create skill directory
    skill_dir.mkdir(parents=True, exist_ok=True)

    # Download each file
    for file_info in manifest.files:
        # Security: reject absolute paths and paths that escape skill_dir
        if Path(file_info.path).is_absolute():
            continue
        file_path = (skill_dir / file_info.path).resolve()
        if not file_path.is_relative_to(skill_dir):
            continue

        file_uri = f"skill://{skill_name}/{file_info.path}"
        result = await client.read_resource(file_uri)

        if not result:
            continue

        content = result[0]

        # Resolve the exact bytes to persist (verify against the manifest hash)
        if isinstance(content, mcp.types.TextResourceContents):
            data = content.text.encode("utf-8")
        elif isinstance(content, mcp.types.BlobResourceContents):
            data = base64.b64decode(content.blob)
        else:
            # Skip unknown content types
            continue

        # Integrity: verify SHA-256 of the bytes we persist (spec §6).
        if verify and file_info.hash.startswith("sha256:"):
            actual = "sha256:" + hashlib.sha256(data).hexdigest()
            if actual != file_info.hash:
                raise ValueError(
                    f"hash mismatch for {skill_name}/{file_info.path}: manifest "
                    f"{file_info.hash}, got {actual}. If this is a text file, the "
                    f"server may be newline-translating it; serve it as a binary "
                    f"blob for byte-exact integrity (spec §6)."
                )

        # Create parent directories and write
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_bytes(data)

        # Restore the executable bit when the manifest flags it (spec §6.1)
        if file_info.executable:
            file_path.chmod(file_path.stat().st_mode | 0o111)

    return skill_dir


async def sync_skills(
    client: Client,
    target_dir: str | Path,
    *,
    overwrite: bool = False,
) -> list[Path]:
    """Download all available skills from a server.

    Args:
        client: Connected FastMCP client
        target_dir: Directory where skill folders will be created
        overwrite: If True, overwrite existing files

    Returns:
        List of paths to downloaded skill directories

    Example:
        ```python
        from fastmcp import Client
        from fastmcp.utilities.skills import sync_skills

        async with Client("http://skills-server/mcp") as client:
            paths = await sync_skills(client, "~/.claude/skills")
            print(f"Downloaded {len(paths)} skills")
        ```
    """
    skills = await list_skills(client)
    downloaded = []

    for skill in skills:
        try:
            path = await download_skill(
                client, skill.name, target_dir, overwrite=overwrite
            )
            downloaded.append(path)
        except FileExistsError:
            # Skip existing skills when not overwriting
            continue

    return downloaded

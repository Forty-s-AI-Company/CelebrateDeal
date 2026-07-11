from __future__ import annotations

import fnmatch
import hashlib
import os
import re
import subprocess
from pathlib import Path
from typing import Any, Iterable

from adapters.base_adapter import DEFAULT_ENV_ALLOWLIST


def normalize_repo_path(value: str) -> str:
    normalized = value.replace("\\", "/").strip().removeprefix("./")
    if not normalized or normalized.startswith("/") or re.match(r"^[A-Za-z]:", normalized):
        raise ValueError(f"Absolute or empty repository path is forbidden: {value}")
    parts = normalized.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        raise ValueError(f"Repository path traversal is forbidden: {value}")
    return normalized


def path_matches(path: str, pattern: str) -> bool:
    path = normalize_repo_path(path)
    pattern = pattern.replace("\\", "/").strip().removeprefix("./")
    if pattern.endswith("/**"):
        prefix = pattern[:-3].rstrip("/")
        return path == prefix or path.startswith(prefix + "/")
    return fnmatch.fnmatchcase(path, pattern)


def assert_path_contained(root: Path, relative: str) -> None:
    normalized = normalize_repo_path(relative)
    resolved_root = root.resolve()
    resolved = (resolved_root / normalized).resolve(strict=False)
    if resolved != resolved_root and resolved_root not in resolved.parents:
        raise ValueError(f"Repository path escaped workspace: {relative}")


def assert_write_scope(
    root: Path,
    manifest: dict[str, Any],
    changed_paths: Iterable[str],
    task_write_paths: Iterable[str] | None = None,
) -> list[str]:
    role_patterns = [str(item) for item in manifest.get("write_paths", [])]
    forbidden = [str(item) for item in manifest.get("forbidden_paths", [])]
    task_patterns = [str(item) for item in task_write_paths] if task_write_paths is not None else None
    checked: list[str] = []
    for raw_path in changed_paths:
        path = normalize_repo_path(raw_path)
        assert_path_contained(root, path)
        if any(path_matches(path, pattern) for pattern in forbidden):
            raise ValueError(f"Changed path is forbidden for role {manifest.get('role_id')}: {path}")
        if not role_patterns or not any(path_matches(path, pattern) for pattern in role_patterns):
            raise ValueError(f"Changed path is outside role write scope: {path}")
        if task_patterns is not None and not any(path_matches(path, pattern) for pattern in task_patterns):
            raise ValueError(f"Changed path is outside task write scope: {path}")
        checked.append(path)
    return sorted(checked)


def _safe_env() -> dict[str, str]:
    return {key: value for key, value in os.environ.items() if key.upper() in DEFAULT_ENV_ALLOWLIST}


def workspace_snapshot(root: Path) -> dict[str, str]:
    completed = subprocess.run(
        ["git", "ls-files", "-m", "-o", "-d", "--exclude-standard", "-z"],
        cwd=root, capture_output=True, check=True, env=_safe_env(), shell=False,
    )
    snapshot: dict[str, str] = {}
    for raw_path in completed.stdout.decode("utf-8", errors="replace").split("\0"):
        if not raw_path:
            continue
        path = normalize_repo_path(raw_path)
        assert_path_contained(root, path)
        absolute = root / path
        snapshot[path] = hashlib.sha256(absolute.read_bytes()).hexdigest() if absolute.is_file() else "[deleted]"
    excluded_directories = {".git", ".next", ".worktrees", "node_modules", "playwright-report", "test-results", "__pycache__"}
    for directory, directory_names, file_names in os.walk(root):
        directory_names[:] = [name for name in directory_names if name not in excluded_directories]
        for file_name in file_names:
            lowered = file_name.lower()
            if not (lowered.startswith(".env") or lowered in {"cookies.txt", ".npmrc", ".pypirc"} or lowered.endswith((".pem", ".key"))):
                continue
            absolute = Path(directory) / file_name
            relative = normalize_repo_path(str(absolute.relative_to(root)))
            snapshot[relative] = hashlib.sha256(absolute.read_bytes()).hexdigest()
    for relative in [".git/HEAD", ".git/config"]:
        absolute = root / relative
        if absolute.is_file():
            snapshot[relative] = hashlib.sha256(absolute.read_bytes()).hexdigest()
    return snapshot


def changed_since(before: dict[str, str], after: dict[str, str]) -> list[str]:
    return sorted(path for path in set(before) | set(after) if before.get(path) != after.get(path))

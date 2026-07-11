from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, Callable

from adapters.base_adapter import DEFAULT_ENV_ALLOWLIST, redact


SAFE_DOMAINS = {"automation", "docs", "test", "release"}
HIGH_RISK_PATHS = (
    "prisma/", "src/lib/auth", "src/lib/payment", "src/lib/billing",
    "src/app/api/webhooks/", "src/app/admin/billing/",
    ".github/", ".agents/", ".codex/", "automation/", "scripts/",
    "package.json", "package-lock.json", ".env",
)
DOMAIN_ROUTES = {
    "automation": "test",
    "docs": "release",
    "test": "test",
    "release": "release",
}


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _safe_env() -> dict[str, str]:
    import os

    return {key: value for key, value in os.environ.items() if key.upper() in DEFAULT_ENV_ALLOWLIST}


def _run(root: Path, command: list[str], timeout: int = 900) -> dict[str, Any]:
    completed = subprocess.run(
        command, cwd=root, text=True, capture_output=True, timeout=timeout,
        shell=False, env=_safe_env(), encoding="utf-8", errors="replace",
    )
    return {
        "command": command,
        "status": "passed" if completed.returncode == 0 else "failed",
        "exitCode": completed.returncode,
        "stdout": redact(completed.stdout[-4000:]),
        "stderr": redact(completed.stderr[-4000:]),
    }


def baseline(root: Path) -> dict[str, Any]:
    status = _run(root, ["git", "status", "--short"])
    diff = subprocess.run(["git", "diff", "--binary", "HEAD"], cwd=root, capture_output=True, check=True, shell=False, env=_safe_env())
    untracked = _run(root, ["git", "ls-files", "-o", "--exclude-standard"])
    digest = hashlib.sha256()
    digest.update(len(diff.stdout).to_bytes(8, "big"))
    digest.update(diff.stdout)
    for relative in sorted(path for path in untracked.get("stdout", "").splitlines() if path):
        normalized = relative.replace("\\", "/")
        absolute = root / normalized
        data = absolute.read_bytes() if absolute.is_file() else b"[missing]"
        encoded_path = normalized.encode("utf-8")
        digest.update(len(encoded_path).to_bytes(4, "big"))
        digest.update(encoded_path)
        digest.update(len(data).to_bytes(8, "big"))
        digest.update(hashlib.sha256(data).digest())
    return {
        "capturedAt": now(),
        "head": _run(root, ["git", "rev-parse", "HEAD"])["stdout"].strip(),
        "branch": _run(root, ["git", "branch", "--show-current"])["stdout"].strip(),
        "fingerprint": digest.hexdigest(),
        "status": status.get("stdout", "").splitlines(),
        "untracked": untracked.get("stdout", "").splitlines(),
    }


def discover(root: Path, run_quality: bool = False, runner: Callable[[Path, list[str], int], dict[str, Any]] = _run) -> dict[str, Any]:
    snapshot = baseline(root)
    npm = "npm.cmd" if os.name == "nt" else "npm"
    commands = {
        "secret-scan": [npm, "run", "security:secrets"],
        "ai-validate": [npm, "run", "ai:validate"],
        "automation-test": [npm, "run", "automation:test"],
    }
    if run_quality:
        commands.update({
            "lint": [npm, "run", "lint"],
            "typecheck": [npm, "run", "typecheck"],
            "test": [npm, "run", "test"],
            "build": [npm, "run", "build"],
            "preflight": [npm, "run", "preflight"],
        })
    checks = {name: runner(root, command, 900) for name, command in commands.items()}
    issues: list[dict[str, Any]] = []
    for name, result in checks.items():
        if result.get("status") == "passed":
            continue
        issues.append({
            "id": f"DISC-{name.upper().replace('-', '_')}",
            "title": f"Discovery check failed: {name}",
            "description": str(result.get("stderr") or result.get("stdout") or "check failed")[:2000],
            "severity": "P1" if name in {"secret-scan", "typecheck", "test", "build"} else "P2",
            "domain": "test",
            "affectedFiles": [],
            "evidence": [f"command:{' '.join(result.get('command', []))}"],
            "reproduction": [" ".join(result.get("command", []))],
            "proposedFix": "Inspect the failing deterministic check and create a scoped repair task.",
            "requiredRoles": [],
            "validationCommands": [],
            "dependencies": [],
            "autoExecuteEligibility": False,
        })
    todo_lines: list[str] = []
    ripgrep = shutil.which("rg", path=_safe_env().get("PATH"))
    if ripgrep:
        todo = subprocess.run(
            [ripgrep, "-n", "TODO|FIXME", "automation", "docs/ai-team"], cwd=root,
            text=True, capture_output=True, shell=False, env=_safe_env(), encoding="utf-8", errors="replace",
        )
        todo_lines = [line for line in todo.stdout.splitlines() if line.strip()]
    payload = {
        "schemaVersion": 1,
        "generatedAt": now(),
        "baseline": snapshot,
        "checks": checks,
        "todoCount": len(todo_lines),
        "issues": issues,
        "counts": {severity: len([issue for issue in issues if issue["severity"] == severity]) for severity in ("P0", "P1", "P2", "P3")},
    }
    return payload


def _clean_text(value: object, limit: int = 4000) -> str:
    text = "".join(character for character in str(value or "") if character in "\n\t" or ord(character) >= 32)
    return text[:limit]


def triage(discovery: dict[str, Any]) -> dict[str, Any]:
    candidates: list[dict[str, Any]] = []
    for index, raw in enumerate(discovery.get("issues", [])):
        if not isinstance(raw, dict):
            continue
        domain = str(raw.get("domain") or "test").lower()
        if domain not in SAFE_DOMAINS:
            domain = "test"
        severity = str(raw.get("severity") or "P2").upper()
        if severity not in {"P0", "P1", "P2", "P3"}:
            severity = "P2"
        affected = [str(path).replace("\\", "/") for path in raw.get("affectedFiles", []) if isinstance(path, str)]
        high_risk = any(path.startswith(HIGH_RISK_PATHS) for path in affected)
        auto_execute = severity in {"P2", "P3"} and domain in SAFE_DOMAINS and not high_risk
        issue_id = re.sub(r"[^A-Za-z0-9_-]+", "-", str(raw.get("id") or f"AUTO-{index + 1:03d}"))[:80]
        candidates.append({
            "id": issue_id,
            "title": _clean_text(raw.get("title") or issue_id, 300),
            "description": _clean_text(raw.get("description")),
            "priority": severity,
            "type": DOMAIN_ROUTES[domain],
            "status": "ready" if auto_execute else "awaiting-human-approval",
            "source": "autonomous-discovery",
            "affected_files": affected,
            "write_paths": affected,
            "validation": ["npm run automation:test", "npm run ai:validate"],
            "manual_merge_required": high_risk or severity in {"P0", "P1"},
            "auto_execute": auto_execute,
            "ignored_control_fields": sorted(set(raw) & {"provider", "role", "model", "command", "write_paths", "validation"}),
        })
    return {"schemaVersion": 1, "generatedAt": now(), "source": "reports/ai-team/discovered-issues.json", "tasks": candidates}


def markdown_report(payload: dict[str, Any]) -> str:
    lines = [
        "# AI Team Discovery Report", "",
        f"Generated: `{payload.get('generatedAt')}`",
        f"Baseline: `{payload.get('baseline', {}).get('fingerprint')}`",
        f"Issues: `{len(payload.get('issues', []))}`", "",
    ]
    for issue in payload.get("issues", []):
        lines.append(f"- `{issue.get('severity')}` {issue.get('id')}: {issue.get('title')}")
    if not payload.get("issues"):
        lines.append("- No deterministic discovery failures were found.")
    return "\n".join(lines) + "\n"

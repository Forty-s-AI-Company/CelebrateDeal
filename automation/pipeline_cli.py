from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path
from typing import Any

from adapters import AdapterRequest, AntigravityAdapter, CodexAdapter
from adapters.base_adapter import BaseAdapter, redact
from routing import assert_acyclic, build_role_dag, enabled_roles, validate_stage_graph
from policy import assert_write_scope, changed_since, workspace_snapshot
from pipeline_engine import (
    atomic_compare_and_swap,
    build_receipt,
    complete_stage,
    pipeline_digest,
    ready_stage_ids,
    start_stage,
    validate_pipeline_state,
    validate_release_evidence,
    sign_payload,
    verify_attestation,
)


ROOT = Path(__file__).resolve().parents[1]
AUTOMATION = ROOT / "automation"
REPORTS = ROOT / "reports" / "ai-team"
RUNTIME = REPORTS / "runtime"
PIPELINE_STATE = AUTOMATION / "pipeline-state.json"
TASK_STATE = AUTOMATION / "task-state.json"
ROLE_REGISTRY = AUTOMATION / "role-registry.yaml"
CONFIG = AUTOMATION / "team-config.yaml"
QA_SEARCH_PATHS = [
    ROOT / "reports" / "antigravity" / "QA_LATEST.md",
    ROOT / "reports" / "antigravity" / "qa-issues.json",
    ROOT / "qa-issues.json",
]
QA_DISCOVERY_PATHS = [
    *QA_SEARCH_PATHS,
    ROOT / "reports" / "antigravity" / "CODEX_REPAIR_PROMPT.md",
    ROOT / "docs" / "qa" / "ANTIGRAVITY_QA_HANDOFF.md",
]
SEVERITY_ORDER = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}
TRUST_MANIFEST_PATH = "automation/trust-manifest.json"


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def workspace_fingerprint() -> str:
    digest = hashlib.sha256()
    diff = subprocess.run([
        "git", "diff", "--binary", "HEAD", "--", ".",
        ":(exclude)automation/pipeline-state.json", ":(exclude)automation/task-state.json",
        ":(exclude)reports/ai-team/runtime/**", ":(exclude)reports/ai-team/PIPELINE_STATUS.*",
        ":(exclude)reports/ai-team/NEXT_ACTION.*", ":(exclude)automation/logs/**", ":(exclude)automation/reports/**",
    ], cwd=ROOT, capture_output=True, check=True, shell=False)
    digest.update(diff.stdout)
    untracked = subprocess.run(["git", "ls-files", "-o", "--exclude-standard", "-z"], cwd=ROOT, capture_output=True, check=True, shell=False)
    for raw_path in sorted(path for path in untracked.stdout.decode("utf-8", errors="replace").split("\0") if path):
        normalized = raw_path.replace("\\", "/")
        if normalized in {
            "automation/pipeline-state.json", "automation/task-state.json",
            "reports/ai-team/PIPELINE_STATUS.json", "reports/ai-team/PIPELINE_STATUS.md",
            "reports/ai-team/NEXT_ACTION.json", "reports/ai-team/NEXT_ACTION.md",
        } or normalized.startswith(("reports/ai-team/runtime/", "automation/logs/", "automation/reports/")):
            continue
        path = ROOT / raw_path
        if path.is_file():
            digest.update(normalized.encode("utf-8"))
            digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()


def expand_trust_paths(root: Path, manifest: dict[str, Any]) -> set[str]:
    excluded = [str(value).replace("\\", "/") for value in manifest.get("excluded", [])]

    def is_excluded(relative: str) -> bool:
        return any(relative == prefix.rstrip("/") or relative.startswith(prefix) or f"/{prefix}" in relative for prefix in excluded)

    paths = {TRUST_MANIFEST_PATH, *[str(value) for value in manifest.get("files", [])]}
    for root_name in manifest.get("roots", []):
        trust_root = root / str(root_name)
        if trust_root.is_dir():
            paths.update(
                str(path.relative_to(root)).replace("\\", "/")
                for path in trust_root.rglob("*") if path.is_file()
                and not is_excluded(str(path.relative_to(root)).replace("\\", "/"))
            )
    return {path for path in paths if not is_excluded(path)}


def coordinator_trust_status(source_revision: str) -> tuple[bool, list[str]]:
    reasons: list[str] = []
    committed_manifest = subprocess.run(
        ["git", "show", f"{source_revision}:{TRUST_MANIFEST_PATH}"], cwd=ROOT, capture_output=True, shell=False,
    )
    if committed_manifest.returncode != 0:
        return False, [f"untracked:{TRUST_MANIFEST_PATH}"]
    current_manifest = ROOT / TRUST_MANIFEST_PATH
    manifest_oid = subprocess.run(
        ["git", "rev-parse", f"{source_revision}:{TRUST_MANIFEST_PATH}"], cwd=ROOT, capture_output=True, text=True, shell=False,
    )
    working_manifest_oid = subprocess.run(
        ["git", "hash-object", "--filters", f"--path={TRUST_MANIFEST_PATH}", TRUST_MANIFEST_PATH],
        cwd=ROOT, capture_output=True, text=True, shell=False,
    )
    if not current_manifest.is_file() or manifest_oid.stdout.strip() != working_manifest_oid.stdout.strip():
        return False, [f"modified:{TRUST_MANIFEST_PATH}"]
    try:
        manifest = json.loads(committed_manifest.stdout)
    except json.JSONDecodeError:
        return False, [f"invalid:{TRUST_MANIFEST_PATH}"]
    if manifest.get("schemaVersion") != 1:
        return False, [f"unsupported:{TRUST_MANIFEST_PATH}"]
    excluded = [str(value).replace("\\", "/") for value in manifest.get("excluded", [])]

    def is_excluded(relative: str) -> bool:
        return any(relative == prefix.rstrip("/") or relative.startswith(prefix) or f"/{prefix}" in relative for prefix in excluded)

    paths = expand_trust_paths(ROOT, manifest)
    for root_name in manifest.get("roots", []):
        root_name = str(root_name).replace("\\", "/").rstrip("/")
        current_root = ROOT / root_name
        if not current_root.is_dir():
            reasons.append(f"missing-root:{root_name}")
            continue
        current_files = {
            str(path.relative_to(ROOT)).replace("\\", "/")
            for path in current_root.rglob("*") if path.is_file()
            and not is_excluded(str(path.relative_to(ROOT)).replace("\\", "/"))
        }
        committed = subprocess.run(
            ["git", "ls-tree", "-r", "--name-only", source_revision, "--", root_name],
            cwd=ROOT, capture_output=True, text=True, shell=False,
        )
        committed_files = {line.strip().replace("\\", "/") for line in committed.stdout.splitlines() if line.strip() and not is_excluded(line.strip())}
        for extra in sorted(current_files - committed_files):
            reasons.append(f"untracked:{extra}")
        for missing in sorted(committed_files - current_files):
            reasons.append(f"missing:{missing}")
        paths.update(current_files | committed_files)
    for relative in sorted(paths):
        if is_excluded(relative):
            continue
        exists = subprocess.run(["git", "cat-file", "-e", f"{source_revision}:{relative}"], cwd=ROOT, capture_output=True, shell=False)
        if exists.returncode != 0:
            reasons.append(f"untracked:{relative}")
            continue
        current = ROOT / relative
        if not current.is_file():
            reasons.append(f"missing:{relative}")
            continue
        committed_oid = subprocess.run(
            ["git", "rev-parse", f"{source_revision}:{relative}"], cwd=ROOT, capture_output=True, text=True, check=True, shell=False,
        ).stdout.strip()
        working_oid = subprocess.run(
            ["git", "hash-object", "--filters", f"--path={relative}", relative],
            cwd=ROOT, capture_output=True, text=True, shell=False,
        ).stdout.strip()
        if committed_oid != working_oid:
            reasons.append(f"modified:{relative}")
    return not reasons, sorted(set(reasons))[:20]


def load_object(path: Path, default: dict[str, Any] | None = None) -> dict[str, Any]:
    if not path.exists():
        return dict(default or {})
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Expected JSON object: {path}")
    return value


def atomic_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False, suffix=".tmp") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        temporary = Path(handle.name)
    os.replace(temporary, path)


def write_text(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value.rstrip() + "\n", encoding="utf-8")


def command_result(command: list[str], timeout: int = 30) -> dict[str, Any]:
    started = now()
    try:
        result = subprocess.run(
            command, cwd=ROOT, text=True, capture_output=True, timeout=timeout, shell=False,
            env=BaseAdapter().safe_environment({}), encoding="utf-8", errors="replace",
        )
        return {
            "command": command, "status": "passed" if result.returncode == 0 else "failed",
            "exitCode": result.returncode, "stdout": redact(result.stdout[-8000:]), "stderr": redact(result.stderr[-8000:]),
            "startedAt": started, "finishedAt": now(),
        }
    except (OSError, subprocess.TimeoutExpired) as error:
        return {"command": command, "status": "failed", "exitCode": None, "stdout": "", "stderr": str(error), "startedAt": started, "finishedAt": now()}


def capabilities() -> dict[str, Any]:
    return {
        "generatedAt": now(),
        "codex": CodexAdapter().capability().to_dict(),
        "antigravity": AntigravityAdapter().capability().to_dict(),
    }


def persist_capability_report(payload: dict[str, Any]) -> None:
    atomic_json(REPORTS / "runtime" / "cli-capabilities.json", payload)
    lines = ["# CLI Capability Report", "", f"Generated: `{payload['generatedAt']}`", ""]
    for provider in ("codex", "antigravity"):
        item = payload[provider]
        lines.extend([
            f"## {provider.title()}", "",
            f"- Available: `{item['available']}`", f"- Mode: `{item['mode']}`",
            f"- Executable: `{item.get('executable') or 'not found'}`",
            f"- Version: `{item.get('version') or 'not reported'}`",
            f"- Features: `{', '.join(item.get('features', [])) or 'none'}`",
            f"- Models: `{', '.join(item.get('models', [])) or 'not enumerated by CLI'}`", "",
        ])
    text = "\n".join(lines)
    write_text(REPORTS / "CLI_CAPABILITY_REPORT.md", text)
    write_text(ROOT / "docs" / "ai-team" / "CLI_CAPABILITY_REPORT.md", text)


def doctor(_: argparse.Namespace) -> int:
    payload = capabilities()
    payload["configuration"] = {
        "teamConfig": CONFIG.exists(), "roleRegistry": ROLE_REGISTRY.exists(),
        "pipelineState": PIPELINE_STATE.exists(), "taskState": TASK_STATE.exists(),
    }
    codex_executable = payload["codex"].get("executable")
    payload["checks"] = {
        "python": command_result([sys.executable, "--version"]),
        "git": command_result(["git", "--version"]),
        "codexDoctor": command_result([str(codex_executable), "doctor", "--json"], timeout=45) if codex_executable else {"status": "unsupported"},
    }
    persist_capability_report(payload)
    atomic_json(REPORTS / "runtime" / "doctor.json", payload)
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0 if payload["codex"]["available"] else 1


def inspect(_: argparse.Namespace) -> int:
    git_status = command_result(["git", "status", "--short"])
    files = {
        "codexAgents": len(list((ROOT / ".codex" / "agents").glob("*.toml"))),
        "skills": len(list((ROOT / ".agents" / "skills").glob("*/SKILL.md"))),
        "qaSources": [str(path.relative_to(ROOT)) for path in QA_SEARCH_PATHS if path.exists()],
        "automationFiles": len([path for path in AUTOMATION.rglob("*") if path.is_file() and "__pycache__" not in path.parts]),
    }
    payload = {"generatedAt": now(), "git": git_status, "inventory": files, "capabilities": capabilities()}
    atomic_json(REPORTS / "runtime" / "inspect.json", payload)
    write_text(REPORTS / "DUAL_CLI_UPGRADE_REPORT.md", "# Dual CLI Current State\n\n```json\n" + json.dumps(payload, ensure_ascii=False, indent=2) + "\n```")
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


def role(role_id: str) -> dict[str, Any]:
    item = enabled_roles().get(role_id)
    if item is None:
        raise ValueError(f"Unknown or disabled role: {role_id}")
    return item


def run_role(role_id: str, prompt: str, timeout: int = 120):
    item = role(role_id)
    provider = item.get("provider", "codex")
    adapters = {"codex": CodexAdapter, "antigravity": AntigravityAdapter}
    adapter_type = adapters.get(str(provider))
    if adapter_type is None:
        raise ValueError(f"Unknown role provider: {provider}")
    adapter = adapter_type()
    model_value = item.get("requested_model", item.get("model", "gpt-5.4"))
    model = str(model_value.get("requested", "gpt-5.4") if isinstance(model_value, dict) else model_value)
    available_models = adapter.capability().models
    fallback_reason = None
    if provider == "antigravity" and available_models and model not in available_models:
        fallback_reason = f"Requested model unavailable; selected {available_models[0]}"
        model = available_models[0]
    request = AdapterRequest(
        role_id=role_id, prompt=prompt, workdir=ROOT, requested_model=model,
        requested_reasoning=str(item.get("reasoning", item.get("requested_reasoning", "medium"))),
        timeout_seconds=timeout, sandbox="read-only",
        output_schema=AUTOMATION / "schemas" / "role-output.schema.json" if provider == "codex" else None,
    )
    attempt_evidence: list[dict[str, Any]] = []

    def execute_attempt() -> tuple[dict[str, Any], bool]:
        before = workspace_snapshot(ROOT)
        attempt_result = adapter.run(request).to_dict()
        after = workspace_snapshot(ROOT)
        changed_paths = changed_since(before, after)
        policy_violation = False
        try:
            assert_write_scope(ROOT, item, changed_paths, [] if request.sandbox == "read-only" else None)
        except ValueError as error:
            attempt_result["status"] = "failed"
            attempt_result["error"] = str(error)
            attempt_result["risk"] = "high"
            policy_violation = True
        attempt_result["workspace_changes"] = changed_paths
        attempt_evidence.append({
            "requested_model": request.requested_model,
            "status": attempt_result.get("status"),
            "workspace_changes": changed_paths,
            "policy_violation": policy_violation,
            "error": attempt_result.get("error"),
        })
        return attempt_result, policy_violation

    result, policy_violation = execute_attempt()
    result["configuredRequestedModel"] = item.get("requested_model", item.get("model"))
    if fallback_reason:
        result["fallback_reason"] = fallback_reason
    failure_text = (str(result.get("stderr", "")) + "\n" + str(result.get("stdout", ""))).lower()
    model_failure = any(marker in failure_text for marker in [
        "requires a newer version of codex", "unsupported model", "model_not_found",
        "unknown model", "model is not available", "unknown variant `max`",
    ])
    if not policy_violation and result["status"] == "failed" and provider == "codex" and model != "gpt-5.4" and model_failure:
        request.requested_model = "gpt-5.4"
        fallback, _ = execute_attempt()
        fallback["configuredRequestedModel"] = item.get("requested_model", item.get("model"))
        fallback["fallback_reason"] = "Configured model failed in installed Codex CLI; retried with gpt-5.4"
        result = fallback
    result["attempt_evidence"] = attempt_evidence
    result["workspace_changes"] = sorted({path for attempt in attempt_evidence for path in attempt["workspace_changes"]})
    return result


def smoke_codex(_: argparse.Namespace) -> int:
    result = run_role("ai-team-orchestrator", 'Inspect AGENTS.md only. Return {"status":"passed","summary":"...","findings":[],"actual_model":"..."}. Do not modify files.', 180)
    atomic_json(RUNTIME / "smoke-codex.json", result)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["status"] == "passed" else 1


def smoke_antigravity(_: argparse.Namespace) -> int:
    primary = run_role("browser-qa-engineer", 'Inspect docs/qa/TEST_MATRIX.md only. Return {"status":"passed","summary":"read-only QA smoke","findings":[],"actual_model":"Gemini 3.5 Flash (High)"}. Do not modify files.', 45)
    payload: dict[str, Any] = primary
    if primary["status"] != "passed":
        fallback = run_role("test-engineer", 'Act as the codex-fallback browser QA role. Inspect docs/qa/TEST_MATRIX.md only and return JSON with status, summary, findings and actual_model. Do not modify files.', 180)
        fallback_status = "fallback-passed" if fallback["status"] == "passed" else "fallback-conditional" if fallback["status"] == "conditional" else "failed"
        payload = {"status": fallback_status, "mode": "codex-fallback", "provider_requirement_satisfied": False, "capability_equivalent": False, "antigravity": primary, "fallback": fallback}
    atomic_json(RUNTIME / "smoke-antigravity.json", payload)
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0 if payload["status"] == "passed" else 2 if payload["status"].startswith("fallback-") else 1


def smoke_handoff(_: argparse.Namespace) -> int:
    codex_smoke = load_object(RUNTIME / "smoke-codex.json", {"status": "not-run"})
    antigravity_smoke = load_object(RUNTIME / "smoke-antigravity.json", {"status": "not-run"})
    dag = build_role_dag(load_object(CONFIG), {"id": "HANDOFF-SMOKE", "type": "backend"})
    assert_acyclic(dag)
    chain = [{**stage.to_dict(), "status": "planned"} for stage in dag.stages]
    codex_ready = codex_smoke.get("status") == "passed"
    antigravity_ready = antigravity_smoke.get("status") == "passed"
    payload = {
        "generatedAt": now(), "test_status": "passed" if codex_ready and chain else "failed",
        "handoff_status": "ready" if codex_ready and antigravity_ready else "blocked",
        "mode": "full-auto" if antigravity_ready else "hybrid",
        "actualProviderEvidence": {"codex": str((RUNTIME / 'smoke-codex.json').relative_to(ROOT)), "antigravity": str((RUNTIME / 'smoke-antigravity.json').relative_to(ROOT))},
        "chain": chain,
        "note": "This smoke validates compiled handoff contracts and provider evidence. Planned roles are not reported as executed. Codex fallback cannot satisfy provider-specific Antigravity QA.",
    }
    atomic_json(RUNTIME / "role-handoff-smoke.json", payload)
    lines = ["# Role Handoff Smoke Test", "", f"- Test status: `{payload['test_status']}`", f"- Handoff status: `{payload['handoff_status']}`", f"- Mode: `{payload['mode']}`", ""]
    lines.extend(f"- `{item['stage_id']}` → `{item['role_id']}` via `{item['provider']}`: `{item['status']}`" for item in chain)
    write_text(REPORTS / "ROLE_HANDOFF_SMOKE_TEST.md", "\n".join(lines))
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0 if payload["test_status"] == "passed" and payload["handoff_status"] == "ready" else 2 if payload["test_status"] == "passed" else 1


def normalize_issue(issue: dict[str, Any], source: Path, index: int) -> dict[str, Any]:
    raw_issue_id = str(issue.get("issue_id") or issue.get("id") or f"QA-{index + 1:03d}")
    issue_id = re.sub(r"[^A-Za-z0-9_-]+", "-", raw_issue_id).strip("-_")[:80] or f"QA-{index + 1:03d}"
    severity = str(issue.get("severity") or issue.get("priority") or "P2").upper()
    if severity not in SEVERITY_ORDER:
        severity = "P2"
    affected = issue.get("affected_paths") or issue.get("suspected_files") or issue.get("page") or []
    if isinstance(affected, str):
        affected = [part.strip() for part in affected.split(",") if part.strip()]
    repro = issue.get("reproduction") or issue.get("reproduction_steps") or []
    if isinstance(repro, str):
        repro = [line.strip() for line in repro.splitlines() if line.strip()]
    return {
        "issue_id": issue_id, "severity": severity,
        "domain": str(issue.get("domain") or issue.get("category") or issue.get("type") or "qa"),
        "title": str(issue.get("title") or issue_id)[:300],
        "description": str(issue.get("description") or issue.get("actual") or "")[:6000],
        "reproduction": repro, "expected": str(issue.get("expected") or ""), "actual": str(issue.get("actual") or ""),
        "evidence": [value for value in [issue.get("screenshot"), issue.get("console_error"), issue.get("network_evidence")] if value and str(value).lower() != "none"],
        "affected_paths": affected, "assigned_role": "repair-engineer",
        "reviewer": "code-reviewer", "qa_role": "regression-verifier",
        "status": "unreviewed", "source_status": str(issue.get("status") or "open"), "dependencies": [],
        "regression_tests": issue.get("regression_tests") or issue.get("regression_tests_needed") or [],
        "risk": severity, "source": str(source.relative_to(ROOT)), "untrusted": True,
        "ignored_control_fields": sorted(set(issue) & {
            "prompt", "validation", "provider", "model", "assigned_role", "reviewer", "qa_role",
            "dependencies", "handoff", "write_paths", "allow_supply_chain_changes", "mode", "required",
            "fallback_policy", "artifactPaths", "productionApproved", "externalRequired",
        }),
    }


def import_files(paths: list[Path], persist: bool = True) -> dict[str, Any]:
    normalized: dict[str, dict[str, Any]] = {}
    sources: list[str] = []
    for path in paths:
        if not path.exists():
            continue
        if path.suffix.lower() == ".md" and path.name == "QA_LATEST.md":
            text = path.read_text(encoding="utf-8")
            current_severity = "P2"
            index = 0
            for line in text.splitlines():
                severity_match = re.match(r"^##\s+(P[0-3])\s*$", line.strip())
                if severity_match:
                    current_severity = severity_match.group(1)
                issue_match = re.search(r"Issue ID\*\*:\s*([A-Za-z0-9_-]+)", line)
                if issue_match:
                    item = normalize_issue({"id": issue_match.group(1), "severity": current_severity, "description": "Imported from Antigravity QA markdown; structured JSON takes precedence when present."}, path, index)
                    normalized[item["issue_id"]] = item
                    index += 1
            sources.append(str(path.relative_to(ROOT)))
            continue
        if path.suffix.lower() != ".json":
            continue
        payload = json.loads(path.read_text(encoding="utf-8"))
        issues = payload if isinstance(payload, list) else payload.get("issues", [])
        if not isinstance(issues, list):
            continue
        sources.append(str(path.relative_to(ROOT)))
        for index, issue in enumerate(issues):
            if isinstance(issue, dict):
                item = normalize_issue(issue, path, index)
                existing = normalized.get(item["issue_id"])
                if existing:
                    winner = item if SEVERITY_ORDER[item["severity"]] < SEVERITY_ORDER[existing["severity"]] else existing
                    winner = dict(winner)
                    winner["severity"] = min([existing["severity"], item["severity"]], key=SEVERITY_ORDER.__getitem__)
                    winner["risk"] = winner["severity"]
                    winner["evidence"] = list(dict.fromkeys([*existing.get("evidence", []), *item.get("evidence", [])]))
                    winner["ignored_control_fields"] = sorted(set(existing.get("ignored_control_fields", [])) | set(item.get("ignored_control_fields", [])))
                    normalized[item["issue_id"]] = winner
                else:
                    normalized[item["issue_id"]] = item
    ordered = sorted(normalized.values(), key=lambda item: (SEVERITY_ORDER[item["severity"]], item["issue_id"]))
    payload = {"schemaVersion": 1, "generatedAt": now(), "sources": sources, "discoveredArtifacts": [str(path.relative_to(ROOT)) for path in QA_DISCOVERY_PATHS if path.exists()], "issues": ordered, "counts": {severity: sum(i["severity"] == severity for i in ordered) for severity in SEVERITY_ORDER}}
    if persist:
        atomic_json(REPORTS / "normalized-qa-issues.json", payload)
        write_text(REPORTS / "QA_IMPORT_REPORT.md", "# QA Import Report\n\n" + "\n".join([f"- Sources: `{len(sources)}`", f"- Issues: `{len(ordered)}`", *[f"- {key}: `{value}`" for key, value in payload["counts"].items()]]))
    return payload


def import_qa(args: argparse.Namespace) -> int:
    paths = [Path(args.file).resolve()] if getattr(args, "file", None) else QA_SEARCH_PATHS
    payload = import_files(paths)
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


def plan_pipeline(args: argparse.Namespace) -> int:
    pipeline_name = getattr(args, "pipeline", None) or "repair"
    task_id = getattr(args, "task_id", None)
    dynamic_dag = None
    if task_id:
        backlog = load_object(AUTOMATION / "backlog.json", {"tasks": []})
        task = next((item for item in backlog.get("tasks", []) if isinstance(item, dict) and item.get("id") == task_id), None)
        if not task:
            raise ValueError(f"Trusted backlog task not found: {task_id}")
        dynamic_dag = build_role_dag(load_object(CONFIG), task)
        assert_acyclic(dynamic_dag)
    definition_path = AUTOMATION / "pipelines" / f"{pipeline_name}.pipeline.json"
    if not definition_path.exists():
        definition_path = AUTOMATION / "pipelines" / f"{pipeline_name}.yaml"
    definition = load_object(definition_path, {"pipeline_id": pipeline_name, "stages": []})
    stages = definition.get("stages", [])
    if dynamic_dag:
        stages = [
            {
                "id": stage.stage_id, "role": stage.role_id, "provider": stage.provider,
                "mode": stage.mode, "dependsOn": list(stage.depends_on), "required": stage.required,
            }
            for stage in dynamic_dag.stages
        ]
    if not isinstance(stages, list) or not all(isinstance(stage, dict) for stage in stages):
        raise ValueError("Pipeline stages must be an object array")
    validate_stage_graph(stages)
    antigravity_runtime = load_object(RUNTIME / "smoke-antigravity.json", {})
    operational_mode = "full-auto" if antigravity_runtime.get("status") == "passed" else "hybrid"
    compiled_stages = []
    for stage in stages:
        role_id = str(stage.get("role") or "")
        manifest = role(role_id)
        provider = str(stage.get("provider") or manifest["provider"])
        if provider != manifest["provider"]:
            raise ValueError(f"Pipeline provider does not match role manifest: {role_id}")
        write_paths = manifest.get("write_paths", [])
        stage_mode = str(stage.get("mode") or ("workspace-write" if provider == "codex" and write_paths else "read-only"))
        compiled_stages.append({
            "stageId": stage.get("stage_id") or stage.get("id"), "roleId": role_id,
            "provider": provider, "mode": stage_mode, "required": stage.get("required", True),
            "status": "pending", "attempts": 0,
            "dependsOn": stage.get("depends_on") or stage.get("dependsOn", []),
            "artifactPaths": [], "receipt": None, "error": None,
        })
    source_revision_result = command_result(["git", "rev-parse", "HEAD"])
    source_revision = source_revision_result.get("stdout", "").strip() if source_revision_result.get("status") == "passed" else "unavailable"
    coordinator_trusted, trust_reasons = coordinator_trust_status(source_revision)
    if not coordinator_trusted:
        raise RuntimeError("Coordinator trust inputs must be committed and clean before plan: " + ", ".join(trust_reasons[:5]))
    state = {
        "schemaVersion": 2, "runId": str(uuid.uuid4()), "revision": 1,
        "pipelineId": f"task:{task_id}" if task_id else definition.get("pipeline_id") or definition.get("id", pipeline_name),
        "sourceRevision": source_revision,
        "sourceFingerprint": workspace_fingerprint(),
        "pipelineDigest": pipeline_digest(compiled_stages),
        "status": "planned", "mode": operational_mode, "currentStage": None,
        "createdAt": now(), "updatedAt": now(), "milestone": getattr(args, "milestone", None),
        "taskId": task_id, "taskType": dynamic_dag.requested_type if dynamic_dag else None,
        "taskDomain": dynamic_dag.domain if dynamic_dag else None,
        "stages": compiled_stages,
    }
    atomic_json(PIPELINE_STATE, state)
    atomic_json(REPORTS / "PIPELINE_STATUS.json", state)
    write_text(REPORTS / "PIPELINE_STATUS.md", "# Pipeline Status\n\n" + f"- Pipeline: `{state['pipelineId']}`\n- Status: `{state['status']}`\n- Mode: `{state['mode']}`")
    update_next_action(state)
    print(json.dumps(state, ensure_ascii=False, indent=2))
    return 0


def update_next_action(state: dict[str, Any]) -> None:
    pending = next((item for item in state.get("stages", []) if item.get("status") == "pending"), None)
    action = pending.get("stageId") if pending else "await-human-approval"
    is_antigravity = bool(pending and pending.get("provider") == "antigravity")
    role_id = str(pending.get("roleId")) if pending and pending.get("roleId") else "ai-team-orchestrator"
    payload = {
        "generatedAt": now(), "provider": "antigravity" if is_antigravity else "codex", "role": role_id,
        "requestedModel": "Gemini 3.5 Flash (High)" if is_antigravity else "gpt-5.6-sol", "reasoning": "high",
        "action": action,
        "scope": "Execute the next safe pipeline stage without production mutation.",
        "tests": ["python automation/test_orchestrator.py", "npm run ai:validate"],
        "successCriteria": ["state persisted", "artifacts redacted", "no production mutation"],
        "humanConfirmationRequired": pending is None or is_antigravity,
        "prompt": f"請從 pipeline `{state.get('pipelineId')}` 的 `{action}` 階段安全續跑，保留 requested/actual model 證據並執行適用測試；若 Antigravity 尚未登入或仍逾時，維持 hybrid/blocked，不得改報為 passed。",
    }
    atomic_json(REPORTS / "NEXT_ACTION.json", payload)
    write_text(REPORTS / "NEXT_ACTION.md", "# Next Action\n\n```markdown\n" + payload["prompt"] + f"\n```\n\n- Provider: `{payload['provider']}`\n- Role: `{payload['role']}`\n- Model: `{payload['requestedModel']}`\n- Reasoning: `high`")


def run_regression(_: argparse.Namespace) -> int:
    scripts = ["automation:test", "ai:validate", "security:secrets", "lint", "typecheck", "test", "build", "preflight"]
    results = [command_result(["npm.cmd" if os.name == "nt" else "npm", "run", script], timeout=900) for script in scripts]
    pipeline = load_object(PIPELINE_STATE, {})
    deterministic_status = "passed" if all(item["status"] == "passed" for item in results) else "failed"
    attestation_key = os.environ.get("AI_PIPELINE_ATTESTATION_KEY")
    coordinator_trusted, trust_reasons = coordinator_trust_status(str(pipeline.get("sourceRevision", "")))
    current_fingerprint = workspace_fingerprint()
    blockers = []
    if not attestation_key:
        blockers.append("attestation:key-unavailable")
    if not coordinator_trusted:
        blockers.append("coordinator:not-tracked-or-modified-at-source-revision")
    if current_fingerprint != pipeline.get("sourceFingerprint"):
        blockers.append("source:worktree-changed-after-plan")
    if deterministic_status != "passed":
        blockers.append("deterministic-regression:failed")
    payload = {
        "generatedAt": now(), "runId": pipeline.get("runId"), "pipelineRevision": pipeline.get("revision"),
        "pipelineDigest": pipeline.get("pipelineDigest"), "sourceRevision": pipeline.get("sourceRevision"),
        "sourceFingerprint": current_fingerprint, "deterministicStatus": deterministic_status,
        "coordinatorTrusted": coordinator_trusted, "coordinatorTrustReasons": trust_reasons,
        "status": "passed" if not blockers else "blocked" if deterministic_status == "passed" else "failed",
        "blockers": blockers, "results": results,
    }
    payload["attestation"] = sign_payload(payload, attestation_key) if payload["status"] == "passed" and attestation_key else None
    atomic_json(RUNTIME / "deterministic-regression.json", payload)
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0 if payload["status"] == "passed" else 2 if payload["status"] == "blocked" else 1


def state_command(args: argparse.Namespace) -> int:
    command = args.command
    if command == "status":
        payload = load_object(PIPELINE_STATE, {"status": "not-planned"})
        atomic_json(REPORTS / "PIPELINE_STATUS.json", payload)
        write_text(REPORTS / "PIPELINE_STATUS.md", "# Pipeline Status\n\n" + f"- Pipeline: `{payload.get('pipelineId')}`\n- Status: `{payload.get('status')}`\n- Mode: `{payload.get('mode')}`\n- Current stage: `{payload.get('currentStage')}`")
        update_next_action(payload)
    elif command == "resume":
        state = load_object(PIPELINE_STATE, {"status": "not-planned"})
        try:
            ready = ready_stage_ids(state)
        except ValueError as error:
            payload = {"status": "blocked", "error": str(error), "generatedAt": now()}
        else:
            if not ready:
                payload = {"status": state.get("status"), "readyStages": [], "generatedAt": now()}
            else:
                stage_id = ready[0]
                stage = next(item for item in state["stages"] if item["stageId"] == stage_id)
                if stage.get("mode") == "workspace-write":
                    state["status"] = "awaiting-human-approval"
                    state["currentStage"] = stage_id
                    state["revision"] += 1
                    state["updatedAt"] = now()
                    atomic_compare_and_swap(PIPELINE_STATE, state["revision"] - 1, state)
                    payload = {"status": "awaiting-human-approval", "stageId": stage_id, "roleId": stage.get("roleId"), "reason": "Workspace-write stages require an approved isolated worktree and task scope.", "generatedAt": now()}
                else:
                    attestation_key = os.environ.get("AI_PIPELINE_ATTESTATION_KEY")
                    if not attestation_key:
                        payload = {"status": "blocked", "stageId": stage_id, "reason": "AI_PIPELINE_ATTESTATION_KEY is required for stage execution receipts", "generatedAt": now()}
                        print(json.dumps(payload, ensure_ascii=False, indent=2))
                        return 2
                    started = start_stage(state, stage_id)
                    started["updatedAt"] = now()
                    atomic_compare_and_swap(PIPELINE_STATE, state["revision"], started)
                    result = run_role(str(stage["roleId"]), f"Execute read-only pipeline stage {stage_id} for trusted task {state.get('taskId') or state.get('pipelineId')}. Return structured status and findings. Do not modify files.")
                    artifact = RUNTIME / f"{state['runId']}-{stage_id}.json"
                    atomic_json(artifact, result)
                    semantic = "completed" if result.get("status") == "passed" else "conditional" if result.get("status") == "conditional" else "failed"
                    receipt = build_receipt(started, stage_id, semantic, [str(artifact.relative_to(ROOT))], ROOT, attestation_key=attestation_key)
                    completed = complete_stage(started, receipt, ROOT, attestation_key)
                    completed["updatedAt"] = now()
                    atomic_compare_and_swap(PIPELINE_STATE, started["revision"], completed)
                    payload = {"status": completed["status"], "stageId": stage_id, "roleId": stage.get("roleId"), "result": result.get("status"), "generatedAt": now()}
    elif command == "release-check":
        regression = load_object(RUNTIME / "deterministic-regression.json", {"status": "not-run"})
        pipeline = load_object(PIPELINE_STATE, {"stages": []})
        issue_payload = load_object(REPORTS / "normalized-qa-issues.json", {"issues": []})
        expected_digest = None
        task_id = pipeline.get("taskId")
        if task_id:
            backlog = load_object(AUTOMATION / "backlog.json", {"tasks": []})
            trusted_task = next((item for item in backlog.get("tasks", []) if isinstance(item, dict) and item.get("id") == task_id), None)
            if trusted_task:
                trusted_dag = build_role_dag(load_object(CONFIG), trusted_task)
                expected_stages = [
                    {
                        "stageId": stage.stage_id, "roleId": stage.role_id, "provider": stage.provider,
                        "mode": stage.mode, "required": stage.required, "dependsOn": list(stage.depends_on),
                    }
                    for stage in trusted_dag.stages
                ]
                expected_digest = pipeline_digest(expected_stages)
        current_revision_result = command_result(["git", "rev-parse", "HEAD"])
        expected_source_revision = current_revision_result.get("stdout", "").strip() if current_revision_result.get("status") == "passed" else None
        expected_source_fingerprint = workspace_fingerprint()
        attestation_key = os.environ.get("AI_PIPELINE_ATTESTATION_KEY")
        coordinator_trusted, trust_reasons = coordinator_trust_status(str(pipeline.get("sourceRevision", "")))
        try:
            evidence_blockers = validate_release_evidence(
                pipeline, ROOT, issue_payload.get("issues", []), expected_digest, expected_source_revision,
                expected_source_fingerprint, attestation_key,
            )
        except ValueError as error:
            evidence_blockers = [f"pipeline-state:{error}"]
        if regression.get("runId") != pipeline.get("runId"):
            evidence_blockers.append("regression:missing-or-stale-run")
        if regression.get("pipelineDigest") != pipeline.get("pipelineDigest") or regression.get("sourceRevision") != pipeline.get("sourceRevision"):
            evidence_blockers.append("regression:unbound-pipeline-or-source")
        if regression.get("pipelineRevision") != pipeline.get("revision") or regression.get("sourceFingerprint") != pipeline.get("sourceFingerprint"):
            evidence_blockers.append("regression:stale-revision-or-worktree")
        if not coordinator_trusted or regression.get("coordinatorTrusted") is not True:
            evidence_blockers.append("coordinator:not-tracked-or-modified-at-source-revision")
            evidence_blockers.extend(f"coordinator:{reason}" for reason in trust_reasons[:3])
        if not verify_attestation(regression, attestation_key):
            evidence_blockers.append("regression:invalid-or-missing-attestation")
        if regression.get("status") != "passed":
            evidence_blockers.append(f"regression:{regression.get('status')}")
        payload = {
            "status": "conditional" if not evidence_blockers and pipeline.get("mode") == "full-auto" else "blocked",
            "runId": pipeline.get("runId"), "localRegression": regression.get("status"), "blockers": sorted(set(evidence_blockers)),
            "externalRequired": True, "productionApproved": False, "generatedAt": now(),
        }
        atomic_json(RUNTIME / "release-check.json", payload)
    elif command in {"full-cycle", "repair-cycle"}:
        namespace = argparse.Namespace(
            pipeline="new-feature" if command == "full-cycle" else "repair",
            milestone=getattr(args, "milestone", None),
        )
        return plan_pipeline(namespace)
    elif command == "repair-qa":
        imported = load_object(REPORTS / "normalized-qa-issues.json", {"issues": []})
        issues = [item for item in imported.get("issues", []) if isinstance(item, dict)]
        if getattr(args, "severity", None):
            issues = [item for item in issues if item.get("severity") == args.severity]
        if getattr(args, "issue", None):
            issues = [item for item in issues if item.get("issue_id") == args.issue]
        issues = issues[: max(0, int(getattr(args, "max_tasks", 1)))]
        payload = {
            "status": "awaiting-human-promotion" if issues else "no-matching-issues",
            "command": command, "generatedAt": now(), "issues": issues,
            "note": "Imported QA is untrusted evidence. Promote reviewed tasks before workspace-write execution.",
        }
        atomic_json(RUNTIME / "repair-qa-selection.json", payload)
    elif command in {"verify-fixes", "deep-qa"}:
        ag = load_object(RUNTIME / "smoke-antigravity.json", {"status": "not-run"})
        payload = {
            "status": "hybrid-required" if ag.get("status") != "passed" else "ready",
            "command": command, "generatedAt": now(),
            "note": "Antigravity operational smoke must pass, otherwise run the documented Codex fallback without claiming Antigravity passed.",
        }
        atomic_json(RUNTIME / f"{command}.json", payload)
    else:
        payload = {"status": "unsupported", "command": command, "generatedAt": now(), "note": "No safe stage executor exists for this command yet; production mutations remain disabled."}
        atomic_json(RUNTIME / f"{command}.json", payload)
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0 if payload.get("status") in {"ready", "completed", "passed", "planned", "running", "awaiting-human-approval", "no-matching-issues", "awaiting-human-promotion"} else 2


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="CelebrateDeal dual-CLI role-based orchestrator")
    sub = parser.add_subparsers(dest="command", required=True)
    for name, handler in [("doctor", doctor), ("inspect", inspect), ("smoke-codex", smoke_codex), ("smoke-antigravity", smoke_antigravity), ("smoke-role-handoff", smoke_handoff)]:
        sub.add_parser(name).set_defaults(handler=handler)
    import_parser = sub.add_parser("import-qa")
    import_parser.add_argument("--file", required=True)
    import_parser.set_defaults(handler=import_qa)
    sub.add_parser("import-existing-qa").set_defaults(handler=import_qa)
    plan_parser = sub.add_parser("plan")
    plan_parser.add_argument("--pipeline", choices=["repair", "new-feature"], default="repair")
    plan_parser.add_argument("--milestone")
    plan_parser.add_argument("--task-id", help="Expand a trusted backlog task into its dynamic role DAG")
    plan_parser.set_defaults(handler=plan_pipeline)
    sub.add_parser("regression").set_defaults(handler=run_regression)
    for name in ["repair-qa", "verify-fixes", "deep-qa", "repair-deep-qa", "full-cycle", "repair-cycle", "resume", "status", "release-check"]:
        item = sub.add_parser(name)
        if name == "repair-qa":
            item.add_argument("--severity")
            item.add_argument("--issue")
            item.add_argument("--max-tasks", type=int, default=1)
        if name == "full-cycle":
            item.add_argument("--milestone")
        item.set_defaults(handler=state_command)
    return parser


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    REPORTS.mkdir(parents=True, exist_ok=True)
    RUNTIME.mkdir(parents=True, exist_ok=True)
    args = build_parser().parse_args(argv)
    return int(args.handler(args))


if __name__ == "__main__":
    raise SystemExit(main())

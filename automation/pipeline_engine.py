from __future__ import annotations

import copy
import datetime as dt
import hashlib
import hmac
import json
import os
import re
import subprocess
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any

from routing import validate_stage_graph


TERMINAL_FAILURES = {"failed", "blocked", "cancelled", "exhausted"}
COMPLETED = "completed"
STAGE_STATUSES = {"pending", "running", "completed", "failed", "blocked", "conditional", "cancelled", "exhausted"}
ATTESTATION_KEY_PATTERN = re.compile(r"^[0-9a-fA-F]{64}$")


def pipeline_digest(stages: list[dict[str, Any]]) -> str:
    canonical = [
        {
            "stageId": stage.get("stageId"),
            "roleId": stage.get("roleId"),
            "provider": stage.get("provider"),
            "mode": stage.get("mode"),
            "required": stage.get("required") is not False,
            "dependsOn": stage.get("dependsOn", []),
        }
        for stage in stages
    ]
    encoded = json.dumps(canonical, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def object_digest(value: object) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def sign_payload(payload: dict[str, Any], key: str) -> str:
    if not ATTESTATION_KEY_PATTERN.fullmatch(key) or len(set(key.lower())) < 8:
        raise ValueError("Attestation key must be a 256-bit hexadecimal value")
    unsigned = {name: value for name, value in payload.items() if name != "attestation"}
    encoded = json.dumps(unsigned, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hmac.new(key.encode("utf-8"), encoded, hashlib.sha256).hexdigest()


def verify_attestation(payload: dict[str, Any], key: str | None) -> bool:
    signature = payload.get("attestation")
    if not key or not ATTESTATION_KEY_PATTERN.fullmatch(key) or len(set(key.lower())) < 8 or not isinstance(signature, str):
        return False
    return hmac.compare_digest(signature, sign_payload(payload, key))


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_pipeline_state(state: dict[str, Any]) -> None:
    if state.get("schemaVersion") != 2:
        raise ValueError("Pipeline state schemaVersion must be 2")
    if not state.get("runId") or not isinstance(state.get("revision"), int) or state["revision"] < 1:
        raise ValueError("Pipeline state requires runId and positive revision")
    if not state.get("sourceRevision") or not state.get("sourceFingerprint") or not state.get("pipelineDigest"):
        raise ValueError("Pipeline state requires source revision, fingerprint and pipeline digest")
    if state.get("taskSnapshot") is not None and state.get("taskDigest") != object_digest(state.get("taskSnapshot")):
        raise ValueError("Pipeline task snapshot digest mismatch")
    stages = state.get("stages")
    if not isinstance(stages, list) or not stages:
        raise ValueError("Pipeline state requires stages")
    graph = [{"id": stage.get("stageId"), "dependsOn": stage.get("dependsOn", [])} for stage in stages if isinstance(stage, dict)]
    validate_stage_graph(graph)
    if pipeline_digest(stages) != state["pipelineDigest"]:
        raise ValueError("Pipeline state digest does not match its stage graph")
    for stage in stages:
        if not stage.get("roleId") or stage.get("provider") not in {"codex", "antigravity"}:
            raise ValueError(f"Stage is missing role/provider: {stage.get('stageId')}")
        if stage.get("mode") not in {"read-only", "workspace-write"}:
            raise ValueError(f"Stage has invalid mode: {stage.get('stageId')}")
        if stage.get("status") not in STAGE_STATUSES:
            raise ValueError(f"Stage has invalid status: {stage.get('stageId')}")
        attempts = stage.get("attempts")
        if not isinstance(attempts, int) or attempts < 0 or attempts > 3:
            raise ValueError(f"Stage attempts must be between zero and three: {stage.get('stageId')}")
        if stage.get("status") in {"running", "completed", "failed", "conditional"} and attempts < 1:
            raise ValueError(f"Started stage must record an attempt: {stage.get('stageId')}")


def ready_stage_ids(state: dict[str, Any]) -> list[str]:
    validate_pipeline_state(state)
    statuses = {str(stage["stageId"]): str(stage.get("status")) for stage in state["stages"]}
    ready: list[str] = []
    for stage in state["stages"]:
        if stage.get("status") != "pending":
            continue
        dependency_statuses = [statuses[dependency] for dependency in stage.get("dependsOn", [])]
        if any(status in TERMINAL_FAILURES for status in dependency_statuses):
            continue
        if all(status == COMPLETED for status in dependency_statuses):
            ready.append(str(stage["stageId"]))
    return ready


def start_stage(state: dict[str, Any], stage_id: str) -> dict[str, Any]:
    if stage_id not in ready_stage_ids(state):
        raise ValueError(f"Stage is not dependency-ready: {stage_id}")
    updated = copy.deepcopy(state)
    stage = next(item for item in updated["stages"] if item["stageId"] == stage_id)
    stage["status"] = "running"
    stage["attempts"] = int(stage.get("attempts", 0)) + 1
    stage["attemptNonce"] = uuid.uuid4().hex
    stage["leaseOwner"] = f"{os.getpid()}:{uuid.uuid4().hex}"
    stage["leaseExpiresAt"] = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=4)).isoformat()
    updated["status"] = "running"
    updated["currentStage"] = stage_id
    updated["revision"] += 1
    return updated


def build_receipt(
    state: dict[str, Any],
    stage_id: str,
    status: str,
    artifact_paths: list[str],
    root: Path,
    findings: list[dict[str, Any]] | None = None,
    execution_evidence: dict[str, Any] | None = None,
    attestation_key: str | None = None,
) -> dict[str, Any]:
    validate_pipeline_state(state)
    stage = next((item for item in state["stages"] if item["stageId"] == stage_id), None)
    if not stage:
        raise ValueError(f"Unknown stage: {stage_id}")
    artifacts = []
    for relative in artifact_paths:
        path = (root / relative).resolve()
        if root.resolve() not in path.parents or not path.is_file():
            raise ValueError(f"Receipt artifact is missing or outside workspace: {relative}")
        artifacts.append({"path": relative.replace("\\", "/"), "sha256": file_sha256(path)})
    if status == "completed" and not artifacts:
        raise ValueError(f"Completed stage requires at least one artifact: {stage_id}")
    if not attestation_key:
        raise ValueError("AI_PIPELINE_ATTESTATION_KEY is required to complete a stage")
    receipt = {
        "runId": state["runId"], "stageId": stage_id, "roleId": stage["roleId"],
        "provider": stage["provider"], "status": status, "attempt": stage.get("attempts"),
        "attemptNonce": stage.get("attemptNonce"),
        "pipelineDigest": state["pipelineDigest"], "sourceRevision": state["sourceRevision"],
        "sourceFingerprint": state["sourceFingerprint"], "artifacts": artifacts,
        "findings": findings or [],
        "commitSha": None,
        "approvedTree": None,
        "validationLogHash": None,
        "stagedSecretScan": None,
        "qaEvidence": [],
    }
    if execution_evidence:
        for name in ["commitSha", "approvedTree", "validationLogHash", "stagedSecretScan", "qaEvidence"]:
            if name in execution_evidence:
                receipt[name] = execution_evidence[name]
    if stage.get("mode") == "workspace-write" and status == "completed":
        for name in ["commitSha", "approvedTree", "validationLogHash"]:
            if not isinstance(receipt.get(name), str) or not re.fullmatch(r"[0-9a-f]{40,64}", str(receipt[name])):
                raise ValueError(f"Workspace-write receipt requires {name}: {stage_id}")
        scan = receipt.get("stagedSecretScan")
        if not isinstance(scan, dict) or scan.get("status") != "passed" or not re.fullmatch(r"[0-9a-f]{64}", str(scan.get("sha256", ""))):
            raise ValueError(f"Workspace-write receipt requires passed staged secret scan: {stage_id}")
    receipt["attestation"] = sign_payload(receipt, attestation_key)
    return receipt


def recover_interrupted_stage(state: dict[str, Any], stage_id: str) -> dict[str, Any]:
    """Return a crashed running stage to pending without accepting orphaned artifacts."""
    validate_pipeline_state(state)
    updated = copy.deepcopy(state)
    stage = next((item for item in updated["stages"] if item["stageId"] == stage_id), None)
    if not stage or stage.get("status") != "running":
        raise ValueError(f"Stage is not recoverable: {stage_id}")
    if int(stage.get("attempts", 0)) >= 3:
        stage["status"] = "exhausted"
        updated["status"] = "blocked"
    else:
        stage["status"] = "pending"
        updated["status"] = "running"
    stage["receipt"] = None
    stage["artifactPaths"] = []
    stage["attemptNonce"] = None
    stage["leaseOwner"] = None
    stage["leaseExpiresAt"] = None
    stage["error"] = "Recovered after coordinator interruption; orphaned evidence was discarded"
    updated["currentStage"] = None
    updated["revision"] += 1
    return updated


def complete_stage(state: dict[str, Any], receipt: dict[str, Any], root: Path, attestation_key: str | None = None) -> dict[str, Any]:
    validate_pipeline_state(state)
    stage_id = str(receipt.get("stageId", ""))
    stage = next((item for item in state["stages"] if item["stageId"] == stage_id), None)
    if not stage or stage.get("status") != "running":
        raise ValueError(f"Stage is not running: {stage_id}")
    for key, expected in [
        ("runId", state["runId"]), ("roleId", stage["roleId"]), ("provider", stage["provider"]),
        ("attempt", stage.get("attempts")), ("pipelineDigest", state["pipelineDigest"]),
        ("sourceRevision", state["sourceRevision"]),
        ("sourceFingerprint", state["sourceFingerprint"]),
        ("attemptNonce", stage.get("attemptNonce")),
    ]:
        if receipt.get(key) != expected:
            raise ValueError(f"Receipt {key} mismatch for stage {stage_id}")
    if not verify_attestation(receipt, attestation_key):
        raise ValueError(f"Receipt attestation is missing or invalid: {stage_id}")
    status = str(receipt.get("status"))
    if status not in {"completed", "failed", "blocked", "conditional"}:
        raise ValueError(f"Unsupported receipt status: {status}")
    if status == "completed" and not receipt.get("artifacts"):
        raise ValueError(f"Completed stage requires artifact evidence: {stage_id}")
    for artifact in receipt.get("artifacts", []):
        relative = str(artifact.get("path", ""))
        path = (root / relative).resolve()
        if root.resolve() not in path.parents or not path.is_file() or file_sha256(path) != artifact.get("sha256"):
            raise ValueError(f"Receipt artifact changed or is missing: {relative}")
    updated = copy.deepcopy(state)
    target = next(item for item in updated["stages"] if item["stageId"] == stage_id)
    target["status"] = "completed" if status == "completed" else status
    target["receipt"] = receipt
    target["artifactPaths"] = [item["path"] for item in receipt.get("artifacts", [])]
    updated["currentStage"] = None
    updated["revision"] += 1
    if status in {"failed", "blocked", "conditional"}:
        updated["status"] = "blocked"
        blocked_ids = {stage_id}
        changed = True
        while changed:
            changed = False
            for item in updated["stages"]:
                if item.get("status") == "pending" and any(dependency in blocked_ids for dependency in item.get("dependsOn", [])):
                    item["status"] = "blocked"
                    item["error"] = f"Upstream dependency ended as {status}"
                    blocked_ids.add(str(item["stageId"]))
                    changed = True
    elif not ready_stage_ids(updated) and all(item.get("status") == "completed" for item in updated["stages"]):
        updated["status"] = "completed"
    else:
        updated["status"] = "running"
    return updated


def validate_release_evidence(
    state: dict[str, Any],
    root: Path,
    unresolved_issues: list[dict[str, Any]],
    expected_pipeline_digest: str | None = None,
    expected_source_revision: str | None = None,
    expected_source_fingerprint: str | None = None,
    attestation_key: str | None = None,
) -> list[str]:
    validate_pipeline_state(state)
    blockers: list[str] = []
    if not expected_pipeline_digest or state["pipelineDigest"] != expected_pipeline_digest:
        blockers.append("pipeline:untrusted-or-changed-definition")
    if not expected_source_revision or state["sourceRevision"] != expected_source_revision:
        blockers.append("pipeline:stale-or-untrusted-source-revision")
    if not expected_source_fingerprint or state["sourceFingerprint"] != expected_source_fingerprint:
        blockers.append("pipeline:stale-or-untrusted-source-fingerprint")
    if not attestation_key:
        blockers.append("attestation:key-unavailable")
    used_artifacts: set[str] = set()
    for stage in state["stages"]:
        if stage.get("required") is not False and stage.get("stageId") not in {"release-check", "await-human-approval"}:
            if stage.get("status") != "completed":
                blockers.append(f"stage:{stage.get('stageId')}:{stage.get('status')}")
                continue
            receipt = stage.get("receipt")
            expected_receipt = {
                "runId": state["runId"],
                "stageId": stage.get("stageId"),
                "roleId": stage.get("roleId"),
                "provider": stage.get("provider"),
                "status": "completed",
                "attempt": stage.get("attempts"),
                "pipelineDigest": state["pipelineDigest"],
                "sourceRevision": state["sourceRevision"],
                "sourceFingerprint": state["sourceFingerprint"],
                "attemptNonce": stage.get("attemptNonce"),
            }
            if not isinstance(receipt, dict) or any(receipt.get(key) != value for key, value in expected_receipt.items()):
                blockers.append(f"receipt:{stage.get('stageId')}:missing-or-stale")
                continue
            if not verify_attestation(receipt, attestation_key):
                blockers.append(f"receipt:{stage.get('stageId')}:invalid-attestation")
                continue
            if stage.get("mode") == "workspace-write":
                if not all(isinstance(receipt.get(name), str) for name in ["commitSha", "approvedTree", "validationLogHash"]):
                    blockers.append(f"receipt:{stage.get('stageId')}:missing-write-evidence")
                scan = receipt.get("stagedSecretScan")
                if not isinstance(scan, dict) or scan.get("status") != "passed":
                    blockers.append(f"receipt:{stage.get('stageId')}:missing-secret-scan")
                if not any(str(item.get("path", "")).endswith("-validation.log") for item in receipt.get("artifacts", [])):
                    blockers.append(f"receipt:{stage.get('stageId')}:missing-validation-log")
                if not any(str(item.get("path", "")).endswith("-secret-scan.log") for item in receipt.get("artifacts", [])):
                    blockers.append(f"receipt:{stage.get('stageId')}:missing-secret-scan-log")
            if not receipt.get("artifacts"):
                blockers.append(f"receipt:{stage.get('stageId')}:missing-artifacts")
                continue
            expected_prefix = f"reports/ai-team/runtime/{state['runId']}-{stage.get('stageId')}-a{stage.get('attempts')}-{stage.get('attemptNonce')}"
            expected_artifacts = {f"{expected_prefix}.json"}
            if stage.get("mode") == "workspace-write":
                expected_artifacts.update({f"{expected_prefix}-validation.log", f"{expected_prefix}-secret-scan.log"})
            receipt_paths = {str(item.get("path", "")).replace("\\", "/") for item in receipt.get("artifacts", [])}
            if receipt_paths != expected_artifacts:
                blockers.append(f"artifact:{stage.get('stageId')}:unbound-or-reused")
            for artifact in receipt.get("artifacts", []):
                relative = str(artifact.get("path", "")).replace("\\", "/")
                if relative not in expected_artifacts or relative in used_artifacts:
                    blockers.append(f"artifact:{stage.get('stageId')}:unbound-or-reused")
                    continue
                used_artifacts.add(relative)
                path = (root / relative).resolve()
                if root.resolve() not in path.parents or not path.is_file() or file_sha256(path) != artifact.get("sha256"):
                    blockers.append(f"artifact:{stage.get('stageId')}:missing-or-changed")
            if stage.get("mode") == "workspace-write":
                validation_path = next((item for item in receipt.get("artifacts", []) if str(item.get("path", "")).endswith("-validation.log")), None)
                secret_path = next((item for item in receipt.get("artifacts", []) if str(item.get("path", "")).endswith("-secret-scan.log")), None)
                if validation_path and receipt.get("validationLogHash") != validation_path.get("sha256"):
                    blockers.append(f"receipt:{stage.get('stageId')}:validation-log-hash-mismatch")
                if secret_path and isinstance(receipt.get("stagedSecretScan"), dict) and receipt["stagedSecretScan"].get("sha256") != secret_path.get("sha256"):
                    blockers.append(f"receipt:{stage.get('stageId')}:secret-scan-hash-mismatch")
                commit_sha = receipt.get("commitSha")
                approved_tree = receipt.get("approvedTree")
                commit_result = subprocess.run(
                    ["git", "show", "-s", "--format=%T%n%P", str(commit_sha)],
                    cwd=root, text=True, capture_output=True, shell=False,
                )
                if commit_result.returncode != 0:
                    blockers.append(f"receipt:{stage.get('stageId')}:commit-not-found")
                else:
                    commit_lines = commit_result.stdout.splitlines()
                    commit_tree = commit_lines[0] if commit_lines else ""
                    parents = commit_lines[1].split() if len(commit_lines) > 1 else []
                    if commit_tree != approved_tree:
                        blockers.append(f"receipt:{stage.get('stageId')}:commit-tree-mismatch")
                    completed_writer_commits: list[str] = []
                    for prior in state["stages"]:
                        if prior.get("stageId") == stage.get("stageId"):
                            break
                        if prior.get("mode") == "workspace-write" and prior.get("status") == "completed":
                            prior_commit = prior.get("receipt", {}).get("commitSha")
                            if isinstance(prior_commit, str):
                                completed_writer_commits.append(prior_commit)
                    writer_predecessor = completed_writer_commits[-1] if completed_writer_commits else None
                    expected_parent = writer_predecessor or state.get("sourceRevision")
                    if expected_parent and (not parents or parents[0] != expected_parent):
                        blockers.append(f"receipt:{stage.get('stageId')}:commit-parent-mismatch")
    for issue in unresolved_issues:
        if issue.get("severity") in {"P0", "P1"} and issue.get("status", "open") not in {"resolved", "dismissed", "closed"}:
            blockers.append(f"issue:{issue.get('issue_id') or issue.get('id')}")
    return sorted(set(blockers))


def atomic_compare_and_swap(
    path: Path, expected_revision: int, state: dict[str, Any],
    expected_run_id: str | None = None, expected_state_digest: str | None = None,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lock_path = path.with_suffix(path.suffix + ".lock")

    def remove_lock_with_retry() -> None:
        remove_deadline = time.monotonic() + 2
        while True:
            try:
                lock_path.unlink()
                return
            except FileNotFoundError:
                return
            except PermissionError:
                if os.name != "nt" or time.monotonic() >= remove_deadline:
                    raise
                time.sleep(0.02)

    deadline = time.monotonic() + 10
    lock_fd: int | None = None
    while lock_fd is None:
        try:
            lock_fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(lock_fd, json.dumps({"pid": os.getpid(), "createdAt": time.time()}).encode("ascii"))
        except FileExistsError:
            try:
                owner = json.loads(lock_path.read_text(encoding="ascii"))
                owner_pid = int(owner.get("pid", 0)) if isinstance(owner, dict) else 0
                alive = False
                if owner_pid > 0 and os.name == "nt":
                    import ctypes
                    process = ctypes.windll.kernel32.OpenProcess(0x1000, False, owner_pid)
                    if process:
                        ctypes.windll.kernel32.CloseHandle(process)
                        alive = True
                elif owner_pid > 0:
                    try:
                        os.kill(owner_pid, 0)
                        alive = True
                    except OSError:
                        pass
                if not alive:
                    remove_lock_with_retry()
                    continue
            except FileNotFoundError:
                continue
            except (OSError, ValueError, json.JSONDecodeError):
                pass
            if time.monotonic() >= deadline:
                raise RuntimeError("Timed out waiting for pipeline state lock")
            time.sleep(0.01)
    try:
        current = json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
        if current is None:
            raise RuntimeError("Pipeline state disappeared; refusing stale worker recreation")
        if current.get("revision") != expected_revision:
            raise RuntimeError("Pipeline state revision changed; refusing stale worker update")
        if expected_run_id is not None and current.get("runId") != expected_run_id:
            raise RuntimeError("Pipeline run identity changed; refusing ABA worker update")
        if expected_state_digest is not None and object_digest(current) != expected_state_digest:
            raise RuntimeError("Pipeline state content changed; refusing ABA worker update")
        if state.get("revision") != expected_revision + 1:
            raise RuntimeError("Pipeline state revision must advance by exactly one")
        validate_pipeline_state(state)
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False, suffix=".tmp") as handle:
            json.dump(state, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            temporary = Path(handle.name)
        os.replace(temporary, path)
    finally:
        os.close(lock_fd)
        remove_lock_with_retry()

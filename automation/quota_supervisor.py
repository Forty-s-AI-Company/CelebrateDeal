from __future__ import annotations

import datetime as dt
import json
import re
import shutil
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from adapters.base_adapter import DEFAULT_ENV_ALLOWLIST, redact


CODEX_QUOTA_PATTERNS = (
    "you've hit your usage limit",
    "usage limit",
    "upgrade to pro",
    "rate limit",
)
ANTIGRAVITY_QUOTA_PATTERNS = (
    "http 429 too many requests",
    "resource_exhausted",
    "quota exceeded",
    "usage limit reached",
    "consumed all available tokens",
)
LOCAL_MODEL_ALLOWLIST = {
    "qwen3:8b",
    "qwen2.5-coder:7b",
    "qwen2.5-coder:1.5b",
    "qwen2.5vl:3b",
    "nomic-embed-text:latest",
}
GENERATION_MODEL_ALLOWLIST = {"qwen3:8b", "qwen2.5-coder:7b", "qwen2.5-coder:1.5b", "qwen2.5vl:3b"}
MAX_PROVIDER_WAIT = dt.timedelta(hours=24)


def local_now() -> dt.datetime:
    return dt.datetime.now().astimezone()


def _safe_env() -> dict[str, str]:
    import os

    return {key: value for key, value in os.environ.items() if key.upper() in DEFAULT_ENV_ALLOWLIST}


def _parse_datetime(value: str, now: dt.datetime) -> dt.datetime | None:
    cleaned = re.sub(r"(?<=\d)(st|nd|rd|th)", "", value, flags=re.I).strip()
    cleaned = re.sub(r"\s*\(Local Time\)\s*$", "", cleaned, flags=re.I)
    formats = (
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%b %d, %Y %I:%M %p",
        "%B %d, %Y %I:%M %p",
    )
    for format_value in formats:
        try:
            parsed = dt.datetime.strptime(cleaned, format_value)
        except ValueError:
            continue
        return parsed.replace(tzinfo=now.tzinfo)
    return None


def extract_reset_time(text: str, now: dt.datetime | None = None) -> tuple[dt.datetime | None, str | None]:
    current = now or local_now()
    candidates = [
        (r"Reset Time:\s*([^\r\n]+)", "provider-quota-command"),
        (r"try again at\s+([^\r\n.]+(?:AM|PM)?)", "provider-error-message"),
    ]
    for pattern, source in candidates:
        match = re.search(pattern, text, flags=re.I)
        if not match:
            continue
        parsed = _parse_datetime(match.group(1), current)
        if parsed and current < parsed <= current + MAX_PROVIDER_WAIT:
            return parsed, source
    return None, None


@dataclass(frozen=True)
class QuotaDetection:
    provider: str
    exhausted: bool
    reason: str | None
    detected_at: str
    resume_at: str | None
    next_probe_at: str
    reset_time_source: str | None
    confidence: str
    retryable: bool

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def detect_quota(provider: str, text: str, now: dt.datetime | None = None) -> QuotaDetection:
    current = now or local_now()
    lowered = text.lower()
    patterns = CODEX_QUOTA_PATTERNS if provider == "codex" else ANTIGRAVITY_QUOTA_PATTERNS
    exhausted = any(pattern in lowered for pattern in patterns) or "429" in lowered
    reset_time, source = extract_reset_time(text, current) if exhausted else (None, None)
    next_probe = reset_time or (current + dt.timedelta(hours=1))
    reason = "usage-limit-reached" if exhausted else None
    return QuotaDetection(
        provider=provider,
        exhausted=exhausted,
        reason=reason,
        detected_at=current.isoformat(),
        resume_at=reset_time.isoformat() if reset_time else None,
        next_probe_at=next_probe.isoformat(),
        reset_time_source=source,
        confidence="high" if exhausted and reset_time else "medium" if exhausted else "high",
        retryable=exhausted,
    )


def build_waiting_state(
    detection: QuotaDetection,
    pipeline: dict[str, Any],
    local_model: str = "qwen2.5-coder:1.5b",
) -> dict[str, Any]:
    if local_model not in LOCAL_MODEL_ALLOWLIST:
        raise ValueError(f"Ollama model is not allowlisted: {local_model}")
    completed = [stage.get("stageId") for stage in pipeline.get("stages", []) if stage.get("status") == "completed"]
    pending = [stage.get("stageId") for stage in pipeline.get("stages", []) if stage.get("status") != "completed"]
    return {
        "schemaVersion": 1,
        "status": "waiting-for-quota",
        "taskId": pipeline.get("taskId"),
        "runId": pipeline.get("runId"),
        "stageId": pipeline.get("currentStage"),
        "preferredProvider": detection.provider,
        "actualProvider": detection.provider,
        "requestedModel": None,
        "actualModel": None,
        "localProvider": "ollama",
        "localFallbackModel": local_model,
        "reason": detection.reason,
        "detectedAt": detection.detected_at,
        "resumeAt": detection.resume_at,
        "nextProbeAt": detection.next_probe_at,
        "completedStages": completed,
        "pendingStages": pending,
        "localScope": "docs-reports-metadata-only",
        "providerRequirementSatisfied": False,
        "capabilityEquivalent": False,
        "requiresProviderResume": True,
        "retryCount": 0,
        "maxRetries": 3,
        "sourceRevision": pipeline.get("sourceRevision"),
        "pipelineDigest": pipeline.get("pipelineDigest"),
        "workspaceFingerprint": pipeline.get("sourceFingerprint"),
    }


def _run_probe(command: list[str], timeout: int) -> subprocess.CompletedProcess[str]:
    process = subprocess.Popen(
        command, text=True, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        env=_safe_env(), shell=False, encoding="utf-8", errors="replace",
    )
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        process.kill()
        stdout, stderr = process.communicate()
        return subprocess.CompletedProcess(command, -1, stdout or "", (stderr or "") + f"\nTimed out after {timeout}s")
    return subprocess.CompletedProcess(command, process.returncode, stdout or "", stderr or "")


def probe_antigravity(timeout: int = 10) -> dict[str, Any]:
    executable = next((shutil.which(name) for name in ("agy", "agy.exe", "antigravity", "antigravity-cli") if shutil.which(name)), None)
    if not executable:
        return {"provider": "antigravity", "status": "unsupported", "error": "CLI unavailable"}
    outputs: list[str] = []
    quota_supported = False
    for arguments in (["quota"], ["auth", "status"]):
        try:
            completed = _run_probe([executable, *arguments], timeout)
        except OSError as error:
            outputs.append(str(error))
            continue
        outputs.append((completed.stdout or "") + "\n" + (completed.stderr or ""))
        detection = detect_quota("antigravity", outputs[-1])
        if detection.exhausted or detection.resume_at:
            return {"provider": "antigravity", "status": "waiting-for-quota", "quota": detection.to_dict(), "output": redact(outputs[-1])}
        if arguments == ["quota"] and completed.returncode == 0:
            quota_supported = True
            return {"provider": "antigravity", "status": "available", "quota": detection.to_dict(), "output": redact(outputs[-1])}
    combined = "\n".join(outputs)
    detection = detect_quota("antigravity", combined)
    return {"provider": "antigravity", "status": "waiting-for-quota" if detection.exhausted else "failed", "quota": detection.to_dict(), "output": redact(combined), "quotaCommandSupported": quota_supported}


def quota_status(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"schemaVersion": 1, "status": "not-waiting", "generatedAt": local_now().isoformat()}
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Quota state must be a JSON object")
    required = {
        "schemaVersion", "status", "preferredProvider", "localProvider", "localFallbackModel",
        "detectedAt", "nextProbeAt", "providerRequirementSatisfied", "capabilityEquivalent",
        "requiresProviderResume", "retryCount", "maxRetries",
    }
    if required - set(payload) or payload.get("schemaVersion") != 1 or payload.get("status") != "waiting-for-quota":
        raise ValueError("Quota state failed schema validation")
    if payload.get("preferredProvider") not in {"codex", "antigravity"}:
        raise ValueError("Quota state has an unsupported provider")
    if payload.get("localFallbackModel") not in LOCAL_MODEL_ALLOWLIST:
        raise ValueError("Quota state has an unsupported local model")
    if payload.get("providerRequirementSatisfied") is not False or payload.get("capabilityEquivalent") is not False:
        raise ValueError("Local quota state cannot satisfy provider requirements")
    if int(payload.get("retryCount", -1)) < 0 or int(payload.get("maxRetries", 0)) < 1:
        raise ValueError("Quota retry counters are invalid")
    return payload

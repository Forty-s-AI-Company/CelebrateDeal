from __future__ import annotations

import datetime as dt
import os
import re
import shutil
import subprocess
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Mapping, Sequence


DEFAULT_ENV_ALLOWLIST = {
    "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP",
    "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "ALLUSERSPROFILE",
    "SYSTEMDRIVE", "HOMEDRIVE", "HOMEPATH", "CODEX_HOME",
}
SECRET_NAME = re.compile(r"(SECRET|TOKEN|PASSWORD|KEY|HASH_IV|HASH_KEY|DSN|COOKIE)", re.I)
SECRET_VALUE = re.compile(
    r"(?i)((?:bearer|basic)\s+)[A-Za-z0-9._~+/=:-]+|"
    r"((?:secret|token|password|private[_-]?key|hashkey|hashiv|api[_-]?key|dsn)[\"']?\s*[:=]\s*[\"']?)[^\"'\s,;}]+|"
    r"(https?://)[^/@\s:]+:[^/@\s]+@"
)


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def redact(value: str) -> str:
    redacted = SECRET_VALUE.sub(
        lambda match: (match.group(1) or match.group(2) or match.group(3) or "") + "[REDACTED]",
        value,
    )
    return re.sub(r"-----BEGIN [^-]+ PRIVATE KEY-----.*?-----END [^-]+ PRIVATE KEY-----", "[REDACTED PRIVATE KEY]", redacted, flags=re.S)


@dataclass
class AdapterCapability:
    provider: str
    executable: str | None
    available: bool
    mode: str
    version: str | None = None
    features: list[str] = field(default_factory=list)
    models: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass
class AdapterRequest:
    role_id: str
    prompt: str
    workdir: Path
    requested_model: str
    requested_reasoning: str
    timeout_seconds: int = 300
    sandbox: str = "read-only"
    output_schema: Path | None = None
    artifacts_dir: Path | None = None
    env: Mapping[str, str] = field(default_factory=dict)


@dataclass
class AdapterResult:
    provider: str
    role_id: str
    status: str
    mode: str
    requested_model: str
    actual_model: str | None
    requested_reasoning: str
    actual_reasoning: str | None
    fallback_reason: str | None
    command: list[str]
    exit_code: int | None
    started_at: str
    finished_at: str
    duration_seconds: float
    stdout: str
    stderr: str
    timed_out: bool = False
    cancelled: bool = False
    attempts: int = 1
    artifacts: list[str] = field(default_factory=list)
    error: str | None = None
    output_status: str | None = None
    confidence: str = "high"
    risk: str = "low"

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


class BaseAdapter:
    provider = "base"
    executable_names: Sequence[str] = ()
    requires_output_status = False

    def discover_executable(self) -> str | None:
        for name in self.executable_names:
            found = shutil.which(name)
            if found:
                return found
        return None

    def command(self, executable: str, *arguments: str) -> list[str]:
        """Invoke PowerShell shims explicitly because shell=False cannot run .ps1 files."""
        if executable.lower().endswith(".ps1"):
            return ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", executable, *arguments]
        return [executable, *arguments]

    def capability(self) -> AdapterCapability:
        raise NotImplementedError

    def build_command(self, request: AdapterRequest, executable: str) -> list[str]:
        raise NotImplementedError

    def parse_actual_model(self, stdout: str, requested_model: str) -> str | None:
        return None

    def parse_output_status(self, stdout: str) -> str | None:
        return None

    def safe_environment(self, extra: Mapping[str, str]) -> dict[str, str]:
        env = {key: value for key, value in os.environ.items() if key.upper() in DEFAULT_ENV_ALLOWLIST}
        for key, value in extra.items():
            if key.upper() in DEFAULT_ENV_ALLOWLIST and not SECRET_NAME.search(key):
                env[key] = value
        return env

    def run(self, request: AdapterRequest, retries: int = 0) -> AdapterResult:
        capability = self.capability()
        started_at = utc_now()
        started = time.monotonic()
        if not capability.available or not capability.executable:
            return AdapterResult(
                provider=self.provider, role_id=request.role_id, status="unsupported", mode=capability.mode,
                requested_model=request.requested_model, actual_model=None,
                requested_reasoning=request.requested_reasoning, actual_reasoning=None,
                fallback_reason="CLI executable unavailable", command=[], exit_code=None,
                started_at=started_at, finished_at=utc_now(), duration_seconds=0,
                stdout="", stderr="", error="CLI executable unavailable", confidence="high", risk="medium",
            )

        command = self.build_command(request, capability.executable)
        attempts = 0
        last: subprocess.CompletedProcess[str] | None = None
        timed_out = False
        error: str | None = None
        for attempts in range(1, max(1, retries + 1) + 1):
            try:
                last = subprocess.run(
                    command, cwd=request.workdir, input=request.prompt, text=True,
                    capture_output=True, timeout=request.timeout_seconds,
                    env=self.safe_environment(request.env), shell=False, encoding="utf-8", errors="replace",
                )
                if last.returncode == 0:
                    break
            except subprocess.TimeoutExpired as exc:
                timed_out = True
                error = f"Timed out after {request.timeout_seconds}s"
                last = subprocess.CompletedProcess(command, -1, exc.stdout or "", exc.stderr or "")
                break
            except OSError as exc:
                error = str(exc)
                last = subprocess.CompletedProcess(command, -1, "", str(exc))
                break

        stdout = redact((last.stdout or "") if last else "")
        stderr = redact((last.stderr or "") if last else "")
        actual_model = self.parse_actual_model(stdout, request.requested_model)
        status = "passed" if last and last.returncode == 0 and not timed_out else "failed"
        output_status = self.parse_output_status(stdout)
        if status == "passed" and self.requires_output_status and output_status not in {"passed", "failed", "conditional", "blocked"}:
            status = "failed"
            error = "Structured output is missing a supported status"
        if status == "passed" and output_status in {"failed", "blocked", "conditional"}:
            status = output_status
        return AdapterResult(
            provider=self.provider, role_id=request.role_id, status=status, mode=capability.mode,
            requested_model=request.requested_model, actual_model=actual_model,
            requested_reasoning=request.requested_reasoning,
            actual_reasoning=None,
            fallback_reason=None if actual_model in {None, request.requested_model} else "runtime reported a different model",
            command=[redact(part) for part in command], exit_code=last.returncode if last else None,
            started_at=started_at, finished_at=utc_now(),
            duration_seconds=round(time.monotonic() - started, 3), stdout=stdout, stderr=stderr,
            timed_out=timed_out, attempts=attempts, artifacts=[], error=error,
            output_status=output_status,
            confidence="high" if status == "passed" else "medium", risk="low" if status == "passed" else "medium",
        )

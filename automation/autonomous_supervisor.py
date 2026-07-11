from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import shutil
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from adapters.base_adapter import DEFAULT_ENV_ALLOWLIST, redact
from windows_credentials import CredentialError, read_key, validate_key


ROOT = Path(__file__).resolve().parents[1]
AUTOMATION = ROOT / "automation"
RUNTIME = ROOT / "reports" / "ai-team" / "runtime"
LOCK_PATH = RUNTIME / "autonomous-supervisor.lock"
STATE_PATH = RUNTIME / "autonomous-supervisor-state.json"
DIAGNOSTICS_PATH = RUNTIME / "autonomous-supervisor-diagnostics.json"
LOG_PATH = RUNTIME / "autonomous-supervisor.jsonl"
CONFIG_PATH = AUTOMATION / "team-config.yaml"
MIN_DISK_BYTES = 2 * 1024 * 1024 * 1024
MAX_CONSECUTIVE_FAILURES = 3
CIRCUIT_BREAKER_MINUTES = 360
EXPECTED_NONZERO = {
    "quota-supervisor": {2},
    "qa-provider-smoke": {2},
    "qa-handoff": {2},
    "regression": {2},
}


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def load_json(path: Path, default: dict[str, Any]) -> dict[str, Any]:
    if not path.is_file():
        return dict(default)
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Expected JSON object in {path}")
    return value


def atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + f".{os.getpid()}.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def append_event(event: str, **values: Any) -> None:
    RUNTIME.mkdir(parents=True, exist_ok=True)
    payload = {"timestamp": now(), "event": event, **values}
    with LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False) + "\n")


def coordinator_environment(attestation_key: str | None) -> dict[str, str]:
    environment = {key: value for key, value in os.environ.items() if key.upper() in DEFAULT_ENV_ALLOWLIST}
    if attestation_key:
        environment["AI_PIPELINE_ATTESTATION_KEY"] = validate_key(attestation_key)
    return environment


def load_attestation_key() -> tuple[str | None, str]:
    environment_key = os.environ.get("AI_PIPELINE_ATTESTATION_KEY")
    if environment_key:
        return validate_key(environment_key), "process-environment"
    if os.name != "nt":
        return None, "unavailable"
    try:
        return read_key(), "windows-credential-manager"
    except CredentialError:
        return None, "credential-read-failed"


def process_exists(pid: int) -> bool:
    if pid <= 0:
        return False
    if os.name == "nt":
        import ctypes
        handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)
        if handle:
            ctypes.windll.kernel32.CloseHandle(handle)
            return True
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


class InstanceLock:
    def __init__(self, path: Path = LOCK_PATH):
        self.path = path
        self.acquired = False

    def acquire(self) -> bool:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        for _ in range(2):
            try:
                descriptor = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            except FileExistsError:
                existing = load_json(self.path, {})
                if process_exists(int(existing.get("pid", 0))):
                    return False
                self.path.unlink(missing_ok=True)
                continue
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                json.dump({"pid": os.getpid(), "startedAt": now()}, handle)
            self.acquired = True
            return True
        return False

    def release(self) -> None:
        if self.acquired:
            self.path.unlink(missing_ok=True)
            self.acquired = False

    def __enter__(self):
        if not self.acquire():
            raise RuntimeError("another autonomous supervisor instance is already running")
        return self

    def __exit__(self, _type, _value, _traceback):
        self.release()


@dataclass
class StepResult:
    name: str
    status: str
    exit_code: int | None
    duration_seconds: float
    stdout: str
    stderr: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name, "status": self.status, "exitCode": self.exit_code,
            "durationSeconds": self.duration_seconds, "stdout": self.stdout, "stderr": self.stderr,
        }


def run_step(name: str, arguments: list[str], attestation_key: str | None, timeout: int = 1200) -> StepResult:
    command = [sys.executable, str(AUTOMATION / "orchestrator.py"), *arguments]
    started = time.monotonic()
    try:
        completed = subprocess.run(
            command, cwd=ROOT, text=True, capture_output=True, timeout=timeout, shell=False,
            env=coordinator_environment(attestation_key), encoding="utf-8", errors="replace",
        )
        status = "passed" if completed.returncode == 0 else "conditional" if completed.returncode in EXPECTED_NONZERO.get(name, set()) else "failed"
        stdout = completed.stdout or ""
        stderr = completed.stderr or ""
        if attestation_key:
            for form in {attestation_key, attestation_key.upper()}:
                stdout = stdout.replace(form, "[REDACTED ATTESTATION KEY]")
                stderr = stderr.replace(form, "[REDACTED ATTESTATION KEY]")
        return StepResult(
            name, status,
            completed.returncode, round(time.monotonic() - started, 3),
            redact(stdout[-4000:]), redact(stderr[-4000:]),
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return StepResult(name, "failed", None, round(time.monotonic() - started, 3), "", redact(str(error)))


def daily_auto_commit_count() -> int | None:
    midnight = dt.datetime.now().astimezone().replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    try:
        completed = subprocess.run(
            ["git", "log", "--all", f"--since={midnight}", "--format=%H", "--grep=^chore(auto):"],
            cwd=ROOT, text=True, capture_output=True, timeout=20, shell=False,
            env=coordinator_environment(None), encoding="utf-8", errors="replace",
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if completed.returncode != 0:
        return None
    return len([line for line in completed.stdout.splitlines() if line.strip()])


def write_diagnostics(key_source: str, steps: list[StepResult], status: str, **extra: Any) -> dict[str, Any]:
    payload = {
        "schemaVersion": 1, "generatedAt": now(), "status": status,
        "attestationKey": {"available": key_source in {"process-environment", "windows-credential-manager"}, "source": key_source},
        "executables": {
            name: {"available": shutil.which(name) is not None}
            for name in ("git", "npm.cmd" if os.name == "nt" else "npm", "codex", "agy", "ollama", "rg")
        },
        "steps": [step.to_dict() for step in steps], **extra,
    }
    atomic_json(DIAGNOSTICS_PATH, payload)
    return payload


def run_cycle(attestation_key: str | None, key_source: str) -> tuple[str, list[StepResult]]:
    config = load_json(CONFIG_PATH, {})
    autonomy = config.get("autonomy", {}) if isinstance(config.get("autonomy"), dict) else {}
    minimum_disk = int(autonomy.get("minimum_free_disk_bytes", MIN_DISK_BYTES))
    max_commits = int(autonomy.get("max_commits", 5))
    free_disk = shutil.disk_usage(ROOT).free
    if free_disk < minimum_disk:
        step = StepResult("disk-space", "failed", None, 0, "", f"free disk {free_disk} is below required {minimum_disk}")
        return "failed", [step]

    steps: list[StepResult] = []
    quota = run_step("quota-status", ["quota-status"], None, 60)
    steps.append(quota)
    quota_waiting = '"status": "waiting-for-quota"' in quota.stdout
    if quota_waiting:
        supervisor = run_step("quota-supervisor", ["supervisor"], attestation_key, 300)
        steps.append(supervisor)
        status = "waiting-for-quota" if supervisor.status == "conditional" else supervisor.status
        return status, steps

    steps.append(run_step("discovery", ["discover", "--quality"], None))
    steps.append(run_step("triage", ["triage"], None, 120))

    candidate_path = AUTOMATION / "backlog-candidates.json"
    candidates = load_json(candidate_path, {"tasks": []})
    promotable = [task.get("id") for task in candidates.get("tasks", []) if isinstance(task, dict) and task.get("auto_execute") is True]
    atomic_json(RUNTIME / "safe-promotion.json", {
        "schemaVersion": 1, "generatedAt": now(), "status": "eligible" if promotable else "none",
        "candidateIds": promotable,
        "executionPolicy": "runtime candidates require trusted coordinator revalidation and cannot directly drive Git commits",
    })

    commit_count = daily_auto_commit_count()
    if commit_count is None:
        steps.append(StepResult("auto-cycle", "failed", None, 0, "", "autonomous commit quota could not be verified"))
    elif commit_count < max_commits:
        steps.append(run_step("auto-cycle", ["auto-cycle-once", "--quality"], None))
    else:
        steps.append(StepResult("auto-cycle", "conditional", 2, 0, "", "daily autonomous commit limit reached"))
    steps.append(run_step("qa-provider-smoke", ["smoke-antigravity"], None, 300))
    steps.append(run_step("qa-handoff", ["smoke-role-handoff"], None, 120))
    steps.append(run_step("qa-import", ["import-existing-qa"], None, 120))
    steps.append(run_step("regression", ["regression"], attestation_key, 3600))
    steps.append(run_step("commit-evidence", ["autonomous-commit"], None, 120))
    failed = [step for step in steps if step.status == "failed"]
    return ("failed" if failed else "conditional" if any(step.status == "conditional" for step in steps) else "passed"), steps


def parse_time(value: object) -> dt.datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return dt.datetime.fromisoformat(value)
    except ValueError:
        return None


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the unattended CelebrateDeal AI development and QA supervisor")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--interval-minutes", type=float, default=60)
    parser.add_argument("--max-runtime-minutes", type=float, default=0, help="Zero means run until stopped")
    return parser


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.interval_minutes <= 0 or args.max_runtime_minutes < 0:
        parser.error("interval must be positive and max runtime cannot be negative")

    stop_requested = False

    def request_stop(_signal, _frame):
        nonlocal stop_requested
        stop_requested = True

    signal.signal(signal.SIGINT, request_stop)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, request_stop)

    RUNTIME.mkdir(parents=True, exist_ok=True)
    try:
        lock = InstanceLock()
        if not lock.acquire():
            write_diagnostics("unread", [], "already-running")
            print("autonomous supervisor is already running", file=sys.stderr)
            return 3
    except (OSError, ValueError) as error:
        print(f"supervisor lock error: {error}", file=sys.stderr)
        return 1

    started = time.monotonic()
    config = load_json(CONFIG_PATH, {})
    autonomy = config.get("autonomy", {}) if isinstance(config.get("autonomy"), dict) else {}
    max_failures = int(autonomy.get("max_consecutive_failures", MAX_CONSECUTIVE_FAILURES))
    circuit_minutes = int(autonomy.get("circuit_breaker_minutes", CIRCUIT_BREAKER_MINUTES))
    try:
        while not stop_requested:
            state = load_json(STATE_PATH, {"consecutiveFailures": 0})
            circuit_until = parse_time(state.get("circuitOpenUntil"))
            current = dt.datetime.now(dt.timezone.utc)
            if circuit_until and circuit_until > current:
                diagnostics = write_diagnostics("unread", [], "circuit-open", circuitOpenUntil=circuit_until.isoformat())
                print(json.dumps(diagnostics, ensure_ascii=False, indent=2))
                return 2

            try:
                key, key_source = load_attestation_key()
            except CredentialError as error:
                key, key_source = None, "credential-invalid"
                append_event("credential-error", error=redact(str(error)))
            append_event("cycle-started", keyAvailable=bool(key), keySource=key_source)
            status, steps = run_cycle(key, key_source)
            failures = int(state.get("consecutiveFailures", 0)) + 1 if status == "failed" else 0
            next_state: dict[str, Any] = {
                "schemaVersion": 1, "lastCycleAt": now(), "lastStatus": status,
                "consecutiveFailures": failures, "lastPid": os.getpid(),
            }
            if failures >= max_failures:
                next_state["circuitOpenUntil"] = (current + dt.timedelta(minutes=circuit_minutes)).isoformat()
                status = "circuit-open"
            atomic_json(STATE_PATH, next_state)
            diagnostics = write_diagnostics(key_source, steps, status, dailyAutoCommits=daily_auto_commit_count())
            append_event("cycle-finished", status=status, stepCount=len(steps), consecutiveFailures=failures)
            print(json.dumps(diagnostics, ensure_ascii=False, indent=2))

            if args.once or status in {"circuit-open", "failed"}:
                return 1 if status == "failed" else 2 if status == "circuit-open" else 0
            elapsed_minutes = (time.monotonic() - started) / 60
            if args.max_runtime_minutes and elapsed_minutes >= args.max_runtime_minutes:
                return 0
            wait_seconds = args.interval_minutes * 60
            if args.max_runtime_minutes:
                wait_seconds = min(wait_seconds, max(0, (args.max_runtime_minutes - elapsed_minutes) * 60))
            deadline = time.monotonic() + wait_seconds
            while not stop_requested and time.monotonic() < deadline:
                time.sleep(min(1, deadline - time.monotonic()))
        append_event("shutdown-requested")
        return 0
    finally:
        lock.release()


if __name__ == "__main__":
    raise SystemExit(main())

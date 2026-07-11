from __future__ import annotations

import json
import subprocess
from pathlib import Path

from .base_adapter import AdapterCapability, AdapterRequest, BaseAdapter


class CodexAdapter(BaseAdapter):
    provider = "codex"
    requires_output_status = True
    executable_names = ("codex", "codex.exe", "codex.cmd", "codex.ps1")

    def capability(self) -> AdapterCapability:
        executable = self.discover_executable()
        if not executable:
            return AdapterCapability(self.provider, None, False, "unsupported", notes=["codex not found"])
        safe_env = self.safe_environment({})
        completed = subprocess.run(self.command(executable, "exec", "--help"), text=True, capture_output=True, timeout=20, env=safe_env, encoding="utf-8", errors="replace")
        help_text = completed.stdout + completed.stderr
        version = subprocess.run(self.command(executable, "--version"), text=True, capture_output=True, timeout=20, env=safe_env, encoding="utf-8", errors="replace").stdout.strip()
        expected = {
            "noninteractive": "Run Codex non-interactively",
            "stdin": "read from stdin",
            "cwd": "--cd",
            "sandbox": "--sandbox",
            "jsonl": "--json",
            "output_schema": "--output-schema",
            "ephemeral": "--ephemeral",
        }
        features = [name for name, marker in expected.items() if marker in help_text]
        complete = len(features) == len(expected)
        return AdapterCapability(
            self.provider, executable, completed.returncode == 0 and complete, "full-auto" if complete else "unsupported", version=version,
            features=features, notes=[] if complete else ["Required safe automation flags are unavailable"],
        )

    def build_command(self, request: AdapterRequest, executable: str) -> list[str]:
        command = self.command(
            executable, "exec", "-", "--model", request.requested_model,
            "--config", f'model_reasoning_effort="{request.requested_reasoning}"',
            "--sandbox", request.sandbox, "--json", "--ephemeral",
            "--cd", str(request.workdir),
        )
        if request.output_schema:
            command.extend(["--output-schema", str(request.output_schema)])
        return command

    def parse_actual_model(self, stdout: str, requested_model: str) -> str | None:
        for line in stdout.splitlines():
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            model = event.get("model")
            if isinstance(model, str):
                return model
            payload = event.get("response") or event.get("item") or {}
            if isinstance(payload, dict) and isinstance(payload.get("model"), str):
                return payload["model"]
        return None

    def parse_output_status(self, stdout: str) -> str | None:
        for line in stdout.splitlines():
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            item = event.get("item", {})
            if not isinstance(item, dict) or not isinstance(item.get("text"), str):
                continue
            try:
                message = json.loads(item["text"])
            except json.JSONDecodeError:
                continue
            status = message.get("status") if isinstance(message, dict) else None
            if isinstance(status, str):
                return status
        return None

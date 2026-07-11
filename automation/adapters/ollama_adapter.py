from __future__ import annotations

import json
import shutil
import subprocess

from .base_adapter import AdapterCapability, AdapterRequest, BaseAdapter
from quota_supervisor import GENERATION_MODEL_ALLOWLIST, LOCAL_MODEL_ALLOWLIST


LOCAL_REPORT_SCHEMA = json.dumps({
    "type": "object",
    "additionalProperties": False,
    "required": ["status", "summary", "findings", "actual_model"],
    "properties": {
        "status": {"type": "string", "enum": ["passed", "failed"]},
        "summary": {"type": "string", "maxLength": 2000},
        "findings": {"type": "array", "maxItems": 20, "items": {"type": "string", "maxLength": 500}},
        "actual_model": {"type": "string"},
    },
}, separators=(",", ":"))


class OllamaAdapter(BaseAdapter):
    provider = "ollama"
    requires_output_status = True
    executable_names = ("ollama", "ollama.exe")

    def capability(self) -> AdapterCapability:
        executable = self.discover_executable()
        if not executable:
            return AdapterCapability(self.provider, None, False, "unsupported", notes=["ollama not found"])
        completed = subprocess.run(
            [executable, "list"], text=True, capture_output=True, timeout=20,
            env=self.safe_environment({}), encoding="utf-8", errors="replace",
        )
        installed = {
            line.split()[0] for line in completed.stdout.splitlines()[1:] if line.strip()
        }
        models = sorted(installed & LOCAL_MODEL_ALLOWLIST)
        return AdapterCapability(
            self.provider, executable, completed.returncode == 0 and bool(models),
            "local-docs-only" if models else "unsupported", models=models,
            notes=["Local models produce report artifacts only and never satisfy Codex or Antigravity provider requirements."],
        )

    def build_command(self, request: AdapterRequest, executable: str) -> list[str]:
        if request.requested_model not in GENERATION_MODEL_ALLOWLIST:
            raise ValueError(f"Ollama model is not allowlisted: {request.requested_model}")
        return [
            executable, "run", request.requested_model,
            "--format", LOCAL_REPORT_SCHEMA, "--hidethinking", "--think=false", "--nowordwrap",
        ]

    def parse_actual_model(self, stdout: str, requested_model: str) -> str | None:
        return requested_model

    def parse_output_status(self, stdout: str) -> str | None:
        try:
            payload = json.loads(stdout.strip())
        except json.JSONDecodeError:
            return None
        if not isinstance(payload, dict) or set(payload) != {"status", "summary", "findings", "actual_model"}:
            return None
        status = payload.get("status")
        summary = payload.get("summary")
        findings = payload.get("findings")
        actual_model = payload.get("actual_model")
        if status not in {"passed", "failed"}:
            return None
        if not isinstance(summary, str) or len(summary) > 2000:
            return None
        if not isinstance(findings, list) or len(findings) > 20 or any(not isinstance(item, str) or len(item) > 500 for item in findings):
            return None
        if not isinstance(actual_model, str):
            return None
        return status

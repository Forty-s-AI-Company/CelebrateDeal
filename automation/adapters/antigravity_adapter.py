from __future__ import annotations

import json
import subprocess

from .base_adapter import AdapterCapability, AdapterRequest, BaseAdapter


class AntigravityAdapter(BaseAdapter):
    provider = "antigravity"
    requires_output_status = True
    executable_names = ("agy", "agy.exe", "antigravity", "antigravity-cli")

    def capability(self) -> AdapterCapability:
        executable = self.discover_executable()
        if not executable:
            return AdapterCapability(self.provider, None, False, "unsupported", notes=["Antigravity CLI not found"])
        safe_env = self.safe_environment({})
        completed = subprocess.run([executable, "--help"], text=True, capture_output=True, timeout=20, env=safe_env, encoding="utf-8", errors="replace")
        help_text = completed.stdout + completed.stderr
        features = []
        for name, marker in {
            "noninteractive": "--print", "timeout": "--print-timeout", "model": "--model",
            "sandbox": "--sandbox", "conversation": "--conversation", "log_file": "--log-file",
        }.items():
            if marker in help_text:
                features.append(name)
        models: list[str] = []
        try:
            models_output = subprocess.run([executable, "models"], text=True, capture_output=True, timeout=20, env=safe_env, encoding="utf-8", errors="replace")
            if models_output.returncode == 0:
                models = [line.strip() for line in models_output.stdout.splitlines() if line.strip()]
        except (OSError, subprocess.TimeoutExpired):
            pass
        mode = "full-auto" if {"noninteractive", "timeout", "model", "sandbox"}.issubset(features) else "hybrid"
        notes = ["No machine-readable output schema flag; JSON output is prompt-enforced and validated after execution."]
        return AdapterCapability(self.provider, executable, completed.returncode == 0, mode, features=features, models=models, notes=notes)

    def build_command(self, request: AdapterRequest, executable: str) -> list[str]:
        # agy --print consumes the prompt argument, so stdin remains empty to avoid an interactive fallback.
        return [
            executable, "--print", request.prompt, "--print-timeout", f"{request.timeout_seconds}s",
            "--model", request.requested_model, "--sandbox",
        ]

    def run(self, request: AdapterRequest, retries: int = 0):  # type: ignore[override]
        prompt = request.prompt
        request.prompt = "Return only valid JSON. " + prompt
        result = super().run(request, retries)
        request.prompt = prompt
        if result.status == "passed":
            try:
                json.loads(result.stdout.strip())
            except json.JSONDecodeError:
                result.status = "failed"
                result.error = "Antigravity output was not valid JSON"
                result.confidence = "low"
        if result.timed_out and not result.stdout.strip():
            result.mode = "hybrid"
            result.error = "Non-interactive Antigravity smoke timed out; manual login or UI validation is required"
            result.confidence = "high"
        if "login" in (result.stderr + result.stdout).lower() and result.status != "passed":
            result.error = "Antigravity authentication is required"
        return result

    def parse_actual_model(self, stdout: str, requested_model: str) -> str | None:
        # Model-authored JSON is not authoritative runtime metadata.
        return None

    def parse_output_status(self, stdout: str) -> str | None:
        try:
            payload = json.loads(stdout.strip())
        except json.JSONDecodeError:
            return None
        status = payload.get("status") if isinstance(payload, dict) else None
        return status if isinstance(status, str) else None

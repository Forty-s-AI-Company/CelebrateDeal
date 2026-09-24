"""Bounded host diagnostic for the PowerShell runner; never reads credentials."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path


def main() -> None:
    windows = Path(os.environ.get("WINDIR", r"C:\Windows"))
    candidates = {
        "cmd": str(windows / "System32" / "cmd.exe"),
        "windows_powershell": str(windows / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"),
        "path_pwsh": shutil.which("pwsh"),
        "store_pwsh": str(Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WindowsApps" / "pwsh.exe"),
    }
    results: dict[str, object] = {}
    for name, executable in candidates.items():
        result: dict[str, object] = {"executable": executable or "not_found"}
        if not executable or not Path(executable).is_file():
            result["status"] = "NOT_INSTALLED"
            results[name] = result
            continue
        command = ([executable, "/d", "/c", "echo CMD_SMOKE_OK"] if name == "cmd" else
                   [executable, "-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
                    "Write-Output 'PS_SMOKE_OK'; exit 0"])
        with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
            process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr)
            try:
                exit_code = process.wait(timeout=8)
                result.update(status="EXITED", exit_code=exit_code)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=2)
                result.update(status="PROCESS_STILL_RUNNING_AFTER_TIMEOUT", exit_code=None)
            stdout.seek(0)
            stderr.seek(0)
            result.update(stdout=stdout.read(500).decode("utf-8", "replace"),
                          stderr=stderr.read(500).decode("utf-8", "replace"))
        results[name] = result
    print(json.dumps(results, ensure_ascii=True))


if __name__ == "__main__":
    main()

"""Optional bounded, isolated native Codex smoke; never runs in CI."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def main() -> None:
    executable = shutil.which("codex.exe") or shutil.which("codex")
    if not executable:
        print(json.dumps({"status": "CODEX_NOT_INSTALLED"}))
        return
    with tempfile.TemporaryDirectory(prefix="ai-team-native-smoke-") as temporary:
        root = Path(temporary)
        (root / "calc.py").write_text("def add(a, b):\n    return a - b\n", encoding="utf-8")
        (root / "test_calc.py").write_text(
            "import unittest\nfrom calc import add\n\n"
            "class CalcTest(unittest.TestCase):\n"
            "    def test_add(self):\n"
            "        self.assertEqual(add(2, 3), 5)\n", encoding="utf-8")
        subprocess.run(["git", "init", "-q"], cwd=root, check=True, capture_output=True)
        test_cmd = [sys.executable, "-m", "unittest", "discover", "-q"]
        before = subprocess.run(test_cmd, cwd=root, capture_output=True, text=True, timeout=10)
        prompt = ("Fix only calc.py so the existing test_calc.py passes. "
                  "Do not change the test. Run python -m unittest discover -q, "
                  "then briefly report the result. This is an isolated disposable fixture.")
        command = [executable, "exec", "--ephemeral", "--json", "-m", "gpt-6-luna",
                   "-c", 'model_reasoning_effort="high"', "-s", "workspace-write",
                   "-C", str(root), "-"]
        process = subprocess.Popen(command, cwd=root, stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   text=True, encoding="utf-8", errors="replace")
        try:
            stdout, stderr = process.communicate(prompt, timeout=90)
            timed_out = False
        except subprocess.TimeoutExpired:
            process.kill()
            stdout, stderr = process.communicate()
            timed_out = True
        events = []
        for line in stdout.splitlines():
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                events.append("invalid_jsonl")
                continue
            if isinstance(item, dict):
                events.append(item.get("type", "unknown"))
        after = subprocess.run(test_cmd, cwd=root, capture_output=True, text=True, timeout=10)
        code = (root / "calc.py").read_text(encoding="utf-8")
        print(json.dumps({"executable": executable, "exit_code": process.returncode,
                          "timed_out": timed_out, "before_test_exit": before.returncode,
                          "after_test_exit": after.returncode, "calc_fixed": "return a + b" in code,
                          "events": events[-30:],
                          "stderr_flags": {"unknown_model_metadata": "Unknown model" in stderr,
                                           "model_metadata_missing": "metadata" in stderr.lower(),
                                           "permission_denied": "permission denied" in stderr.lower()},
                          "source_changed": code != "def add(a, b):\n    return a - b\n"},
                         ensure_ascii=True))


if __name__ == "__main__":
    main()

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from autonomy import _run, baseline, discover, triage


class AutonomyTest(unittest.TestCase):
    @patch("autonomy.baseline", return_value={"fingerprint": "baseline", "status": []})
    @patch("autonomy.shutil.which", return_value=None)
    @patch("autonomy.subprocess.run")
    def test_empty_queue_discovery_is_successful_without_ripgrep(self, subprocess_mock, _which_mock, _baseline_mock) -> None:
        subprocess_mock.return_value.stdout = ""
        runner = lambda _root, command, _timeout: {"command": command, "status": "passed", "exitCode": 0, "stdout": "", "stderr": ""}
        payload = discover(__import__("pathlib").Path.cwd(), runner=runner)
        self.assertEqual(payload["issues"], [])
        self.assertEqual(payload["todoCount"], 0)
        subprocess_mock.assert_not_called()
        self.assertTrue(all(value == 0 for value in payload["counts"].values()))

    def test_triage_rebuilds_controls_and_rejects_injected_provider_command(self) -> None:
        payload = triage({"issues": [{
            "id": "DOC-1", "title": "Fix docs", "description": "Safe",
            "severity": "P3", "domain": "docs", "affectedFiles": ["docs/ai-team/a.md"],
            "provider": "attacker", "role": "release-manager", "command": "git push --force",
            "write_paths": ["src/**"], "validation": ["npm run evil"],
        }]})
        task = payload["tasks"][0]
        self.assertEqual(task["type"], "release")
        self.assertTrue(task["auto_execute"])
        self.assertEqual(task["validation"], ["npm run automation:test", "npm run ai:validate"])
        self.assertIn("provider", task["ignored_control_fields"])

    def test_high_risk_path_is_not_auto_executable(self) -> None:
        payload = triage({"issues": [{
            "id": "AUTH-1", "severity": "P2", "domain": "docs",
            "affectedFiles": ["src/lib/auth.ts"],
        }]})
        task = payload["tasks"][0]
        self.assertFalse(task["auto_execute"])
        self.assertTrue(task["manual_merge_required"])
        self.assertEqual(task["status"], "awaiting-human-approval")

    def test_supply_chain_paths_are_not_auto_executable(self) -> None:
        for path in [".github/workflows/ci.yml", ".agents/skills/a.md", "automation/policy.py", "package.json"]:
            payload = triage({"issues": [{
                "id": "CTRL-1", "severity": "P3", "domain": "docs", "affectedFiles": [path],
            }]})
            self.assertFalse(payload["tasks"][0]["auto_execute"])

    @patch("autonomy.subprocess.run")
    def test_child_process_receives_allowlisted_environment_without_attestation_key(self, run_mock) -> None:
        run_mock.return_value.returncode = 0
        run_mock.return_value.stdout = ""
        run_mock.return_value.stderr = ""
        with patch.dict(os.environ, {"AI_PIPELINE_ATTESTATION_KEY": "canary", "PATH": "safe"}, clear=False):
            _run(Path.cwd(), ["git", "status"])
        child_env = run_mock.call_args.kwargs["env"]
        self.assertNotIn("AI_PIPELINE_ATTESTATION_KEY", child_env)
        self.assertEqual(child_env["PATH"], "safe")

    def test_untracked_content_changes_baseline_fingerprint(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            __import__("subprocess").run(["git", "init"], cwd=root, check=True, capture_output=True)
            __import__("subprocess").run(["git", "config", "user.email", "test@example.invalid"], cwd=root, check=True, capture_output=True)
            __import__("subprocess").run(["git", "config", "user.name", "Test"], cwd=root, check=True, capture_output=True)
            seed = root / "seed.txt"
            seed.write_text("seed", encoding="utf-8")
            __import__("subprocess").run(["git", "add", "seed.txt"], cwd=root, check=True, capture_output=True)
            __import__("subprocess").run(["git", "commit", "-m", "seed"], cwd=root, check=True, capture_output=True)
            path = root / "note.md"
            path.write_text("one", encoding="utf-8")
            first = baseline(root)["fingerprint"]
            path.write_text("two", encoding="utf-8")
            second = baseline(root)["fingerprint"]
            self.assertNotEqual(first, second)

    def test_p0_and_p1_never_auto_execute(self) -> None:
        payload = triage({"issues": [
            {"id": "P0-1", "severity": "P0", "domain": "test", "affectedFiles": []},
            {"id": "P1-1", "severity": "P1", "domain": "automation", "affectedFiles": []},
        ]})
        self.assertTrue(all(task["auto_execute"] is False for task in payload["tasks"]))


if __name__ == "__main__":
    unittest.main()

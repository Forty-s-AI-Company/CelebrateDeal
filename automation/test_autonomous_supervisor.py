import json
import os
import tempfile
import unittest
from pathlib import Path
from subprocess import CompletedProcess
from unittest.mock import patch

import autonomous_supervisor as supervisor

KEY = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"


class AutonomousSupervisorTest(unittest.TestCase):
    def test_windows_console_output_is_reconfigured_to_utf8(self) -> None:
        with patch.object(supervisor.sys.stdout, "reconfigure") as stdout_mock, patch.object(supervisor.sys.stderr, "reconfigure") as stderr_mock:
            with patch("autonomous_supervisor.InstanceLock.acquire", return_value=False), patch("autonomous_supervisor.write_diagnostics", return_value={}):
                supervisor.main(["--once"])
        stdout_mock.assert_called_once_with(encoding="utf-8", errors="replace")
        stderr_mock.assert_called_once_with(encoding="utf-8", errors="replace")

    def test_cli_timing_defaults_and_overrides(self) -> None:
        defaults = supervisor.build_parser().parse_args([])
        self.assertFalse(defaults.once)
        self.assertEqual(defaults.interval_minutes, 60)
        self.assertEqual(defaults.max_runtime_minutes, 0)
        custom = supervisor.build_parser().parse_args(["--once", "--interval-minutes", "15", "--max-runtime-minutes", "120"])
        self.assertTrue(custom.once)
        self.assertEqual(custom.interval_minutes, 15)
        self.assertEqual(custom.max_runtime_minutes, 120)

    def test_coordinator_environment_forwards_only_attestation_key_and_allowlist(self) -> None:
        with patch.dict(os.environ, {
            "PATH": "safe", "AI_PIPELINE_ATTESTATION_KEY": KEY, "PAYUNI_HASH_KEY": "never-forward",
        }, clear=True):
            environment = supervisor.coordinator_environment(KEY)
        self.assertEqual(environment["AI_PIPELINE_ATTESTATION_KEY"], KEY)
        self.assertEqual(environment["PATH"], "safe")
        self.assertNotIn("PAYUNI_HASH_KEY", environment)

    @patch("autonomous_supervisor.read_key", return_value=KEY)
    def test_attestation_key_falls_back_to_credential_manager(self, read_mock) -> None:
        with patch.dict(os.environ, {}, clear=True), patch("autonomous_supervisor.os.name", "nt"):
            key, source = supervisor.load_attestation_key()
        self.assertEqual(key, KEY)
        self.assertEqual(source, "windows-credential-manager")
        read_mock.assert_called_once()

    def test_instance_lock_rejects_live_owner_and_recovers_stale_owner(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "supervisor.lock"
            path.write_text(json.dumps({"pid": 123}), encoding="utf-8")
            with patch("autonomous_supervisor.process_exists", return_value=True):
                self.assertFalse(supervisor.InstanceLock(path).acquire())
            with patch("autonomous_supervisor.process_exists", return_value=False):
                lock = supervisor.InstanceLock(path)
                self.assertTrue(lock.acquire())
                lock.release()
            self.assertFalse(path.exists())

    @patch("autonomous_supervisor.subprocess.run")
    def test_unexpected_child_exit_is_failed(self, run_mock) -> None:
        run_mock.return_value = CompletedProcess([], 1, KEY, f"broken {KEY.upper()}")
        result = supervisor.run_step("discovery", ["discover"], KEY)
        self.assertEqual(result.status, "failed")
        self.assertNotIn(KEY, result.stdout.lower())
        self.assertNotIn(KEY, result.stderr.lower())
        self.assertNotIn(KEY, " ".join(run_mock.call_args.args[0]))
        self.assertEqual(run_mock.call_args.kwargs["env"]["AI_PIPELINE_ATTESTATION_KEY"], KEY)

    @patch("autonomous_supervisor.run_step")
    @patch("autonomous_supervisor.shutil.disk_usage")
    def test_quota_wait_short_circuits_quality_cycle(self, disk_mock, run_mock) -> None:
        disk_mock.return_value.free = supervisor.MIN_DISK_BYTES + 1
        run_mock.side_effect = [
            supervisor.StepResult("quota-status", "passed", 0, 0, '{"status": "waiting-for-quota"}', ""),
            supervisor.StepResult("quota-supervisor", "conditional", 2, 0, "", ""),
        ]
        status, steps = supervisor.run_cycle(KEY, "process-environment")
        self.assertEqual(status, "waiting-for-quota")
        self.assertEqual([step.name for step in steps], ["quota-status", "quota-supervisor"])

    @patch("autonomous_supervisor.shutil.disk_usage")
    def test_low_disk_fails_before_any_model_or_quality_step(self, disk_mock) -> None:
        disk_mock.return_value.free = supervisor.MIN_DISK_BYTES - 1
        with patch("autonomous_supervisor.run_step") as step_mock:
            status, steps = supervisor.run_cycle(None, "unavailable")
        self.assertEqual(status, "failed")
        self.assertEqual(steps[0].name, "disk-space")
        step_mock.assert_not_called()

    @patch("autonomous_supervisor.subprocess.run", return_value=CompletedProcess([], 128, "", "broken repo"))
    def test_commit_quota_query_fails_closed(self, _run_mock) -> None:
        self.assertIsNone(supervisor.daily_auto_commit_count())

    @patch("autonomous_supervisor.write_diagnostics", return_value={"status": "already-running"})
    @patch("autonomous_supervisor.InstanceLock.acquire", return_value=False)
    def test_second_supervisor_instance_exits_without_running_cycle(self, _acquire_mock, _diagnostic_mock) -> None:
        with patch("autonomous_supervisor.run_cycle") as cycle_mock:
            self.assertEqual(supervisor.main(["--once"]), 3)
        cycle_mock.assert_not_called()

    @patch("autonomous_supervisor.append_event")
    @patch("autonomous_supervisor.write_diagnostics", return_value={"status": "passed"})
    @patch("autonomous_supervisor.atomic_json")
    @patch("autonomous_supervisor.load_json", return_value={"consecutiveFailures": 0})
    @patch("autonomous_supervisor.load_attestation_key", return_value=(KEY, "process-environment"))
    @patch("autonomous_supervisor.run_cycle", return_value=("passed", []))
    @patch("autonomous_supervisor.InstanceLock.release")
    @patch("autonomous_supervisor.InstanceLock.acquire", return_value=True)
    def test_once_runs_exactly_one_cycle(self, _acquire, _release, cycle_mock, _key, _load, _atomic, _diagnostic, _event) -> None:
        self.assertEqual(supervisor.main(["--once", "--interval-minutes", "60"]), 0)
        cycle_mock.assert_called_once()


if __name__ == "__main__":
    unittest.main()

import argparse
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pipeline_cli
from pipeline_engine import build_receipt, object_digest, pipeline_digest, start_stage


KEY = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"


def bridge_state(root: Path) -> dict:
    stages = [{
        "stageId": "01-repair", "roleId": "repair-engineer", "provider": "codex",
        "mode": "workspace-write", "required": True, "status": "pending", "attempts": 0,
        "dependsOn": [], "artifactPaths": [], "receipt": None, "error": None,
    }]
    snapshot = {"id": "QA-1", "type": "repair", "prompt": "policy-built repair", "qaEvidence": [{"issueId": "QA-1"}]}
    return {
        "schemaVersion": 2, "runId": "bridge-run", "revision": 1, "pipelineId": "task:QA-1",
        "sourceRevision": "a" * 40, "sourceFingerprint": "b" * 64,
        "pipelineDigest": pipeline_digest(stages), "status": "planned", "mode": "hybrid",
        "currentStage": None, "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z",
        "milestone": None, "taskId": "QA-1", "taskType": "repair", "taskDomain": "repair",
        "taskSnapshot": snapshot, "taskDigest": object_digest(snapshot),
        "executionBranch": None, "executionWorktree": None, "outputRevision": None, "stages": stages,
    }


class PipelineBridgeTest(unittest.TestCase):
    @patch.dict("os.environ", {"AI_PIPELINE_ATTESTATION_KEY": KEY}, clear=False)
    def test_workspace_write_stage_uses_isolated_executor_and_attests_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            runtime = root / "reports" / "ai-team" / "runtime"
            runtime.mkdir(parents=True)
            state_path = root / "pipeline-state.json"
            state_path.write_text(json.dumps(bridge_state(root)), encoding="utf-8")
            result = {
                "status": "passed", "commit": "1" * 40, "approvedTree": "2" * 40,
                "validationLogHash": "3" * 64,
                "stagedSecretScan": {"status": "passed", "sha256": "4" * 64},
                "branch": "codex/automation/qa-1", "worktree": str(root / "isolated"),
            }
            (root / "isolated").mkdir()
            with patch.object(pipeline_cli, "ROOT", root), patch.object(pipeline_cli, "RUNTIME", runtime), patch.object(pipeline_cli, "PIPELINE_STATE", state_path), patch("orchestrator.execute_isolated_stage", return_value=result) as executor:
                code = pipeline_cli.state_command(argparse.Namespace(command="resume"))
            self.assertEqual(code, 0)
            completed = json.loads(state_path.read_text(encoding="utf-8"))
            receipt = completed["stages"][0]["receipt"]
            self.assertEqual(completed["status"], "completed")
            self.assertEqual(receipt["commitSha"], "1" * 40)
            self.assertEqual(receipt["approvedTree"], "2" * 40)
            self.assertEqual(receipt["validationLogHash"], "3" * 64)
            self.assertEqual(receipt["stagedSecretScan"]["status"], "passed")
            self.assertEqual(receipt["qaEvidence"], [{"issueId": "QA-1"}])
            executor.assert_called_once()

    @patch.dict("os.environ", {"AI_PIPELINE_ATTESTATION_KEY": KEY}, clear=False)
    def test_crash_recovery_replays_only_attested_receipt(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            runtime = root / "reports" / "ai-team" / "runtime"
            runtime.mkdir(parents=True)
            state_path = root / "pipeline-state.json"
            running = start_stage(bridge_state(root), "01-repair")
            artifact = runtime / "bridge-run-01-repair.json"
            artifact.write_text('{"status":"passed"}', encoding="utf-8")
            evidence = {
                "commitSha": "1" * 40, "approvedTree": "2" * 40, "validationLogHash": "3" * 64,
                "stagedSecretScan": {"status": "passed", "sha256": "4" * 64}, "qaEvidence": [],
            }
            receipt = build_receipt(running, "01-repair", "completed", [str(artifact.relative_to(root))], root, execution_evidence=evidence, attestation_key=KEY)
            receipt_path = runtime / f"bridge-run-01-repair-a{running['stages'][0]['attempts']}-{running['stages'][0]['attemptNonce']}.receipt.json"
            receipt_path.write_text(json.dumps(receipt), encoding="utf-8")
            state_path.write_text(json.dumps(running), encoding="utf-8")
            with patch.object(pipeline_cli, "ROOT", root), patch.object(pipeline_cli, "RUNTIME", runtime), patch.object(pipeline_cli, "PIPELINE_STATE", state_path):
                code = pipeline_cli.state_command(argparse.Namespace(command="resume"))
            self.assertEqual(code, 0)
            self.assertEqual(json.loads(state_path.read_text(encoding="utf-8"))["status"], "completed")


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import importlib.util
import json
import os
import tempfile
import unittest
import uuid
from pathlib import Path


HERE = Path(__file__).resolve().parent
SERVER = HERE / "server.py"
ROUTER = HERE.parent / "config" / "router.json"


def load_server(root: Path):
    previous_root = os.environ.get("AI_TEAM_ROOT")
    previous_config = os.environ.get("AI_TEAM_CONFIG")
    os.environ["AI_TEAM_ROOT"] = str(root)
    os.environ["AI_TEAM_CONFIG"] = str(ROUTER)
    try:
        name = f"ai_team_lite_test_{uuid.uuid4().hex}"
        spec = importlib.util.spec_from_file_location(name, SERVER)
        if spec is None or spec.loader is None:
            raise AssertionError("cannot load server module")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        if previous_root is None:
            os.environ.pop("AI_TEAM_ROOT", None)
        else:
            os.environ["AI_TEAM_ROOT"] = previous_root
        if previous_config is None:
            os.environ.pop("AI_TEAM_CONFIG", None)
        else:
            os.environ["AI_TEAM_CONFIG"] = previous_config


class LiteRouterTest(unittest.TestCase):
    def test_router_json_is_lite(self) -> None:
        config = json.loads(ROUTER.read_text(encoding="utf-8-sig"))
        self.assertEqual(config["version"], "5.3-lite")
        self.assertEqual(config["router"]["external_execution"], False)
        self.assertEqual(config["gemini_profiles"]["fast"]["model"], "gemini-3.6-flash-high")
        self.assertEqual(config["gemini_profiles"]["deep"]["model"], "gemini-3.1-pro-high")

    def test_server_has_only_allowed_tools_and_no_external_runtime(self) -> None:
        source = SERVER.read_text(encoding="utf-8")
        self.assertEqual(source.count("@mcp.tool()"), 7)
        for forbidden in ("import subprocess", "urllib", "Popen", "worktree", "urlopen"):
            self.assertNotIn(forbidden, source)

    def test_router_status_is_config_only(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            module = load_server(Path(temporary))
            status = module.router_status()
            self.assertEqual(status["probe_mode"], "config_only")
            self.assertFalse(status["external_execution"])
            self.assertEqual(len(status["allowed_tools"]), 7)

    def test_route_task_uses_fixed_routes_without_execution(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            module = load_server(Path(temporary))
            cases = {
                "planning": "planner",
                # v5.3 Lite 將唯讀探索與分析固定交給明確的 Gemini wrapper。
                "find_files": "Invoke-AgyFast.ps1",
                "root_cause": "Invoke-AgyDeep.ps1",
                "bug_fix": "worker",
                "hard_debugging": "worker-deep",
                "security_review": "Invoke-AgyDeep.ps1",
                "summarize": "Invoke-AgyFast.ps1",
                "deep_review": "Invoke-AgyDeep.ps1",
            }
            for task_type, target in cases.items():
                result = module.route_task("safe task", task_type)
                self.assertEqual(result["target"], target)
                self.assertEqual(result["execution"], "recommendation_only")

    def test_goal_lifecycle(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            module = load_server(Path(temporary))
            created = module.goal_bootstrap("lite-test", "Lite test", ["phase-one"])
            self.assertEqual(created["status"], "created")
            self.assertEqual(module.goal_resume()["status"], "resumable")
            checkpoint = module.goal_checkpoint("phase-one", "verified", True, "", ["unit test"])
            self.assertEqual(checkpoint["status"], "checkpointed")
            self.assertEqual(module.goal_resume()["status"], "ready_to_finalize")
            self.assertEqual(module.goal_finalize("done")["status"], "completed")

    def test_goal_does_not_overwrite_active_state(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            module = load_server(Path(temporary))
            module.goal_bootstrap("first", "First", ["phase"])
            result = module.goal_bootstrap("second", "Second", ["phase"])
            self.assertEqual(result["status"], "active_goal_exists")


if __name__ == "__main__":
    unittest.main()

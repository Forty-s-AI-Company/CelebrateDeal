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
        self.assertEqual(config["version"], "5.4-lite")
        self.assertEqual(config["router"]["external_execution"], False)
        self.assertEqual(config["router"]["reasoning_selection"], "adaptive_lowest_sufficient")
        self.assertEqual(config["gemini_profiles"]["fast"]["model"], "gemini-3.8-flash-high")
        self.assertEqual(config["gemini_profiles"]["deep"]["model"], "gemini-3.1-pro-high")
        self.assertEqual(config["agents"]["reviewer"]["model"], "gpt-5.6-terra")
        self.assertEqual(config["agents"]["reviewer"]["sandbox_mode"], "read-only")
        self.assertEqual(config["agents"]["reviewer"]["availability"], "runtime_dependent")
        self.assertEqual(config["agents"]["worker"]["model"], "gpt-5.6-luna")
        self.assertEqual(config["agents"]["worker"]["reasoning_effort"], "high")
        self.assertEqual(config["agents"]["worker"]["reasoning_lock"], "high")
        self.assertNotIn("worker-critical", config["agents"])
        self.assertNotIn("luna_critical_worker", config["codex_profiles"])
        self.assertEqual(config["codex_profiles"]["luna_worker"]["model"], "gpt-5.6-luna")
        self.assertEqual(config["codex_profiles"]["luna_worker"]["sandbox_mode"], "workspace-write")
        self.assertEqual(config["agents"]["explorer"]["luna_escalation"]["model"], "gpt-5.6-luna")
        self.assertEqual(config["agents"]["analyst"]["luna_escalation"]["model"], "gpt-5.6-luna")
        self.assertEqual(config["plan_review"]["model"], "claude-sonnet-4.6-thinking")
        self.assertFalse(config["plan_review"]["required"])
        self.assertTrue(config["plan_review"]["skip_routine_tasks"])
        self.assertEqual(len(config["plan_review"]["fallback_chain"]), 4)
        self.assertEqual(config["plan_review"]["quota_policy"], "skip_if_unavailable")
        self.assertEqual(config["plan_review"]["availability"], "runtime_dependent")
        self.assertTrue(config["git_policy"]["auto_push"]["enabled"])
        self.assertTrue(config["git_policy"]["auto_merge"]["enabled"])
        self.assertFalse(config["git_policy"]["production_deploy"]["enabled"])
        self.assertEqual(config["codex_profiles"]["luna"]["model"], "gpt-5.6-luna")
        self.assertEqual(config["codex_profiles"]["luna"]["reasoning_effort"], "high")
        self.assertEqual(config["codex_profiles"]["luna"]["reasoning_minimum"], "high")
        self.assertEqual(config["codex_profiles"]["luna"]["reasoning_maximum"], "max")
        self.assertEqual(
            config["reasoning_policy"]["models"]["gpt-5.6-sol"],
            {"minimum": "low", "maximum": "xhigh", "default": "high"},
        )
        self.assertEqual(
            config["reasoning_policy"]["models"]["gpt-5.6-terra"],
            {"minimum": "low", "maximum": "xhigh", "default": "medium"},
        )
        self.assertTrue(config["codex_profiles"]["luna"]["fallback_only"])
        self.assertEqual(config["codex_profiles"]["luna"]["availability"], "runtime_dependent")
        self.assertEqual(
            [item["profile"] for item in config["fallback_chains"]["gemini_fast"]["profiles"]],
            ["gemini_fast", "gemini_deep", "codex_luna"],
        )
        self.assertEqual(config["fallback_chains"]["gemini_fast"]["max_total_attempts"], 2)

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
            self.assertEqual(status["codex_profiles"]["luna_worker"]["model"], "gpt-5.6-luna")
            self.assertEqual(status["reasoning_policy"]["strategy"], "adaptive_lowest_sufficient")
            self.assertTrue(status["git_policy"]["auto_merge"]["enabled"])
            self.assertEqual(status["plan_review"]["profile"], "claude_plan_review")

    def test_route_task_uses_fixed_routes_without_execution(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            module = load_server(Path(temporary))
            cases = {
                "planning": "planner",
                # Lite router 的預設探索／分析仍由明確的 AGY wrapper 執行，必要時再升級唯讀 Luna。
                "find_files": "Invoke-AgyFast.ps1",
                "root_cause": "Invoke-AgyDeep.ps1",
                "bug_fix": "worker",
                "hard_debugging": "worker-deep",
                "security_review": "reviewer",
                "plan_review": "Invoke-AgyPlanReview.ps1",
                "summarize": "Invoke-AgyFast.ps1",
                "deep_review": "Invoke-AgyDeep.ps1",
            }
            for task_type, target in cases.items():
                result = module.route_task("safe task", task_type)
                self.assertEqual(result["target"], target)
                self.assertEqual(result["execution"], "recommendation_only")
            fallback = module.route_task("summarize safely", "summarize")
            self.assertEqual(
                [item["profile"] for item in fallback["fallback_chain"]["profiles"]],
                ["gemini_fast", "gemini_deep", "codex_luna"],
            )
            plan = module.route_task("plan a critical payment flow", "planning")
            self.assertEqual(plan["post_plan_review"]["profile"], "claude_plan_review")
            self.assertFalse(plan["post_plan_review"]["required"])
            worker = module.route_task("implement a bounded feature", "bug_fix")
            self.assertEqual(worker["model"], "gpt-5.6-luna")
            self.assertEqual(worker["profile"], "luna_worker")
            self.assertEqual(worker["reasoning_effort"], "high")
            self.assertEqual(worker["reasoning_lock"], "high")
            complex_explore = module.route_task("complex dependency exploration", "find_files", "complex")
            self.assertEqual(complex_explore["target"], "Invoke-AgyFast.ps1")
            self.assertEqual(complex_explore["escalation"]["model"], "gpt-5.6-luna")
            self.assertEqual(complex_explore["escalation"]["sandbox_mode"], "read-only")
            self.assertEqual(complex_explore["escalation"]["reasoning_effort"], "xhigh")
            routine_explore = module.route_task("read-only lookup", "find_files")
            self.assertIsNone(routine_explore["escalation"])
            critical_analysis = module.route_task("critical security root cause", "root_cause", "critical")
            self.assertEqual(critical_analysis["escalation"]["model"], "gpt-5.6-luna")
            self.assertEqual(critical_analysis["escalation"]["reasoning_effort"], "max")
            routine_review = module.route_task("routine security review", "security_review")
            critical_review = module.route_task("critical security review", "security_review", "critical")
            self.assertEqual(routine_review["model"], "gpt-5.6-terra")
            self.assertEqual(routine_review["reasoning_effort"], "medium")
            self.assertEqual(critical_review["model"], "gpt-5.6-terra")
            self.assertEqual(critical_review["reasoning_effort"], "xhigh")

    def test_native_reasoning_is_adaptive_and_bounded(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            module = load_server(Path(temporary))
            trivial = module.route_task("fix typo only", "bug_fix")
            routine = module.route_task("implement a bounded form field", "bug_fix")
            complex_task = module.route_task("cross file fix for a state transition", "cross_file_fix")
            critical = module.route_task("cross-domain payment security boundary", "hard_debugging")
            planner = module.route_task("plan a multi-step product flow", "planning")
            other_model = module.route_task("critical browser QA", "browser_qa", "critical")

            self.assertEqual((trivial["difficulty"], trivial["reasoning_effort"]), ("trivial", "high"))
            self.assertEqual((routine["difficulty"], routine["reasoning_effort"]), ("routine", "high"))
            self.assertEqual((complex_task["difficulty"], complex_task["reasoning_effort"]), ("complex", "high"))
            self.assertEqual((critical["difficulty"], critical["reasoning_effort"]), ("critical", "xhigh"))
            self.assertEqual((planner["difficulty"], planner["reasoning_effort"]), ("complex", "high"))
            self.assertEqual(other_model["reasoning_effort"], "high")
            self.assertIsNone(other_model["reasoning_bounds"])

            luna_effort, luna_difficulty, luna_bounds = module.adaptive_reasoning_recommendation(
                {"model": "gpt-5.6-luna", "reasoning_effort": "high"},
                "release acceptance after repeated failures",
                "complex_implementation",
                "critical",
                module.read_config(),
            )
            self.assertEqual((luna_difficulty, luna_effort), ("critical", "max"))
            self.assertEqual(luna_bounds["minimum"], "high")
            self.assertEqual(luna_bounds["maximum"], "max")

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

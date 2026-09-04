"""AI Team Lite v5.4 的短時間、純本機狀態 MCP。

本 server 不啟動外部程序、不連網，也不代替 Codex Desktop 執行任務。
"""

from __future__ import annotations

import datetime as dt
import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any

from mcp.server.fastmcp import FastMCP


ROOT = Path(os.environ.get("AI_TEAM_ROOT", Path.cwd())).resolve()
CONFIG_PATH = Path(
    os.environ.get("AI_TEAM_CONFIG", ROOT / ".ai-team" / "config" / "router.json")
).resolve()
STATE_DIR = ROOT / ".ai-team" / "state"
LOG_DIR = ROOT / ".ai-team" / "logs"
STATE_PATH = STATE_DIR / "goal-state.json"
GOAL_LOG_PATH = LOG_DIR / "goal-progress.md"
MCP_NAME = "ai_team_router"
mcp = FastMCP(MCP_NAME)

SENSITIVE_PATTERN = re.compile(
    r"(?:api[_ -]?key|token|secret|password|private[_ -]?key|authorization)\s*[:=]",
    re.IGNORECASE,
)

ROUTES: dict[str, dict[str, Any]] = {
    "planning": {
        "target": "planner",
        "provider": "native_agent",
        "model": "gpt-5.6-sol",
        "reasoning_effort": "high",
    },
    "explore": {
        "target": "Invoke-AgyFast.ps1",
        "provider": "gemini_wrapper",
        "model": "gemini-3.8-flash-high",
        "reasoning_effort": "high",
    },
    "analyze": {
        "target": "Invoke-AgyDeep.ps1",
        "provider": "gemini_wrapper",
        "model": "gemini-3.1-pro-high",
        "reasoning_effort": "high",
    },
    "implement": {
        "target": "worker",
        "profile": "luna_worker",
        "provider": "native_agent",
        "model": "gpt-5.6-luna",
        "reasoning_effort": "high",
        "reasoning_lock": "high",
    },
    "complex_implementation": {
        "target": "worker-deep",
        "provider": "native_agent",
        "model": "gpt-5.6-terra",
        "reasoning_effort": "high",
    },
    "review": {
        "target": "reviewer",
        "provider": "native_agent",
        "model": "gpt-5.6-terra",
        "reasoning_effort": "high",
    },
    "plan_review": {
        "target": "Invoke-AgyPlanReview.ps1",
        "provider": "agy_wrapper",
        "model": "claude-sonnet-4.6-thinking",
        "reasoning_effort": "high",
    },
    "gemini_fast": {
        "target": "Invoke-AgyFast.ps1",
        "provider": "gemini_wrapper",
        "model": "gemini-3.8-flash-high",
        "reasoning_effort": "high",
    },
    "gemini_deep": {
        "target": "Invoke-AgyDeep.ps1",
        "provider": "gemini_wrapper",
        "model": "gemini-3.1-pro-high",
        "reasoning_effort": "high",
    },
}

ALIASES = {
    "major_planning": "planning",
    "architecture": "planning",
    "find_files": "explore",
    "trace_flow": "explore",
    "root_cause": "analyze",
    "dependency_analysis": "analyze",
    "small_feature": "implement",
    "bug_fix": "implement",
    "cross_file_fix": "complex_implementation",
    "hard_debugging": "complex_implementation",
    "security_review": "review",
    "regression_review": "review",
    "plan_acceptance": "plan_review",
    "plan_review": "plan_review",
    "claude_plan_review": "plan_review",
    "summarize": "gemini_fast",
    "classify": "gemini_fast",
    "log_summary": "gemini_fast",
    "browser_qa": "gemini_fast",
    "e2e": "gemini_fast",
    "ui_validation": "gemini_fast",
    "quick_second_opinion": "gemini_fast",
    "deep_review": "gemini_deep",
    "cross_file_second_opinion": "gemini_deep",
    "complex_validation": "gemini_deep",
}

DIFFICULTY_LEVELS = ("trivial", "routine", "complex", "critical")
NATIVE_REASONING_BY_DIFFICULTY = {
    "gpt-5.6-sol": {
        "trivial": "low",
        "routine": "medium",
        "complex": "high",
        "critical": "xhigh",
    },
    "gpt-5.6-terra": {
        "trivial": "low",
        "routine": "medium",
        "complex": "high",
        "critical": "xhigh",
    },
    "gpt-5.6-luna": {
        "trivial": "high",
        "routine": "high",
        "complex": "xhigh",
        "critical": "max",
    },
}
CRITICAL_TASK_TERMS = (
    "production",
    "release acceptance",
    "security boundary",
    "payment",
    "refund",
    "payout",
    "migration",
    "data loss",
    "cross-domain",
    "正式環境",
    "金流",
    "退款",
    "撥款",
    "資料遺失",
    "跨域",
)
TRIVIAL_TASK_TERMS = (
    "typo",
    "format only",
    "rename only",
    "single-line",
    "read-only lookup",
    "錯字",
    "只改格式",
    "只改名稱",
    "單行",
    "唯讀查找",
)


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def ensure_not_sensitive_text(value: str) -> None:
    if SENSITIVE_PATTERN.search(value):
        raise ValueError("輸入疑似包含敏感憑證，Lite MCP 拒絕保存或路由")


def read_config() -> dict[str, Any]:
    try:
        value = json.loads(CONFIG_PATH.read_text(encoding="utf-8-sig"))
    except FileNotFoundError:
        return {"version": "missing", "router": {}}
    if not isinstance(value, dict):
        raise ValueError("router.json 必須是 JSON object")
    return value


def atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=path.parent, delete=False
    ) as handle:
        handle.write(content)
        temporary = Path(handle.name)
    temporary.replace(path)


def append_goal_log(message: str) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    with GOAL_LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(f"- {utc_now()} {message}\n")


def read_goal_state() -> dict[str, Any] | None:
    if not STATE_PATH.exists():
        return None
    value = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("goal-state.json 必須是 JSON object")
    return value


def write_goal_state(state: dict[str, Any]) -> dict[str, Any]:
    state["updated_at"] = utc_now()
    atomic_write(STATE_PATH, json.dumps(state, ensure_ascii=False, indent=2) + "\n")
    return state


def normalized_task_type(task_summary: str, task_type: str) -> str:
    candidate = (task_type or "").strip().lower().replace("-", "_").replace(" ", "_")
    if candidate in ROUTES:
        return candidate
    if candidate in ALIASES:
        return ALIASES[candidate]
    summary = task_summary.lower()
    keyword_routes = (
        ("plan_review", ("plan review", "plan-review", "claude sonnet", "規劃複審", "計畫複審")),
        ("gemini_deep", ("deep review", "cross file", "second opinion", "complex validation")),
        ("gemini_fast", ("summar", "classif", "log", "browser", "e2e", "ui validation")),
        ("complex_implementation", ("hard debugging", "cross file fix", "complex implementation")),
        ("review", ("review", "security", "regression")),
        ("planning", ("plan", "architecture")),
        ("analyze", ("analy", "root cause", "dependency")),
        ("implement", ("implement", "bug fix", "feature")),
    )
    for route, keywords in keyword_routes:
        if any(keyword in summary for keyword in keywords):
            return route
    return "explore"


def inferred_difficulty(task_summary: str, route: str, requested: str = "auto") -> str:
    candidate = requested.strip().lower().replace("-", "_").replace(" ", "_")
    if candidate in DIFFICULTY_LEVELS:
        return candidate

    summary = task_summary.lower()
    if any(term in summary for term in CRITICAL_TASK_TERMS):
        return "critical"
    if any(term in summary for term in TRIVIAL_TASK_TERMS):
        return "trivial"
    if route in {"planning", "complex_implementation", "plan_review"}:
        return "complex"
    return "routine"


def adaptive_reasoning_recommendation(
    recommendation: dict[str, Any],
    task_summary: str,
    route: str,
    requested_difficulty: str,
    config: dict[str, Any],
) -> tuple[str, str, dict[str, str] | None]:
    model = recommendation["model"]
    difficulty = inferred_difficulty(task_summary, route, requested_difficulty)
    effort_map = NATIVE_REASONING_BY_DIFFICULTY.get(model)
    policy = config.get("reasoning_policy", {}).get("models", {}).get(model)
    if effort_map is None or not isinstance(policy, dict):
        return recommendation["reasoning_effort"], difficulty, None

    bounds = {
        "strategy": str(config.get("reasoning_policy", {}).get("strategy", "adaptive_lowest_sufficient")),
        "minimum": str(policy.get("minimum", "")),
        "maximum": str(policy.get("maximum", "")),
        "default": str(policy.get("default", "")),
    }
    locked_effort = recommendation.get("reasoning_lock")
    if locked_effort in {"low", "medium", "high", "xhigh", "max"}:
        return str(locked_effort), difficulty, bounds
    return effort_map[difficulty], difficulty, bounds


def luna_escalation_recommendation(
    config: dict[str, Any],
    route: str,
    task_summary: str,
    difficulty: str,
) -> dict[str, Any] | None:
    """回傳 Explorer／Analyst 的唯讀 Luna 升級建議，不直接執行 agent。"""
    agent_key = {"explore": "explorer", "analyze": "analyst"}.get(route)
    if agent_key is None:
        return None
    agent_config = config.get("agents", {}).get(agent_key, {})
    escalation = agent_config.get("luna_escalation") if isinstance(agent_config, dict) else None
    if not isinstance(escalation, dict) or not escalation.get("enabled"):
        return None
    trigger_difficulties = escalation.get("trigger_difficulties", [])
    if difficulty not in trigger_difficulties:
        return None

    recommendation = dict(escalation)
    recommendation["target"] = "luna_readonly_escalation"
    effort, _, bounds = adaptive_reasoning_recommendation(
        recommendation,
        task_summary,
        route,
        difficulty,
        config,
    )
    recommendation["reasoning_effort"] = effort
    recommendation["reasoning_bounds"] = bounds
    recommendation["execution"] = "native_agent_handoff_only"
    return recommendation


@mcp.tool()
def router_status() -> dict[str, Any]:
    """讀取 Lite router 設定；不啟動程序、不連網、不探測 Git。"""
    config = read_config()
    return {
        "status": "ok",
        "server": MCP_NAME,
        "version": config.get("version", "unknown"),
        "probe_mode": "config_only",
        "external_execution": False,
        "allowed_tools": [
            "router_status",
            "route_task",
            "goal_bootstrap",
            "goal_get_state",
            "goal_checkpoint",
            "goal_resume",
            "goal_finalize",
        ],
        "agents": config.get("agents", {}),
        "reasoning_policy": config.get("reasoning_policy", {}),
        "git_policy": config.get("git_policy", {}),
        "plan_review": config.get("plan_review", {}),
        "gemini_profiles": config.get("gemini_profiles", {}),
        "codex_profiles": config.get("codex_profiles", {}),
        "fallback_chains": config.get("fallback_chains", {}),
    }


@mcp.tool()
def route_task(task_summary: str, task_type: str = "", difficulty: str = "auto") -> dict[str, Any]:
    """依任務難度回傳平衡的模型與推理建議；Lite MCP 永不執行或等待任務。"""
    ensure_not_sensitive_text(task_summary)
    route = normalized_task_type(task_summary, task_type)
    recommendation = dict(ROUTES[route])
    config = read_config()
    reasoning_effort, selected_difficulty, reasoning_bounds = adaptive_reasoning_recommendation(
        recommendation,
        task_summary,
        route,
        difficulty,
        config,
    )
    recommendation["reasoning_effort"] = reasoning_effort
    fallback_chains = config.get("fallback_chains", {})
    escalation = luna_escalation_recommendation(
        config,
        route,
        task_summary,
        selected_difficulty,
    )
    return {
        "status": "planned",
        "execution": "recommendation_only",
        "task_type": route,
        "task_summary": task_summary[:300],
        "difficulty": selected_difficulty,
        "reasoning_selection": config.get("reasoning_policy", {}).get("strategy", "fixed"),
        "reasoning_bounds": reasoning_bounds,
        "fallback_chain": fallback_chains.get(route, []),
        **recommendation,
        "escalation": escalation,
        "post_plan_review": config.get("plan_review", {}) if route == "planning" else None,
        "requires_accepted_plan": bool(recommendation.get("requires_accepted_plan", False)),
    }


@mcp.tool()
def goal_bootstrap(goal_id: str, title: str, phases: list[str]) -> dict[str, Any]:
    """建立單一工作包的初始 Goal state；不覆寫未完成 Goal。"""
    ensure_not_sensitive_text(title)
    if not goal_id.strip() or not phases:
        raise ValueError("goal_id 與至少一個 phase 為必要欄位")
    existing = read_goal_state()
    if existing and existing.get("status") not in {"completed", "finalized"}:
        if existing.get("goal_id") == goal_id:
            return {"status": "existing", "state": existing}
        return {
            "status": "active_goal_exists",
            "active_goal_id": existing.get("goal_id"),
            "reason": "先 checkpoint、resume 或 finalize 既有 Goal；Lite MCP 不會覆寫 state",
        }
    state = {
        "schema_version": "5.3-lite",
        "goal_id": goal_id.strip(),
        "title": title.strip(),
        "status": "active",
        "created_at": utc_now(),
        "updated_at": utc_now(),
        "phases": [
            {"name": phase.strip(), "status": "pending", "checkpoints": []}
            for phase in phases
            if phase.strip()
        ],
        "next_step": phases[0].strip(),
    }
    if not state["phases"]:
        raise ValueError("phase 不可全部為空白")
    write_goal_state(state)
    append_goal_log(f"bootstrap {state['goal_id']}: {state['title']}")
    return {"status": "created", "state": state}


@mcp.tool()
def goal_get_state() -> dict[str, Any]:
    """讀取目前 Goal state。"""
    state = read_goal_state()
    return {"status": "no_active_goal"} if state is None else {"status": "ok", "state": state}


@mcp.tool()
def goal_checkpoint(
    phase: str,
    summary: str,
    completed: bool = True,
    next_step: str = "",
    evidence: list[str] | None = None,
) -> dict[str, Any]:
    """寫入短 checkpoint 與驗證證據；不執行工作或測試。"""
    ensure_not_sensitive_text(summary)
    state = read_goal_state()
    if state is None:
        raise ValueError("尚未 bootstrap Goal")
    record = next((item for item in state.get("phases", []) if item.get("name") == phase), None)
    if record is None:
        raise ValueError(f"找不到 phase: {phase}")
    checkpoint = {
        "at": utc_now(),
        "summary": summary[:2000],
        "completed": bool(completed),
        "evidence": [str(item)[:500] for item in (evidence or [])][:20],
    }
    record.setdefault("checkpoints", []).append(checkpoint)
    record["status"] = "completed" if completed else "in_progress"
    pending = next((item["name"] for item in state["phases"] if item.get("status") != "completed"), "")
    state["next_step"] = next_step[:500] or pending
    write_goal_state(state)
    append_goal_log(f"checkpoint {state.get('goal_id', '')}/{phase}: {record['status']}")
    return {"status": "checkpointed", "state": state}


@mcp.tool()
def goal_resume() -> dict[str, Any]:
    """回傳最後未完成的 phase；不啟動模型、不改寫工作區。"""
    state = read_goal_state()
    if state is None:
        return {"status": "no_active_goal"}
    pending = next((item for item in state.get("phases", []) if item.get("status") != "completed"), None)
    if pending is None:
        return {"status": "ready_to_finalize", "state": state}
    return {
        "status": "resumable",
        "goal_id": state.get("goal_id"),
        "next_phase": pending.get("name"),
        "next_step": state.get("next_step") or pending.get("name"),
        "state": state,
    }


@mcp.tool()
def goal_finalize(summary: str = "") -> dict[str, Any]:
    """僅在所有 phase 完成時將 Goal 標記完成並寫入最終摘要。"""
    ensure_not_sensitive_text(summary)
    state = read_goal_state()
    if state is None:
        raise ValueError("尚未 bootstrap Goal")
    pending = [item.get("name") for item in state.get("phases", []) if item.get("status") != "completed"]
    unresolved = [item for item in state.get("manual_blockers", []) if not item.get("resolved")]
    if pending or unresolved:
        return {"status": "not_finalizable", "pending_phases": pending, "manual_blockers": unresolved}
    state["status"] = "completed"
    state["final_summary"] = summary[:2000]
    state["next_step"] = ""
    write_goal_state(state)
    append_goal_log(f"finalize {state.get('goal_id', '')}")
    return {"status": "completed", "state": state}


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()

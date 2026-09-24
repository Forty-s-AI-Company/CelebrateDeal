"""AI Team v6 的短時間、純本機狀態 MCP。

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
from routing import assess_acceptance, load_config, route, snapshot_revision


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

def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def ensure_not_sensitive_text(value: str) -> None:
    if SENSITIVE_PATTERN.search(value):
        raise ValueError("輸入疑似包含敏感憑證，Lite MCP 拒絕保存或路由")


def read_config() -> dict[str, Any]:
    return load_config(CONFIG_PATH)


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


@mcp.tool()
def router_status() -> dict[str, Any]:
    """Local config only; never starts an agent or probes external accounts."""
    config = read_config()
    return {"status": "ok", "server": MCP_NAME, "probe_mode": "config_only",
            "external_execution": False, **config}


@mcp.tool()
def route_task(task_summary: str, task_type: str = "", difficulty: str = "auto",
               task_signals: dict[str, Any] | None = None,
               runtime: dict[str, Any] | None = None, team: str = "") -> dict[str, Any]:
    """Compatible task-first routing; additive signals, quota and availability inputs."""
    ensure_not_sensitive_text(task_summary)
    config = read_config()
    task = {**(task_signals or {}), "task_summary": task_summary}
    # Compatibility defaults are absence markers, not explicit caller overrides.
    if task_type:
        task["task_type"] = task_type
    elif "task_type" not in task:
        task["task_type"] = ""
    if difficulty != "auto":
        # An explicit compatibility argument outranks structured signals.
        task.pop("complexity", None)
        task["difficulty"] = difficulty
    elif "difficulty" not in task and "complexity" not in task:
        task["difficulty"] = "auto"
    return route(task, runtime, team or config["active_mode_id"], config)


@mcp.tool()
def assess_task(decision: dict[str, Any], evidence: dict[str, Any]) -> dict[str, Any]:
    """Task acceptance only; route or provider completion alone never means READY."""
    return assess_acceptance(decision, evidence, ROOT)


@mcp.tool()
def snapshot_task(files: list[str]) -> dict[str, Any]:
    """Hash only explicitly named project files for later stale-evidence checks."""
    return {"root": str(ROOT), "files": files, "revision": snapshot_revision(ROOT, files)}


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
        return {"status": "phases_complete_validation_required", "state": state}
    return {
        "status": "resumable",
        "goal_id": state.get("goal_id"),
        "next_phase": pending.get("name"),
        "next_step": state.get("next_step") or pending.get("name"),
        "state": state,
    }


@mcp.tool()
def goal_finalize(summary: str = "", decision: dict[str, Any] | None = None,
                  evidence: dict[str, Any] | None = None) -> dict[str, Any]:
    """所有 phase 與同一 Goal 的執行、驗證、審查證據均通過才完成。"""
    ensure_not_sensitive_text(summary)
    state = read_goal_state()
    if state is None:
        raise ValueError("尚未 bootstrap Goal")
    pending = [item.get("name") for item in state.get("phases", []) if item.get("status") != "completed"]
    unresolved = [item for item in state.get("manual_blockers", []) if not item.get("resolved")]
    if pending or unresolved:
        return {"status": "not_finalizable", "pending_phases": pending, "manual_blockers": unresolved}
    if not isinstance(decision, dict) or not isinstance(evidence, dict) or decision.get("task_id") != state.get("goal_id"):
        return {"status": "not_finalizable", "acceptance": {"status": "BLOCKED", "blockers": ["goal_acceptance_evidence_missing"]}}
    acceptance = assess_acceptance(decision, evidence, ROOT)
    if acceptance["status"] != "READY":
        return {"status": "not_finalizable", "acceptance": acceptance}
    state["status"] = "completed"
    state["final_summary"] = summary[:2000]
    state["acceptance"] = acceptance
    state["next_step"] = ""
    write_goal_state(state)
    append_goal_log(f"finalize {state.get('goal_id', '')}")
    return {"status": "completed", "acceptance": acceptance, "state": state}


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()

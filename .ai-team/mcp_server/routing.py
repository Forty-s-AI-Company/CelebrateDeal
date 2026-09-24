"""Task-first routing. Pure decisions only: no processes, network or agent spawning."""

from __future__ import annotations

import json
import hashlib
import math
import re
from pathlib import Path
from typing import Any

POLICY_PATH = Path(__file__).resolve().parents[1] / "config" / "routing-policy.json"
SENSITIVE = re.compile(r"(?:api[_ -]?key|token|secret|password|private[_ -]?key|authorization)\s*[:=]", re.I)
LEVELS = ("low", "medium", "high", "critical")
COMPLEXITY = ("low", "medium", "high", "very_high")
TEAMS = ("ai-team-lite", "ai-team", "ai-team-pro")
ALIASES = {
    "low": "ai-team-lite", "high": "ai-team", "pro": "ai-team-pro",
    "style": "ai-team-lite", "ai-team-style": "ai-team-lite",
}
TASK_ALIASES = {
    "planning": "plan", "major_planning": "architecture", "find_files": "explore",
    "trace_flow": "explore", "dependency_analysis": "analyze", "root_cause": "root_cause",
    "small_feature": "implement", "bug_fix": "implement", "cross_file_fix": "cross_module",
    "hard_debugging": "complex_debug", "complex_implementation": "cross_module",
    "regression_review": "review", "plan_acceptance": "plan_review",
    "claude_plan_review": "plan_review", "gemini_fast": "broad_review",
    "gemini_deep": "deep_review", "cross_file_second_opinion": "deep_review",
    "quick_second_opinion": "broad_review", "complex_validation": "qa",
    "browser_qa": "qa", "e2e": "qa", "ui_validation": "qa",
    "classify": "manager", "log_summary": "summarize",
}
TASKS = {
    "copy", "docs", "format", "ui", "test_fix", "crud", "api", "implement", "feature",
    "cross_module", "complex_debug", "architecture", "migration", "root_cause", "analyze",
    "explore", "plan", "review", "broad_review", "deep_review", "business_review",
    "plan_review", "security_review", "qa", "release", "manager", "summarize", "arbiter",
}
REVIEW_TASKS = {"review", "broad_review", "deep_review", "business_review", "plan_review", "security_review"}
ASTRA_REASONS = {
    "sol_insufficient", "unresolved_architecture", "major_reviewer_conflict",
    "critical_review_no_equivalent", "exceptional_cross_system_problem",
}


def snapshot_revision(root: Path, files: list[str]) -> str:
    """Digest the declared source surface without reading secrets or leaving root."""
    if not isinstance(files, list) or not 1 <= len(files) <= 64 or any(not isinstance(p, str) for p in files):
        raise ValueError("Invalid snapshot_files")
    base = root.resolve(strict=True)
    digest = hashlib.sha256()
    for name in sorted(set(files)):
        path = Path(name)
        if (not name or path.is_absolute() or path.suffix.lower() in {".pem", ".key", ".p12", ".pfx", ".db", ".sqlite", ".csv"}
                or any(part.startswith(".env") or part in {".git", "node_modules"} for part in path.parts)):
            raise ValueError("Invalid snapshot path")
        target = (base / name).resolve(strict=True)
        if not target.is_relative_to(base) or not target.is_file() or target.stat().st_size > 4_000_000:
            raise ValueError("Invalid snapshot file")
        data = target.read_bytes()
        digest.update(name.replace("\\", "/").encode("utf-8"))
        digest.update(len(data).to_bytes(8, "big"))
        digest.update(data)
    return "sha256:" + digest.hexdigest()


def load_policy() -> dict[str, Any]:
    return json.loads(POLICY_PATH.read_text(encoding="utf-8"))


def load_config(path: Path) -> dict[str, Any]:
    """Selectors cannot inject a different policy or arbitrary executable path."""
    if path.suffix != ".json" or path.name.startswith(".env"):
        raise ValueError("Only JSON selectors are supported")
    selector = json.loads(path.read_text(encoding="utf-8-sig"))
    if set(selector) != {"version", "active_mode", "active_mode_id", "policy"} or selector["policy"] != "routing-policy.json":
        raise ValueError("Selector must reference the canonical routing policy")
    if selector.get("version") != "6.0" or selector.get("active_mode_id") not in (*TEAMS, "ai-team-style"):
        raise ValueError("Unsupported AI Team selector; migrate to version 6.0")
    return {**load_policy(), **selector}


def choice(value: Any, allowed: tuple | set, field: str) -> Any:
    if value not in allowed:
        raise ValueError(f"Invalid {field}")
    return value


def classify(task: dict[str, Any], policy: dict[str, Any]) -> dict[str, Any]:
    """Classify independent capability floors, then select their maximum."""
    summary = task.get("task_summary", "")
    if not isinstance(summary, str) or not summary.strip() or len(summary) > 20000:
        raise ValueError("task_summary must contain 1..20000 characters")
    if SENSITIVE.search(summary):
        raise ValueError("BLOCKED_SENSITIVE_INPUT")
    kind = task.get("task_type", "").lower().replace("-", "_").replace(" ", "_")
    kind = TASK_ALIASES.get(kind, kind)
    if not kind:
        kind = "implement"
        for candidate, pattern in policy["task_keywords"].items():
            if re.search(pattern, summary, re.I):
                kind = candidate
                break
    choice(kind, TASKS, "task_type")
    changed_files = task.get("changed_files", [])
    if not isinstance(changed_files, list) or any(not isinstance(p, str) for p in changed_files):
        raise ValueError("changed_files must be an array of paths")
    # A document that mentions payment is not a payment implementation change.
    # Documentation wording is not code impact; an affected executable path is.
    executable_paths = [path for path in changed_files if not re.search(r"\.(?:md|mdx|txt|rst)$", path, re.I)]
    text = " ".join(executable_paths) if kind in {"copy", "docs", "format"} else summary + " " + kind + " " + " ".join(changed_files)
    raw_categories = task.get("risk_categories", [])
    if not isinstance(raw_categories, list) or any(not isinstance(item, str) for item in raw_categories):
        raise ValueError("risk_categories must be an array of strings")
    categories = set(raw_categories)
    if categories - policy["risk_categories"].keys():
        raise ValueError("Unknown risk category")
    for category, rule in policy["risk_categories"].items():
        if re.search(rule["pattern"], text, re.I):
            categories.add(category)
    score = sum(policy["risk_categories"][c]["weight"] for c in categories)
    risk = task.get("risk", "low")
    choice(risk, LEVELS, "risk")
    impacts = {}
    for field in ("production_impact", "security_impact", "data_integrity_impact"):
        impacts[field] = choice(task.get(field, "low"), LEVELS, field)
    risk = max([risk, *impacts.values()], key=LEVELS.index)
    if any(policy["risk_categories"][c]["critical"] for c in categories):
        risk = "critical"
    elif score >= 4:
        risk = max(risk, "high", key=LEVELS.index)
    elif score >= 1:
        risk = max(risk, "medium", key=LEVELS.index)
    sizes = {}
    for field in ("context_size", "expected_duration", "code_surface_area"):
        value = task.get(field, 0)
        if (isinstance(value, bool) or not isinstance(value, (int, float)) or
                not math.isfinite(value) or not 0 <= value <= 10000000):
            raise ValueError(f"Invalid {field}")
        if field == "code_surface_area" and not isinstance(value, int):
            raise ValueError(f"Invalid {field}")
        sizes[field] = value
    requested = task.get("complexity", "auto")
    choice(requested, {*COMPLEXITY, "auto"}, "complexity")
    legacy = {"auto": "auto", "trivial": "low", "routine": "medium", "complex": "high", "critical": "very_high"}
    difficulty = task.get("difficulty", "auto")
    if difficulty not in legacy:
        raise ValueError("Invalid difficulty")
    if requested == "auto":
        requested = legacy[difficulty]
    for field in ("mechanical_change", "ambiguous_requirements", "important_findings"):
        if not isinstance(task.get(field, False), bool):
            raise ValueError(f"Invalid {field}")

    low_default_tasks = {"copy", "docs", "format", "ui", "test_fix", "explore", "manager", "summarize", "release"}
    task_type_floor = "low"
    if kind in {"cross_module", "complex_debug", "business_review", "deep_review"} and not task.get("mechanical_change", False):
        task_type_floor = "high"
    if kind in {"architecture", "root_cause", "arbiter"}:
        task_type_floor = "high"

    # A compatibility/default "auto" carries no caller capability requirement.
    complexity_requirement = ("low" if kind in low_default_tasks else "medium") if requested == "auto" else requested
    if kind == "security_review":
        risk = "critical"
    risk_requirement = "high" if risk in {"high", "critical"} else "medium" if risk == "medium" else "low"
    size_requirement = "low"
    # Surface and context are workload signals, not proof of difficult reasoning.
    for field, thresholds in policy["size_thresholds"].items():
        level = "medium" if sizes[field] >= thresholds[0] else "low"
        if field == "code_surface_area" and task.get("mechanical_change", False):
            level = "low"
        size_requirement = max(size_requirement, level, key=COMPLEXITY.index)
    # Risk determines validation/review requirements, not the implementation's
    # reasoning difficulty. A small Critical edit may be implemented by Luna.
    floor = max(task_type_floor, complexity_requirement, size_requirement,
                key=COMPLEXITY.index)
    important_findings = task.get("important_findings", False)
    if not isinstance(important_findings, bool):
        raise ValueError("important_findings must be boolean")
    capabilities = []
    if task.get("ambiguous_requirements", False):
        capabilities.append("product")
    if kind == "ui" or any(re.search(r"(?:^|/)(?:components|ui)/|\.tsx$", path, re.I) for path in changed_files):
        capabilities.append("ux_ui")
    if categories & {"migration", "production_data", "tenant_isolation"} or any("schema.prisma" in path for path in changed_files):
        capabilities.append("database")
    if categories & {"webhook", "concurrency"} or any(re.search(r"(?:queue|retry|rate.limit)", path, re.I) for path in changed_files):
        capabilities.append("sre")
    return {"task_type": kind, "complexity": floor, "risk": risk, "risk_score": score,
            "risk_categories": sorted(categories), "important_findings": important_findings,
            "required_capabilities": capabilities,
            "task_type_floor": task_type_floor,
            "complexity_requirement": complexity_requirement,
            "risk_requirement": risk_requirement,
            "size_requirement": size_requirement,
            "changed_files": changed_files, **sizes, **impacts}


def select_route(signals: dict[str, Any], policy: dict[str, Any]) -> tuple[str, str]:
    kind, risk, complexity = (signals[k] for k in ("task_type", "risk", "complexity"))
    if kind in REVIEW_TASKS:
        if risk == "critical":
            return "critical_review", "opus"
        if kind in {"deep_review", "business_review", "plan_review"} or risk == "high" or signals["important_findings"]:
            return "senior_review", "sonnet"
        if kind == "review" and complexity in {"high", "very_high"}:
            return "senior_review", "sonnet"
        if kind == "broad_review" or risk == "medium" or signals["context_size"] >= 20000:
            return "broad_review", "gemini_high" if risk == "medium" or complexity != "low" else "gemini_medium"
        return "self_review", "luna" if complexity in {"low", "medium"} else "sol"
    if kind == "qa":
        return "qa", "gemini_high" if complexity in {"high", "very_high"} or risk != "low" else "gemini_medium"
    if kind == "arbiter":
        return "arbiter", "sol"
    role = "planner" if kind in {"plan", "architecture"} else "explorer" if kind in {"explore", "analyze", "summarize"} else "manager" if kind == "manager" else "release" if kind == "release" else "developer"
    model = policy["MODEL_ROUTING"]["engineering"][complexity]
    return role, model


def unavailable(model: str, runtime: dict[str, Any], policy: dict[str, Any]) -> str | None:
    entry = policy["models"][model]
    provider = entry["provider"]
    status = runtime.get("models", {}).get(model, runtime.get("models", {}).get(entry.get("slug"), {}))
    if status.get("available") is False:
        return "unavailable"
    if status.get("quota_remaining") == 0 or runtime.get("quota", {}).get(provider) == 0:
        return "quota_exhausted"
    if status.get("failure"):
        return choice(status["failure"], set(policy["fallback_reasons"]), "failure")
    if provider != "codex":
        if runtime.get("agy_available") is not True:
            return "unavailable"
        slug = runtime.get("agy_models", {}).get(model)
        if not isinstance(slug, str) or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._-]{1,100}", slug):
            return "model_unavailable"
        if slug not in runtime.get("discovered_slugs", []):
            return "model_unavailable"
    return None


def fallback_candidates(role: str, model: str, policy: dict[str, Any]) -> list[str]:
    table = policy["MODEL_FALLBACK"]
    return table.get(role, table["engineering"]).get(model, [])


def resolve_model(role: str, selected: str, runtime: dict[str, Any], policy: dict[str, Any]) -> tuple[str | None, list[dict]]:
    """Only a failed/unavailable choice enters fallback; never cycle or downgrade risk."""
    attempted = runtime.get("attempted_models", [])
    if not isinstance(attempted, list) or any(m not in policy["models"] for m in attempted):
        raise ValueError("Invalid attempted_models")
    events = []
    for model in [selected, *fallback_candidates(role, selected, policy)]:
        reason = "repeated_failure" if model in attempted else unavailable(model, runtime, policy)
        if reason:
            events.append({"model": model, "reason": reason})
        else:
            return model, events
    return None, events


def recommendation(role: str, model: str, signals: dict, runtime: dict, policy: dict) -> dict:
    entry = policy["models"][model]
    effort = "low" if signals["complexity"] == "low" else "medium"
    if signals["complexity"] in {"high", "very_high"} or signals["risk"] in {"high", "critical"} or role in {"senior_review", "broad_review"}:
        effort = "high"
    if model == "luna" and role in {"developer", "planner"}:
        effort = "high"
    if model == "sol" and role in {"developer", "planner"} and signals["complexity"] == "high":
        effort = "medium" if signals["risk"] == "low" else "high"
    if model == "astra":
        effort = "low" if role == "arbiter" else "high"
    if entry["provider"] != "codex":
        effort = entry["effort"]
    else:
        allowed = runtime.get("supported_efforts", {}).get(model, policy["codex_efforts"][model])
        if effort not in allowed:
            raise ValueError("UNSUPPORTED_MODEL_EFFORT")
    return {"role": role, "model_key": model,
            "model": entry.get("slug") or runtime["agy_models"][model],
            "provider": "native_agent" if entry["provider"] == "codex" else "agy_wrapper",
            "reasoning_effort": effort,
            "sandbox_mode": "workspace-write" if role == "developer" else "read-only",
            "execution": "native_agent_handoff_only" if entry["provider"] == "codex" else "agy_readonly",
            "candidate_findings_only": entry["provider"] == "gemini",
            "may_spawn": False}


def route(task: dict[str, Any], runtime: dict[str, Any] | None = None, team: str = "auto", policy: dict | None = None) -> dict:
    policy, runtime = policy or load_policy(), runtime or {}
    signals = classify(task, policy)
    # Existing wrappers omit -Team; an empty value is the compatible auto mode.
    team = "auto" if team in (None, "") else ALIASES.get(team, team)
    choice(team, {*TEAMS, "auto"}, "team")
    parent_depth = task.get("parent_depth", 0)
    if isinstance(parent_depth, bool) or not isinstance(parent_depth, int) or parent_depth < 0:
        raise ValueError("Invalid parent_depth")
    child_process = runtime.get("child_process", False)
    if not isinstance(child_process, bool):
        raise ValueError("Invalid child_process")
    if parent_depth != 0 or child_process:
        return {"status": "BLOCKED_RECURSION", "execution": "none"}
    count = task.get("dispatch_count", 0)
    if type(count) is not int or count < 0:
        raise ValueError("Invalid dispatch_count")
    if count >= policy["limits"]["max_dispatches_per_task"]:
        return {"status": "BUDGET_EXHAUSTED", "execution": "none"}
    if signals["required_capabilities"] and "product" in signals["required_capabilities"] and not task.get("acceptance_criteria"):
        return {"status": "NEEDS_ACCEPTANCE_CRITERIA", "execution": "none", "signals": signals}
    astra_reason = task.get("astra_reason")
    if astra_reason is not None and astra_reason not in ASTRA_REASONS:
        raise ValueError("Invalid astra_reason")
    if astra_reason == "sol_insufficient" and not task.get("failure_evidence"):
        raise ValueError("sol_insufficient requires failure_evidence")
    if task.get("hard_team_cap", False) not in (True, False):
        raise ValueError("Invalid hard_team_cap")
    role, selected = select_route(signals, policy)
    if role == "arbiter" and astra_reason is None:
        return {"status": "ASTRA_REASON_REQUIRED", "execution": "none"}
    if astra_reason is not None and role in {"developer", "planner", "arbiter"}:
        selected = "astra"
    resolved, events = resolve_model(role, selected, runtime, policy)
    needed = "ai-team" if selected == "sol" else "ai-team-lite"
    models = [selected] + ([resolved] if resolved else [])
    for model in models:
        needed = max(needed, policy["models"][model]["minimum_team"], key=TEAMS.index)
    effective = needed if team == "auto" else max(team, needed, key=TEAMS.index)
    if task.get("hard_team_cap", False) and team != "auto" and TEAMS.index(effective) > TEAMS.index(team):
        return {"status": "TEAM_CAP_BLOCKED", "execution": "none", "requested_team": team,
                "recommended_team": effective, "selected_model": selected}
    escalation_reasons: list[str] = []

    def add_escalation_reason(reason: str) -> None:
        if reason not in escalation_reasons:
            escalation_reasons.append(reason)

    if team != "auto" and effective != team:
        if COMPLEXITY.index(signals["task_type_floor"]) >= COMPLEXITY.index("high"):
            add_escalation_reason("task_type_floor")
        if COMPLEXITY.index(signals["complexity_requirement"]) > COMPLEXITY.index(signals["task_type_floor"]):
            add_escalation_reason("complexity")
        if signals["risk"] != "low":
            add_escalation_reason("risk")
        if events:
            add_escalation_reason("fallback")
        add_escalation_reason("model_capability")
    result = {"status": "planned" if resolved else "NO_CAPABLE_MODEL", "execution": "recommendation_only",
              "task_id": task.get("task_id"),
              "signals": signals, "task_type": signals["task_type"], "difficulty": signals["complexity"],
              "requested_team": team, "team": effective, "escalated": team != "auto" and effective != team,
              "selected_model": selected, "fallback_events": events,
              "fallback_chain": fallback_candidates(role, selected, policy),
              "limits": policy["limits"], "spawn_count": 0, "review_plan": [],
              "escalation_reasons": escalation_reasons, "astra_reason": astra_reason,
              "source_revision": task.get("source_revision", "unknown"),
              "snapshot_root": task.get("snapshot_root"),
              "snapshot_files": task.get("snapshot_files", []),
              "required_checks": task.get("required_checks", []),
              "requested": {"model_key": selected, "effort": task.get("reasoning_effort", "auto"), "speed": "standard"},
              "observed": {"model": "unknown", "effort": "unknown", "source": "not_executed"}}
    if resolved:
        rec = recommendation(role, resolved, signals, runtime, policy)
        requested_effort = task.get("reasoning_effort")
        if requested_effort is not None:
            if requested_effort not in policy["codex_efforts"].get(resolved, [rec["reasoning_effort"]]):
                raise ValueError("UNSUPPORTED_MODEL_EFFORT")
            if requested_effort in {"xhigh", "max"} and not task.get("effort_reason"):
                raise ValueError("ELEVATED_EFFORT_REASON_REQUIRED")
            rec["reasoning_effort"] = requested_effort
        result.update(rec)
        result["resolved"] = {"model": rec["model"], "effort": rec["reasoning_effort"],
                              "speed": "standard", "source": "router_policy"}
        result["execution"] = "recommendation_only"
        result["handoff"] = rec
        result["target"] = ("worker-deep" if role == "developer" and resolved == "sol" else
                            {"developer": "worker", "planner": "planner", "explorer": "explorer"}.get(role, role))
        # Static native agent descriptors are presets; callers must pass the resolved
        # model and effort explicitly and must not infer observation from the target.
        result["execution_requirement"] = {"explicit_model": True, "explicit_effort": True,
                                           "verify_observed": True}
    # Review stages are requirements, never automatic agent spawns. No recursive route calls.
    if signals["task_type"] not in {"manager", "arbiter"}:
        risk = signals["risk"]
        stages = [("critical_review", "opus")] if risk == "critical" else [("senior_review", "sonnet")] if risk == "high" else []
        if signals["task_type"] in REVIEW_TASKS:
            stages = [(r, m) for r, m in stages if r != role and risk == "high"]
        for review_role, review_model in stages:
            chosen, failures = resolve_model(review_role, review_model, runtime, policy)
            stage = {"role": review_role, "required": True, "fallback_events": failures,
                     "status": "planned" if chosen else "NO_CAPABLE_MODEL"}
            if chosen:
                stage.update(recommendation(review_role, chosen, signals, runtime, policy))
                if chosen == "astra":
                    stage["astra_reason"] = "critical_review_no_equivalent"
                result["team"] = max(result["team"], policy["models"][chosen]["minimum_team"], key=TEAMS.index)
                if team != "auto" and TEAMS.index(policy["models"][chosen]["minimum_team"]) > TEAMS.index(team):
                    add_escalation_reason("required_review")
                if failures:
                    add_escalation_reason("fallback")
            else:
                result["status"] = "REVIEW_BLOCKED"
            result["review_plan"].append(stage)
    if task.get("hard_team_cap", False) and team != "auto" and TEAMS.index(result["team"]) > TEAMS.index(team):
        result["status"] = "TEAM_CAP_BLOCKED"
        result["execution"] = "none"
    result["escalated"] = team != "auto" and result["team"] != team
    result["escalation_reasons"] = escalation_reasons if result["escalated"] else []
    result["self_review"] = signals["task_type"] not in REVIEW_TASKS and not result["review_plan"] and signals["risk"] == "low"
    result["finding_escalation"] = "senior_review" if role == "broad_review" or signals["risk"] == "medium" else None
    return result


def assess_acceptance(decision: dict[str, Any], evidence: dict[str, Any],
                      allowed_root: Path | None = None) -> dict[str, Any]:
    """Only runner evidence for this source revision may satisfy delivery gates."""
    blockers = []
    revision = decision.get("source_revision", "unknown")
    if decision.get("status") != "planned" or not isinstance(revision, str) or not revision.strip() or revision == "unknown":
        blockers.append("route_or_snapshot_unverified")
    try:
        snapshot_root = Path(decision["snapshot_root"]).resolve(strict=True)
        if allowed_root is not None and snapshot_root != allowed_root.resolve(strict=True):
            blockers.append("snapshot_root_outside_project")
        elif revision != snapshot_revision(snapshot_root, decision["snapshot_files"]):
            blockers.append("snapshot_changed")
    except (KeyError, TypeError, OSError, ValueError):
        blockers.append("snapshot_unverified")
    def evidence_record(item: dict[str, Any]) -> dict[str, Any] | None:
        path = item.get("evidence_path")
        if not isinstance(path, str) or not path or Path(path).name.startswith(".env"):
            return None
        location = Path(path)
        if location.suffix.lower() != ".json" or not location.is_file() or location.stat().st_size > 65536:
            return None
        try:
            value = json.loads(location.read_text(encoding="utf-8"))
        except (OSError, ValueError, UnicodeError):
            return None
        return value if isinstance(value, dict) else None

    def record_matches(item: dict[str, Any], kind: str, keys: tuple[str, ...]) -> bool:
        record = evidence_record(item)
        return record is not None and record.get("kind") == kind and all(
            record.get(key) == item.get(key) for key in keys)

    def has_validation_receipt(item: dict[str, Any]) -> bool:
        return record_matches(item, "validation",
                              ("source", "name", "revision", "status", "exit_code"))

    execution = evidence.get("execution", {})
    if (not isinstance(execution, dict) or execution.get("revision") != revision
            or execution.get("status") != "COMPLETED"
            or execution.get("source") not in {"native_runner", "agy_wrapper", "desktop_native"}
            or execution.get("provider_terminal") is not True
            or execution.get("tool_operations") not in {"completed", "not_required"}
            or not record_matches(execution, "execution",
                                  ("revision", "status", "source", "provider_terminal", "tool_operations"))):
        blockers.append("execution_unverified")
    checks = evidence.get("checks", [])
    if not isinstance(checks, list):
        raise ValueError("Invalid checks")
    required = decision.get("required_checks", [])
    if not isinstance(required, list) or any(not isinstance(name, str) for name in required):
        raise ValueError("Invalid required_checks")
    if (decision.get("signals", {}).get("risk") in {"high", "critical"}
            or decision.get("role") in {"developer", "qa", "release"}) and not required:
        blockers.append("required_checks_not_declared")
    for name in required:
        matching = [item for item in checks if isinstance(item, dict) and item.get("name") == name
                    and item.get("revision") == revision and item.get("source") == "validation_runner"
                    and item.get("status") == "PASS" and item.get("exit_code") == 0
                    and has_validation_receipt(item)]
        if not matching:
            blockers.append(f"required_check_unverified:{name}")
    risk = decision.get("signals", {}).get("risk")
    if risk in {"high", "critical"}:
        review = evidence.get("review", {})
        required_stage = next((stage for stage in decision.get("review_plan", [])
                               if stage.get("required") is True), None)
        if required_stage is None and decision.get("role") in {"senior_review", "critical_review"}:
            required_stage = decision
        if (not isinstance(review, dict) or review.get("revision") != revision
                or review.get("status") != "PASS" or review.get("independent") is not True
                or review.get("source") not in {"agy_wrapper", "native_runner", "desktop_native"}
                or required_stage is None
                or review.get("role") != required_stage.get("role")
                or review.get("model") != required_stage.get("model")
                or not record_matches(review, "review", ("revision", "status", "independent", "source", "role", "model"))):
            blockers.append("independent_review_unverified")
    for finding in evidence.get("findings", []):
        if not isinstance(finding, dict) or finding.get("disposition") not in {"confirmed", "rejected_with_reason", "unresolved"}:
            blockers.append("finding_unresolved")
        elif finding["disposition"] == "unresolved" and finding.get("severity") in {"BLOCKER", "MAJOR"}:
            blockers.append("finding_unresolved")
        elif finding["disposition"] == "rejected_with_reason" and not finding.get("reason"):
            blockers.append("finding_without_rejection_reason")
    return {"status": "READY" if not blockers else "BLOCKED", "blockers": sorted(set(blockers)),
            "revision": revision}


def discover_slugs(output: str, policy: dict | None = None) -> dict[str, str]:
    """Only return exact, unambiguous slugs present in successful `agy models` output."""
    policy = policy or load_policy()
    found = {}
    for key, model in policy["models"].items():
        if model["provider"] == "codex":
            continue
        matches = set(re.findall(model["discovery_pattern"], output, re.I))
        if len(matches) == 1:
            found[key] = matches.pop()
    return found


def validate_review(payload: Any) -> dict:
    """A zero process exit code is not review acceptance."""
    if not isinstance(payload, dict) or set(payload) != {"summary", "findings"}:
        raise ValueError("Review must contain summary and findings")
    if not isinstance(payload["summary"], str) or not payload["summary"].strip():
        raise ValueError("Review summary is required")
    if not isinstance(payload["findings"], list) or len(payload["findings"]) > 100:
        raise ValueError("Invalid findings")
    fields = {"severity", "file", "area", "issue", "evidence", "impact", "recommended_fix", "required_test", "confidence"}
    for finding in payload["findings"]:
        if not isinstance(finding, dict) or set(finding) != fields:
            raise ValueError("Invalid finding fields")
        choice(finding["severity"], {"BLOCKER", "MAJOR", "MINOR", "NIT"}, "severity")
        for field in fields - {"confidence"}:
            if not isinstance(finding[field], str) or not finding[field].strip():
                raise ValueError(f"Invalid finding {field}")
        confidence = finding["confidence"]
        if isinstance(confidence, bool) or not isinstance(confidence, (int, float)) or not 0 <= confidence <= 1:
            raise ValueError("Invalid confidence")
    if SENSITIVE.search(json.dumps(payload)):
        raise ValueError("BLOCKED_SENSITIVE_OUTPUT")
    return payload

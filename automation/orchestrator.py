from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from adapters.base_adapter import DEFAULT_ENV_ALLOWLIST, redact
from policy import assert_write_scope
from routing import RoleDag, assert_acyclic, build_role_dag, enabled_roles, normalize_domain


ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "automation" / "team-config.yaml"
BACKLOG_PATH = ROOT / "automation" / "backlog.json"
STATE_PATH = ROOT / "automation" / "task-state.json"
PRIORITY = {"P0": 0, "P1": 1, "P2": 2}
ALLOWED_VALIDATION_SCRIPTS = {
    "ai:validate", "automation:test", "security:secrets", "lint", "typecheck", "test",
    "test:coverage", "build", "preflight", "e2e:smoke", "e2e:a11y", "e2e:visual", "lighthouse",
}


@dataclass(frozen=True)
class Route:
    agent: str
    model: str
    reasoning: str


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"Expected object in {path}")
    return value


def safe_child_environment() -> dict[str, str]:
    return {key: value for key, value in os.environ.items() if key.upper() in DEFAULT_ENV_ALLOWLIST}


def run(command: list[str], cwd: Path, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command, cwd=cwd, text=True, capture_output=True, check=check,
        env=safe_child_environment(), shell=False, encoding="utf-8", errors="replace",
    )


def git(*args: str, cwd: Path = ROOT, check: bool = True) -> subprocess.CompletedProcess[str]:
    return run(["git", *args], cwd=cwd, check=check)


def safe_slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    if not slug:
        raise ValueError("Task id cannot produce an empty branch slug")
    return slug[:60]


def normalize_untrusted_text(value: object, limit: int = 6000) -> str:
    text = str(value or "")
    text = "".join(character for character in text if character in "\n\t" or ord(character) >= 32)
    return text[:limit]


def qa_issue_to_task(issue: dict[str, Any], route_types: set[str]) -> dict[str, Any] | None:
    if issue.get("status", "open") not in {"open", "pending"}:
        return None
    issue_id = normalize_untrusted_text(issue.get("id", "QA-UNSPECIFIED"), 80)
    title = normalize_untrusted_text(issue.get("title", issue_id), 300)
    description = normalize_untrusted_text(issue.get("description", ""))
    requested_type = normalize_untrusted_text(issue.get("type", "test"), 80)
    task_type = requested_type if requested_type in route_types else "test"
    priority = normalize_untrusted_text(issue.get("priority", "P1"), 2)
    if priority not in PRIORITY:
        priority = "P1"
    evidence = {"id": issue_id, "title": title, "description": description}
    fingerprint = hashlib.sha256(
        json.dumps(evidence, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    return {
        "id": issue_id,
        "title": title,
        "type": task_type,
        "priority": priority,
        "status": "pending",
        "prompt": "Await human promotion to a trusted automation/backlog.json task before model execution.",
        "manual_merge_required": True,
        "source": "qa-issues.json",
        "untrustedEvidence": True,
        "evidence": evidence,
        "fingerprint": fingerprint,
    }


def load_qa_tasks(config: dict[str, Any]) -> list[dict[str, Any]]:
    path = ROOT / str(config.get("qa_issues_path", "qa-issues.json"))
    if not path.exists():
        return []
    payload = load_json(path)
    issues = payload.get("issues", [])
    if not isinstance(issues, list):
        raise ValueError("qa-issues.json issues must be an array")

    routes = config.get("task_routing", {})
    route_types = set(routes) if isinstance(routes, dict) else {"test"}
    state = load_json(STATE_PATH) if STATE_PATH.exists() else {}
    triaged = state.get("triagedQa", {})
    triaged = triaged if isinstance(triaged, dict) else {}
    tasks: list[dict[str, Any]] = []
    for issue in issues:
        if not isinstance(issue, dict):
            continue
        task = qa_issue_to_task(issue, route_types)
        previous = triaged.get(task["id"]) if task else None
        if task and (not isinstance(previous, dict) or previous.get("fingerprint") != task["fingerprint"]):
            tasks.append(task)
    return tasks


def select_task(config: dict[str, Any], requested_id: str | None) -> dict[str, Any]:
    backlog = load_json(BACKLOG_PATH).get("tasks", [])
    if not isinstance(backlog, list):
        raise ValueError("automation/backlog.json tasks must be an array")
    candidates = [*load_qa_tasks(config), *[task for task in backlog if isinstance(task, dict)]]
    candidates = [task for task in candidates if task.get("status") in {"pending", "ready"}]
    if requested_id:
        matches = [task for task in candidates if task.get("id") == requested_id]
        if not matches:
            raise ValueError(f"Pending task not found: {requested_id}")
        return matches[0]
    if not candidates:
        raise ValueError("No pending task in backlog or qa-issues.json")
    return sorted(candidates, key=lambda task: (PRIORITY.get(str(task.get("priority")), 9), str(task.get("id"))))[0]


def route_task(config: dict[str, Any], task: dict[str, Any]) -> Route:
    routes = config.get("task_routing", {})
    _, domain = normalize_domain(config, task.get("type"))
    primary_routes = config.get("primary_route_by_domain", {})
    route_key = primary_routes.get(domain, domain) if isinstance(primary_routes, dict) else domain
    route = routes.get(route_key) if isinstance(routes, dict) else None
    if not isinstance(route, dict):
        raise ValueError(f"No route for task type: {task.get('type')}")
    return Route(agent=str(route["agent"]), model=str(route["model"]), reasoning=str(route["reasoning"]))


def route_task_dag(config: dict[str, Any], task: dict[str, Any]) -> RoleDag:
    dag = build_role_dag(config, task)
    assert_acyclic(dag)
    return dag


def ensure_clean_base(dry_run: bool) -> None:
    status = git("status", "--porcelain").stdout.strip()
    if status and not dry_run:
        raise RuntimeError("Working tree must be clean before creating an automation worktree.")


def prepare_worktree(config: dict[str, Any], task: dict[str, Any], dry_run: bool) -> tuple[str, Path]:
    slug = safe_slug(str(task["id"]))
    branch = f"codex/automation/{slug}"
    worktree_root = (ROOT / str(config.get("worktree_root", ".worktrees"))).resolve()
    worktree = (worktree_root / slug).resolve()
    if ROOT not in worktree.parents:
        raise RuntimeError("Worktree path escaped the repository root")
    if dry_run:
        return branch, worktree
    worktree_root.mkdir(parents=True, exist_ok=True)
    if worktree.exists():
        registered = {
            Path(line.removeprefix("worktree ")).resolve()
            for line in git("worktree", "list", "--porcelain").stdout.splitlines()
            if line.startswith("worktree ")
        }
        if worktree not in registered:
            raise RuntimeError(f"Existing automation path is not a registered Git worktree: {worktree}")
        verify_reusable_worktree(worktree, branch)
        return branch, worktree

    branch_exists = git("show-ref", "--verify", "--quiet", f"refs/heads/{branch}", check=False).returncode == 0
    command = ["worktree", "add"]
    if not branch_exists:
        command.extend(["-b", branch])
    command.extend([str(worktree), branch if branch_exists else "HEAD"])
    git(*command)
    return branch, worktree


def verify_reusable_worktree(worktree: Path, expected_branch: str) -> None:
    actual_branch = git("branch", "--show-current", cwd=worktree).stdout.strip()
    if actual_branch != expected_branch:
        raise RuntimeError(
            f"Automation worktree branch mismatch: expected {expected_branch}, found {actual_branch or 'detached HEAD'}"
        )
    if git("status", "--porcelain", cwd=worktree).stdout.strip():
        raise RuntimeError(f"Automation worktree contains uncommitted changes: {worktree}")


def codex_command(route: Route, model: str, worktree: Path, prompt: str, output_path: Path) -> list[str]:
    return [
        "codex", "exec", "--model", model,
        "--config", f'model_reasoning_effort="{route.reasoning}"',
        "--sandbox", "workspace-write", "--json", "--ephemeral",
        "--output-last-message", str(output_path), "--cd", str(worktree), prompt,
    ]


def validation_commands(config: dict[str, Any], task: dict[str, Any]) -> list[str]:
    commands = task.get("validation") or config.get("default_validation", [])
    if not isinstance(commands, list) or not all(isinstance(item, str) for item in commands):
        raise ValueError("Validation commands must be an array of strings")
    for command in commands:
        parse_validation_command(command)
    return commands


def parse_validation_command(command: str) -> list[str]:
    if re.search(r"[;&|><`$]", command):
        raise ValueError(f"Validation command contains shell metacharacters: {command}")
    tokens = shlex.split(command, posix=True)
    if len(tokens) < 3 or tokens[0] != "npm" or tokens[1] != "run":
        raise ValueError(f"Only `npm run <script>` validation commands are allowed: {command}")
    if re.fullmatch(r"[A-Za-z0-9:_-]+", tokens[2]) is None:
        raise ValueError(f"Invalid npm script name in validation command: {command}")
    if tokens[2] not in ALLOWED_VALIDATION_SCRIPTS:
        raise ValueError(f"Validation script is not allowlisted: {tokens[2]}")
    for token in tokens[3:]:
        if re.fullmatch(r"[A-Za-z0-9_./:=@-]+", token) is None:
            raise ValueError(f"Unsafe validation argument in command: {command}")
    if os.name == "nt":
        tokens[0] = "npm.cmd"
    return tokens


def run_validation(commands: list[str], cwd: Path, log_path: Path) -> tuple[bool, str]:
    chunks: list[str] = []
    for command in commands:
        completed = subprocess.run(
            parse_validation_command(command), cwd=cwd, text=True, capture_output=True, shell=False,
            env=safe_child_environment(), timeout=900, encoding="utf-8", errors="replace",
        )
        chunks.append(redact(f"$ {command}\n{completed.stdout}\n{completed.stderr}".strip()))
        if completed.returncode != 0:
            text = "\n\n".join(chunks)
            log_path.write_text(text, encoding="utf-8")
            return False, text[-6000:]
    text = "\n\n".join(chunks)
    log_path.write_text(text, encoding="utf-8")
    return True, text[-6000:]


def changed_files(cwd: Path) -> set[str]:
    changed = set(git("diff", "--name-only", "HEAD", cwd=cwd).stdout.splitlines())
    changed.update(git("ls-files", "--others", "--exclude-standard", cwd=cwd).stdout.splitlines())
    return changed


def protected_changes(config: dict[str, Any], cwd: Path) -> list[str]:
    changed = changed_files(cwd)
    patterns = [str(item) for item in config.get("protected_change_patterns", [])]
    return sorted(path for path in changed if any(path == pattern or path.startswith(pattern) for pattern in patterns))


def assert_automation_change_scope(config: dict[str, Any], task: dict[str, Any], cwd: Path) -> None:
    if task.get("allow_supply_chain_changes") is True:
        return
    patterns = [str(item) for item in config.get("automation_forbidden_paths", [])]
    forbidden = sorted(
        path for path in changed_files(cwd)
        if any(path == pattern or path.startswith(pattern) for pattern in patterns)
    )
    if forbidden:
        raise RuntimeError(
            "Automated task changed protected supply-chain/governance files before validation: "
            + ", ".join(forbidden)
        )


def assert_role_change_scope(task: dict[str, Any], role_dag: RoleDag, cwd: Path) -> None:
    roles = enabled_roles()
    writer_roles = [
        roles[stage.role_id]
        for stage in role_dag.stages
        if stage.mode == "workspace-write" and stage.role_id in roles
    ]
    if not writer_roles:
        if changed_files(cwd):
            raise RuntimeError("Task has no authorized workspace-write role")
        return
    effective_manifest = {
        "role_id": "+".join(str(role["role_id"]) for role in writer_roles),
        "write_paths": sorted({str(path) for role in writer_roles for path in role.get("write_paths", [])}),
        "forbidden_paths": sorted({str(path) for role in writer_roles for path in role.get("forbidden_paths", [])}),
    }
    task_paths = task.get("write_paths")
    if task_paths is not None and (not isinstance(task_paths, list) or not all(isinstance(path, str) for path in task_paths)):
        raise RuntimeError("Trusted task write_paths must be a string array")
    try:
        assert_write_scope(cwd, effective_manifest, changed_files(cwd), task_paths)
    except ValueError as error:
        raise RuntimeError(f"Role/task write scope violation: {error}") from error


def agent_instructions(agent_name: str) -> str:
    path = ROOT / ".codex" / "agents" / f"{agent_name}.toml"
    if not path.is_file():
        raise ValueError(f"Custom agent config not found: {agent_name}")
    with path.open("rb") as handle:
        payload = tomllib.load(handle)
    instructions = payload.get("developer_instructions")
    if not isinstance(instructions, str) or not instructions.strip():
        raise ValueError(f"Custom agent has no developer instructions: {agent_name}")
    return instructions.strip()


def write_state(**values: Any) -> None:
    current = load_json(STATE_PATH)
    current.update(values)
    current["lastUpdatedAt"] = dt.datetime.now(dt.timezone.utc).isoformat()
    STATE_PATH.write_text(json.dumps(current, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_report(config: dict[str, Any], payload: dict[str, Any]) -> tuple[Path, Path]:
    report_dir = ROOT / str(config.get("reports_dir", "automation/reports"))
    report_dir.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    base = f"{safe_slug(str(payload['task']['id']))}-{stamp}"
    json_path = report_dir / f"{base}.json"
    md_path = report_dir / f"{base}.md"
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    md = [
        f"# Automation Report: {payload['task']['id']}",
        "",
        f"- Status: `{payload['status']}`",
        f"- Agent: `{payload['route']['agent']}`",
        f"- Prompt expected model: `{payload['route']['model']}`",
        f"- Prompt expected reasoning: `{payload['route']['reasoning']}`",
        f"- Runtime model: `{payload.get('runtimeModel') or 'not executed'}`",
        f"- Branch: `{payload['branch']}`",
        f"- Attempts: `{payload['attempts']}`",
        f"- Manual merge required: `{str(payload['manualMergeRequired']).lower()}`",
        "",
        "## Validation",
        "",
        *[f"- `{command}`" for command in payload["validation"]],
        "",
        "## Protected Changes",
        "",
        *([f"- `{path}`" for path in payload["protectedChanges"]] or ["- None"]),
    ]
    role_dag = payload.get("roleDag")
    if isinstance(role_dag, dict):
        md.extend(["", "## Role DAG", ""])
        for stage in role_dag.get("stages", []):
            if isinstance(stage, dict):
                md.append(
                    f"- `{stage.get('stage_id')}` → `{stage.get('role_id')}` "
                    f"({stage.get('provider')}, {stage.get('mode')})"
                )
    md_path.write_text("\n".join(md) + "\n", encoding="utf-8")
    return json_path, md_path


def execute(config: dict[str, Any], task: dict[str, Any], route: Route, branch: str, worktree: Path, role_dag: RoleDag) -> dict[str, Any]:
    logs_dir = ROOT / "automation" / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    commands = validation_commands(config, task)
    max_retries = min(3, int(config.get("max_retries", 3)))
    failure_summary = ""
    success = False
    runtime_model = route.model
    fallback_model = str(config.get("cli_fallback_model", "")).strip()
    role_instructions = agent_instructions(route.agent)

    write_state(status="running", taskId=task["id"], attempt=0, branch=branch, worktree=str(worktree))
    for attempt in range(1, max_retries + 1):
        write_state(status="running", taskId=task["id"], attempt=attempt, branch=branch, worktree=str(worktree))
        last_message = logs_dir / f"{safe_slug(str(task['id']))}-attempt-{attempt}-message.md"
        codex_log = logs_dir / f"{safe_slug(str(task['id']))}-attempt-{attempt}-codex.jsonl"
        if attempt == 1:
            prompt = (
                f"Apply the project custom agent `{route.agent}` instructions below. Read AGENTS.md and applicable Skills.\n"
                f"<agent_instructions>\n{role_instructions}\n</agent_instructions>\n"
                f"Task: {task['prompt']} Do not deploy or merge. Run focused tests and report changed files."
            )
        else:
            prompt = (
                f"Apply `{route.agent}` instructions below and repair only the validation failure.\n"
                f"<agent_instructions>\n{role_instructions}\n</agent_instructions>\n"
                f"Do not weaken tests, type safety, authorization, or acceptance criteria. Failure summary:\n{failure_summary}"
            )
        completed = run(codex_command(route, runtime_model, worktree, prompt, last_message), cwd=worktree, check=False)
        if last_message.is_file():
            last_message.write_text(redact(last_message.read_text(encoding="utf-8", errors="replace")), encoding="utf-8")
        combined_output = redact(completed.stdout + "\n" + completed.stderr)
        if (
            completed.returncode != 0
            and fallback_model
            and runtime_model != fallback_model
            and "requires a newer version of Codex" in combined_output
        ):
            runtime_model = fallback_model
            combined_output += f"\n[orchestrator] Retrying with explicit CLI fallback model: {runtime_model}\n"
            completed = run(codex_command(route, runtime_model, worktree, prompt, last_message), cwd=worktree, check=False)
            if last_message.is_file():
                last_message.write_text(redact(last_message.read_text(encoding="utf-8", errors="replace")), encoding="utf-8")
            combined_output += redact(completed.stdout + "\n" + completed.stderr)
        codex_log.write_text(combined_output, encoding="utf-8")
        if completed.returncode != 0:
            failure_summary = redact(completed.stderr or completed.stdout)[-6000:]
            continue
        try:
            assert_automation_change_scope(config, task, worktree)
            assert_role_change_scope(task, role_dag, worktree)
        except RuntimeError as error:
            failure_summary = str(error)
            break
        success, failure_summary = run_validation(
            commands, worktree, logs_dir / f"{safe_slug(str(task['id']))}-attempt-{attempt}-validation.log"
        )
        if success:
            break

    protected = protected_changes(config, worktree)
    manual = bool(task.get("manual_merge_required")) or bool(protected)
    return {
        "status": "passed" if success else "failed",
        "task": task,
        "route": route.__dict__,
        "roleDag": role_dag.to_dict(),
        "runtimeModel": runtime_model,
        "branch": branch,
        "worktree": str(worktree),
        "attempts": attempt,
        "validation": commands,
        "protectedChanges": protected,
        "manualMergeRequired": manual,
        "failureSummary": "" if success else failure_summary,
        "deployed": False,
        "merged": False,
    }


def record_untrusted_qa(task: dict[str, Any], route: Route) -> dict[str, Any]:
    return {
        "status": "awaiting-approval",
        "task": task,
        "route": route.__dict__,
        "runtimeModel": None,
        "branch": "not-created",
        "worktree": "not-created",
        "attempts": 0,
        "validation": [],
        "protectedChanges": [],
        "manualMergeRequired": True,
        "failureSummary": "Untrusted QA evidence was not sent to a model. Promote a reviewed task into automation/backlog.json.",
        "deployed": False,
        "merged": False,
    }


def main() -> int:
    if len(sys.argv) > 1 and not sys.argv[1].startswith("-"):
        from pipeline_cli import main as pipeline_main

        return pipeline_main(sys.argv[1:])
    parser = argparse.ArgumentParser(description="Run the CelebrateDeal Codex team safely.")
    parser.add_argument("--task", help="Run one pending backlog or Antigravity issue id")
    parser.add_argument("--dry-run", action="store_true", help="Validate routing without creating a worktree or running Codex")
    args = parser.parse_args()

    config = load_json(CONFIG_PATH)
    task = select_task(config, args.task)
    route = route_task(config, task)
    is_untrusted_qa = task.get("source") == "qa-issues.json"
    role_dag = None if is_untrusted_qa else route_task_dag(config, task)
    ensure_clean_base(args.dry_run or is_untrusted_qa)
    branch, worktree = (
        ("not-created", ROOT)
        if is_untrusted_qa
        else prepare_worktree(config, task, args.dry_run)
    )

    if is_untrusted_qa and not args.dry_run:
        payload = record_untrusted_qa(task, route)
    elif args.dry_run:
        payload = {
            "status": "dry-run",
            "task": task,
            "route": route.__dict__,
            "roleDag": role_dag.to_dict() if role_dag else None,
            "runtimeModel": None,
            "cliFallbackModel": config.get("cli_fallback_model"),
            "branch": branch,
            "worktree": str(worktree),
            "attempts": 0,
            "validation": validation_commands(config, task),
            "protectedChanges": [],
            "manualMergeRequired": bool(task.get("manual_merge_required")),
            "deployed": False,
            "merged": False,
        }
    else:
        if role_dag is None:
            raise RuntimeError("Trusted execution requires a validated role DAG")
        payload = execute(config, task, route, branch, worktree, role_dag)

    json_report, markdown_report = write_report(config, payload)
    if not args.dry_run:
        triaged_qa: dict[str, Any] | None = None
        if is_untrusted_qa:
            state = load_json(STATE_PATH)
            existing = state.get("triagedQa", {})
            triaged_qa = dict(existing) if isinstance(existing, dict) else {}
            triaged_qa[str(task["id"])] = {
                "fingerprint": task["fingerprint"],
                "recordedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
                "report": str(markdown_report.relative_to(ROOT)),
            }
        write_state(
            status=payload["status"], taskId=task["id"], attempt=payload["attempts"],
            branch=branch, worktree=str(worktree), lastReport=str(markdown_report.relative_to(ROOT)),
            **({"triagedQa": triaged_qa} if triaged_qa is not None else {}),
        )
    print(json.dumps({
        "status": payload["status"],
        "task": task["id"],
        "agent": route.agent,
        "promptExpectedModel": route.model,
        "promptExpectedReasoning": route.reasoning,
        "runtimeModel": payload.get("runtimeModel"),
        "jsonReport": str(json_report.relative_to(ROOT)),
        "markdownReport": str(markdown_report.relative_to(ROOT)),
    }, ensure_ascii=False, indent=2))
    return 0 if payload["status"] in {"passed", "dry-run", "awaiting-approval"} else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"orchestrator error: {error}", file=sys.stderr)
        raise SystemExit(1)

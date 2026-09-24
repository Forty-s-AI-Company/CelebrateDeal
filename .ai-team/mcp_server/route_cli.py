"""JSON stdin adapter used by PowerShell. Never executes a model or reads secrets."""

import json
import sys
import tempfile

from routing import assess_acceptance, discover_slugs, load_config, route, snapshot_revision, validate_review
from pathlib import Path


def record_native_execution(request: dict) -> dict:
    """Check a bounded Codex JSONL result and the declared fixture diff before writing a receipt."""
    root = Path(__file__).resolve().parents[2]
    temporary_root = (root / ".ai-team" / "tmp").resolve(strict=True)
    events_path = Path(request["events_path"]).resolve(strict=True)
    output_path = Path(request["output_path"]).resolve()
    if (not events_path.is_relative_to(temporary_root) or not output_path.is_relative_to(temporary_root)
            or events_path.suffix != ".jsonl" or output_path.suffix != ".json"
            or events_path.stat().st_size > 2_000_000 or output_path.exists()):
        raise ValueError("Invalid native receipt path")
    decision = request["decision"]
    if (decision.get("status") != "planned" or decision.get("provider") != "native_agent"
            or decision.get("source_revision") == "unknown"
            or decision.get("snapshot_root") != str(root)
            or decision.get("task_id") != request.get("task_id")
            or not isinstance(request.get("run_id"), str) or not request["run_id"]):
        raise ValueError("Invalid native route")
    files = decision["snapshot_files"]
    protected_files = request["protected_files"]
    if not protected_files or not set(protected_files).issubset(files):
        raise ValueError("Protected files must be in the snapshot")
    after_revision = snapshot_revision(root, files)
    protected_unchanged = snapshot_revision(root, protected_files) == request["protected_revision"]
    terminal = False
    failed_event = False
    metadata_warnings = 0
    for line in events_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        event = json.loads(line)
        if not isinstance(event, dict):
            raise ValueError("Invalid Codex event")
        if event.get("type") == "turn.completed":
            terminal = True
        item = event.get("item")
        if (event.get("type") == "item.completed" and isinstance(item, dict)
                and item.get("type") == "error"
                and isinstance(item.get("message"), str)
                and item["message"].startswith("Skill descriptions were shortened to fit the skills context budget.")):
            # Codex may emit this setup warning before a successful turn.
            metadata_warnings += 1
        elif (event.get("type") in {"turn.failed", "error"}
              or (event.get("type") == "item.completed"
                  and isinstance(item, dict) and item.get("type") == "error")):
            failed_event = True
    completed = (type(request.get("exit_code")) is int and request["exit_code"] == 0
                 and terminal and not failed_event
                 and protected_unchanged and after_revision != decision["source_revision"])
    receipt = {"kind": "execution", "source": "native_runner",
               "task_id": request["task_id"], "run_id": request["run_id"],
               "before_revision": decision["source_revision"], "revision": after_revision,
               "requested": decision["requested"], "resolved": decision["resolved"],
               "observed": {"model": "unknown", "effort": "unknown", "source": "cli_did_not_report"},
               "metadata_warnings": metadata_warnings,
               "status": "COMPLETED" if completed else "BLOCKED",
               "provider_terminal": terminal and not failed_event,
               "tool_operations": "completed" if completed else "unverified"}
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=output_path.parent,
                                     delete=False) as handle:
        json.dump(receipt, handle, ensure_ascii=True)
        pending = Path(handle.name)
    pending.replace(output_path)
    return {**receipt, "evidence_path": str(output_path)}


def main() -> None:
    request = json.load(sys.stdin)
    action = request.get("action", "route")
    if action == "discover":
        result = discover_slugs(request["output"])
    elif action == "validate_review":
        result = validate_review(json.loads(request["output"]))
    elif action == "assess_acceptance":
        result = assess_acceptance(request["decision"], request["evidence"], Path(__file__).resolve().parents[2])
    elif action == "snapshot":
        root = Path(__file__).resolve().parents[2]
        result = {"root": str(root), "files": request["files"],
                  "revision": snapshot_revision(root, request["files"])}
    elif action == "record_native_execution":
        result = record_native_execution(request)
    elif action == "route":
        config = load_config(Path(request["config_path"]))
        result = route(request["task"], request.get("runtime"), request.get("team") or config["active_mode_id"], config)
    else:
        raise ValueError("Invalid adapter action")
    print(json.dumps(result, ensure_ascii=True))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, TypeError, KeyError, OSError):
        # No provider raw output or user input is echoed into errors.
        print(json.dumps({"status": "INVALID_INPUT"}))
        sys.exit(2)

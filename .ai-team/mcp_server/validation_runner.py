"""Run one explicit check without a shell and write a small, non-sensitive receipt."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path


def run_check(name: str, revision: str, command: list[str], output: Path,
              timeout: int = 120) -> dict:
    if not name or not revision or revision == "unknown" or not command or not 1 <= timeout <= 900:
        raise ValueError("Invalid validation request")
    started = time.monotonic()
    try:
        result = subprocess.run(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL, timeout=timeout, check=False)
        exit_code = result.returncode
        status = "PASS" if exit_code == 0 else "FAIL"
    except subprocess.TimeoutExpired:
        exit_code, status = None, "BLOCKED"
    except OSError:
        exit_code, status = None, "BLOCKED"
    receipt = {"kind": "validation", "source": "validation_runner", "name": name,
               "revision": revision, "status": status, "exit_code": exit_code,
               "duration_seconds": round(time.monotonic() - started, 3)}
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=output.parent,
                                     delete=False) as handle:
        json.dump(receipt, handle, ensure_ascii=True)
        temporary = Path(handle.name)
    temporary.replace(output)
    return receipt


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--timeout", type=int, default=120)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    receipt = run_check(args.name, args.revision, command, args.output, args.timeout)
    print(json.dumps(receipt, ensure_ascii=True))
    return 0 if receipt["status"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())

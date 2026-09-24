"""Credential-free bootstrap probe for the project-local MCP runtime."""

from __future__ import annotations

import json

from server import route_task, router_status


def main() -> None:
    status = router_status()
    route = route_task("copy edit", "copy")
    print(json.dumps({
        "status": "ok",
        "router_status": status["status"],
        "server": status["server"],
        "route_model": route["model"],
    }))


if __name__ == "__main__":
    main()

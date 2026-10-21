#!/usr/bin/env python3
"""Build deploy JSON for Supabase MCP deploy_edge_function (full file bodies)."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
# Every module the entrypoint imports has to travel with it: Supabase only serves
# the files that are uploaded, and a missing sibling is a boot-time import error.
NAMES = tuple(sorted(path.name for path in ROOT.glob("*.ts"))) + ("deno.json",)


def main() -> None:
    files = [{"name": n, "content": (ROOT / n).read_text()} for n in NAMES]
    payload = {
        "name": "hebelie-api",
        "entrypoint_path": "index.ts",
        "import_map_path": "deno.json",
        "verify_jwt": False,
        "files": files,
    }
    out = Path("/tmp/hebelie-api-deploy.json")
    out.write_text(json.dumps(payload))
    print(f"Wrote {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()

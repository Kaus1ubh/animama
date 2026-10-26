#!/usr/bin/env python3
"""A stand-in for the Claude CLI, for free rehearsals of the benchmark's judging (``judge --claude <this file>``).

It answers like ``claude -p --output-format stream-json`` with structured
output: every criterion scores 3 and every capture entry reads as not saved.
It makes no network call and needs no sign-in. Never use its scores for a
report anyone reads as a result.
"""

from __future__ import annotations

import json
import sys
from typing import Any


def main(argv: list[str]) -> int:
    if argv == ["--version"]:
        print("stub (no model)")
        return 0
    schema = json.loads(argv[argv.index("--json-schema") + 1])
    fields = schema["properties"]["items"]["items"]["properties"]
    batch = json.loads(sys.stdin.read())

    def result(item: dict[str, Any]) -> dict[str, Any]:
        if "entries" in fields:
            entries = [{"entry": entry["id"], "present": False, "evidence": ""} for entry in item["checklist"]]
            return {"id": item["id"], "entries": entries}
        return {"id": item["id"], **{key: 3 for key in fields if key != "id"}}

    output = {"items": [result(item) for item in batch["items"]]}
    model = argv[argv.index("--model") + 1]
    init = {"type": "system", "subtype": "init", "tools": ["StructuredOutput"], "mcp_servers": [],
            "slash_commands": [], "skills": [], "plugins": [], "model": model, "apiKeySource": "none"}  # fmt: skip
    print(json.dumps(init))
    print(json.dumps({"type": "result", "subtype": "success", "is_error": False, "result": json.dumps(output),
                      "structured_output": output, "modelUsage": {model: {}}, "usage": {}}))  # fmt: skip
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

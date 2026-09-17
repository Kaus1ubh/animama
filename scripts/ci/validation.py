#!/usr/bin/env python3
"""Bind conservative CI selection and acceptance to exact Git/event evidence."""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import subprocess
from pathlib import Path

from validation_policy import choose_plan, evaluate

SHA = re.compile(r"[0-9a-f]{40}")
WORKFLOW = "Portable product validation"


def git(root: Path, *args: str, env: dict | None = None, data: bytes | None = None) -> bytes:
    """Never interpolate event values into a shell or include credentials in logs."""
    result = subprocess.run(["git", "-C", str(root), *args], env=env, input=data, capture_output=True)
    if result.returncode:
        raise ValueError(f"Git {args[0]} failed (exit {result.returncode})")
    return result.stdout


def exact_sha(value: object) -> str:
    if not isinstance(value, str) or not SHA.fullmatch(value):
        raise ValueError("Expected a full immutable Git commit")
    return value


def fetch(root: Path, commits: list[str], depth: int) -> None:
    """Authenticate one read-only fetch without persisting checkout credentials."""
    env = os.environ.copy()
    token = env.pop("CI_READ_TOKEN", "")
    if token:
        server = env.get("GITHUB_SERVER_URL", "https://github.com")
        if server != "https://github.com":
            raise ValueError("Unexpected GitHub server for authenticated fetch")
        authorization = base64.b64encode(f"x-access-token:{token}".encode()).decode()
        env.update(
            GIT_CONFIG_COUNT="1",
            GIT_CONFIG_KEY_0=f"http.{server}/.extraheader",
            GIT_CONFIG_VALUE_0=f"AUTHORIZATION: basic {authorization}",
            GIT_TERMINAL_PROMPT="0",
        )
    git(root, "fetch", "--no-tags", f"--depth={depth}", "origin", *commits, env=env)


def parse_changes(data: bytes) -> list[dict]:
    """Parse complete NUL-delimited name-status output, including rename sources."""
    if data and not data.endswith(b"\0"):
        raise ValueError("Truncated changed-file discovery")
    fields = data.decode("utf-8", errors="strict").split("\0")[:-1]
    changes = []
    while fields:
        status = fields.pop(0)
        if not re.fullmatch(r"[ACDMRTUXB][0-9]*", status):
            raise ValueError("Unknown Git change status")
        count = 2 if status.startswith(("R", "C")) else 1
        if len(fields) < count:
            raise ValueError("Truncated changed-file discovery")
        paths, fields = fields[:count], fields[count:]
        if any(not path or path.startswith("/") or ".." in path.split("/") for path in paths):
            raise ValueError("Invalid changed path")
        changes.append({"status": status, "old_path": paths[0] if count == 2 else None, "path": paths[-1]})
    return changes


def discover(root: Path, event: dict) -> tuple[list[dict], str]:
    """Inspect the entire PR diff; shallow-history uncertainty never narrows checks."""
    pr = event["pull_request"]
    head, base = exact_sha(pr["head"]["sha"]), exact_sha(pr["base"]["sha"])
    for depth in (0, 32, 128, 512):
        if depth:
            fetch(root, [head, base], depth)
        try:
            merge_base = exact_sha(git(root, "merge-base", base, head).decode().strip())
            data = git(root, "diff", "--name-status", "-z", "--find-renames", merge_base, head, "--")
            return parse_changes(data), merge_base
        except ValueError:
            if depth == 512:
                raise ValueError("Complete PR merge-base diff unavailable after bounded fetch") from None
    raise AssertionError("Unreachable history search")


def provenance_paths(root: Path) -> set[str]:
    """Documentation used as attribution evidence is a product input, not prose-only."""
    document = json.loads((root / "docs/architecture/repository-provenance.json").read_text())
    paths = {row["path"] for row in document["files"]}
    for row in document["evidence"]:
        paths.update(row["path_sha256"])
    return paths


def special_inputs(root: Path, merge_base: str | None, changes: list[dict] | None) -> set[str]:
    """Executable, linked and LFS files are never a reduced prose/source profile."""
    excluded = set()
    for revision in filter(None, ("HEAD", merge_base)):
        for entry in git(root, "ls-tree", "-r", "-z", revision).split(b"\0"):
            if entry:
                metadata, path = entry.split(b"\t", 1)
                if metadata.split()[0] != b"100644":
                    excluded.add(path.decode())
    paths = [row["path"] for row in changes or []]
    if paths:
        attributes = git(
            root,
            "check-attr",
            "--cached",
            "-z",
            "--stdin",
            "filter",
            data=b"".join(path.encode() + b"\0" for path in paths),
        ).split(b"\0")
        for index in range(0, len(attributes) - 1, 3):
            if attributes[index + 2] == b"lfs":
                excluded.add(attributes[index].decode())
    return excluded


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def plan(root: Path, output: Path) -> None:
    event_name = os.environ["GITHUB_EVENT_NAME"]
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
    inputs = json.loads(os.environ.get("CI_INPUTS", "{}"))
    # A reusable workflow inherits its caller's event. Its declared marker is
    # mandatory/full; callers cannot lower it to request a reduced release gate.
    if "full-validation" in inputs and inputs["full-validation"] is not True:
        raise ValueError("Reusable validation must request the complete contract")
    reusable = "full-validation" in inputs or os.environ.get("GITHUB_WORKFLOW") != WORKFLOW
    changes, merge_base, error = None, None, None
    if event_name == "pull_request":
        try:
            changes, merge_base = discover(root, event)
        except (ValueError, KeyError, TypeError, UnicodeError) as exc:
            error = str(exc)
    try:
        excluded = provenance_paths(root) | special_inputs(root, merge_base, changes)
    except (ValueError, KeyError, TypeError, OSError):
        excluded, error = set(), "Cannot establish provenance exclusions"
    selected = choose_plan(event_name, event, changes, error, reusable, excluded)
    source = exact_sha(git(root, "rev-parse", "HEAD").decode().strip())
    if source != exact_sha(os.environ["GITHUB_SHA"]):
        raise ValueError("Checked-out source differs from the workflow source")
    pr = event.get("pull_request")
    pr = pr if isinstance(pr, dict) else {}
    head_record = pr.get("head")
    base_record = pr.get("base")
    labels = pr.get("labels")
    labels = labels if isinstance(labels, list) else []
    receipt = {
        "schema_version": 1,
        "source_commit": source,
        "source_tree": git(root, "rev-parse", "HEAD^{tree}").decode().strip(),
        "event": event_name,
        "action": event.get("action"),
        "reusable": reusable,
        "pull_request": event.get("number"),
        "head": head_record.get("sha") if isinstance(head_record, dict) else None,
        "base": base_record.get("sha") if isinstance(base_record, dict) else event.get("before"),
        "merge_base": merge_base,
        "changes": changes,
        "diff_error": error,
        "plan": selected,
        "run_id": os.environ.get("GITHUB_RUN_ID"),
        "run_attempt": os.environ.get("GITHUB_RUN_ATTEMPT"),
        "cold_cache": inputs.get("cold-cache", False),
    }
    write_json(output, receipt)
    with open(os.environ["GITHUB_OUTPUT"], "a") as target:
        target.write("plan=" + json.dumps(selected, separators=(",", ":")) + "\n")
        target.write("backend=" + selected["backend"] + "\n")
        target.write("portable=" + str(selected["portable"]).lower() + "\n")
        target.write("tree=" + receipt["source_tree"] + "\n")
        explicit = (
            reusable
            or event_name == "workflow_dispatch"
            or any(isinstance(label, dict) and label.get("name") == "ci:full" for label in labels)
        )
        target.write(f"retention={14 if explicit else 3}\n")
    print(json.dumps(receipt, indent=2))


def gate(output: Path) -> int:
    """Always write an acceptance receipt, even for invalid or absent router output."""
    try:
        needs = json.loads(os.environ.get("CI_NEEDS", "{}"))
    except ValueError:
        needs = None
    try:
        selected = json.loads(os.environ.get("CI_PLAN", ""))
    except ValueError:
        selected = None
    result = evaluate(selected, needs)
    receipt = {
        "schema_version": 1,
        "source_commit": os.environ.get("GITHUB_SHA"),
        "event": os.environ.get("GITHUB_EVENT_NAME"),
        "plan": selected,
        "needs": needs,
        **result,
    }
    write_json(output, receipt)
    if summary := os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(summary, "a") as target:
            target.write("## Validation acceptance\n\n" + result["reason"] + "\n")
    print(json.dumps(receipt, indent=2))
    return 0 if result["success"] else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("plan", "gate"))
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if args.operation == "gate":
        return gate(args.output)
    plan(Path.cwd(), args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

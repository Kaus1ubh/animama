#!/usr/bin/env python3
"""Reject private-source imports and external local dependencies in public code."""

import argparse
import ast
import json
import re
import subprocess
from pathlib import Path

import tomllib

PRIVATE = ("animama_cloud", "animama_hosted", "animama_discover", "@animama-cloud/", "animama-cloud/")


def check(root):
    """Inspect authored imports and manifests without importing product modules."""
    files = subprocess.check_output(["git", "-C", str(root), "ls-files", "-z"], text=True).split("\0")
    failures = []
    for name in filter(None, files):
        p = root / name
        if p.is_symlink() and not p.resolve().is_relative_to(root.resolve()):
            failures.append(name + ": external symlink")
        if not p.is_file():
            continue
        if name.startswith("src/") and p.suffix in {".py", ".js", ".mjs", ".ts", ".tsx"}:
            text = p.read_text(errors="replace")
            imports = []
            if p.suffix == ".py":
                for n in ast.walk(ast.parse(text)):
                    if isinstance(n, ast.Import):
                        imports.extend(a.name for a in n.names)
                    elif isinstance(n, ast.ImportFrom):
                        imports.append(n.module or "")
                    elif (
                        isinstance(n, ast.Call)
                        and n.args
                        and isinstance(n.args[0], ast.Constant)
                        and isinstance(n.args[0].value, str)
                    ):
                        f = n.func
                        if (isinstance(f, ast.Name) and f.id in {"__import__", "import_module"}) or (
                            isinstance(f, ast.Attribute) and f.attr == "import_module"
                        ):
                            imports.append(n.args[0].value)
            else:
                imports = re.findall(r"(?:from\s*|import\s*\(?|require\s*\()\s*[\'\"]([^\'\"]+)", text)
            for value in imports:
                if any(value.startswith(x) for x in PRIVATE):
                    failures.append(name + ": private import " + value)
                if value.startswith(".") and not (p.parent / value).resolve().is_relative_to(root.resolve()):
                    failures.append(name + ": sibling source import")
        if p.name == "package.json":
            data = json.loads(p.read_text())
            for group in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
                for dep, value in data.get(group, {}).items():
                    if dep.startswith("@animama-cloud/"):
                        failures.append(name + ": private dependency")
                    if value.startswith(("file:", "link:")) and not (
                        p.parent / value.split(":", 1)[1]
                    ).resolve().is_relative_to(root.resolve()):
                        failures.append(name + ": external dependency path")
        if p.name == "pyproject.toml":
            data = tomllib.loads(p.read_text())
            for source in data.get("tool", {}).get("uv", {}).get("sources", {}).values():
                for row in source if isinstance(source, list) else [source]:
                    if "path" in row and not (p.parent / row["path"]).resolve().is_relative_to(root.resolve()):
                        failures.append(name + ": external Python dependency")
    if failures:
        raise ValueError("\n".join(failures))
    return {"tracked_paths": len(list(filter(None, files))), "private_dependencies": 0}


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    a = p.parse_args()
    try:
        print(json.dumps(check(a.root)))
    except ValueError as e:
        p.exit(1, str(e) + "\n")

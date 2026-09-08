#!/usr/bin/env python3
"""Reject transitive local/private dependencies from shared backend APIs."""

from __future__ import annotations

import argparse
import ast
import importlib.util
import json
from collections import deque
from pathlib import Path

SHARED_PREFIXES = ("animama.domain", "animama.app")
FORBIDDEN_PREFIXES = (
    "animama.local",
    "animama.server",
    "animama.runtime",
    "animama.logging_config",
    "animama.hooks",
    "animama.orm.engine",
    "animama.orm.installation",
    "animama.hosted",
    "animama.hosted_demo",
    "animama.discover",
    "animama.cloud",
    "better_auth",
    "electron",
    "boto3",
    "botocore",
)


def under(module: str, prefixes: tuple[str, ...]) -> bool:
    """Match Python module boundaries rather than textual filename fragments."""
    return any(module == prefix or module.startswith(prefix + ".") for prefix in prefixes)


def module_inventory(root: Path) -> dict[str, Path]:
    """Inventory all Python modules without importing or executing project code."""
    modules = {}
    for path in sorted((root / "animama").rglob("*.py")):
        parts = path.relative_to(root).with_suffix("").parts
        if parts[-1] == "__init__":
            parts = parts[:-1]
        modules[".".join(parts)] = path
    return modules


def imports(module: str, path: Path, modules: dict[str, Path]) -> set[str]:
    """Resolve absolute/relative imports, package initializers and literal imports."""
    result = set()
    package = module if path.name == "__init__.py" else module.rpartition(".")[0]
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    dynamic_names = {"__import__", "import_module"}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module in {"importlib", "builtins"}:
            dynamic_names.update(
                alias.asname or alias.name for alias in node.names if alias.name in {"import_module", "__import__"}
            )
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            result.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            base = (
                importlib.util.resolve_name("." * node.level + (node.module or ""), package)
                if node.level
                else (node.module or "")
            )
            result.add(base)
            result.update(
                f"{base}.{alias.name}"
                for alias in node.names
                if f"{base}.{alias.name}" in modules or under(f"{base}.{alias.name}", FORBIDDEN_PREFIXES)
            )
        elif isinstance(node, ast.Call) and (
            isinstance(node.func, ast.Name)
            and node.func.id in dynamic_names
            or isinstance(node.func, ast.Attribute)
            and node.func.attr in {"import_module", "__import__"}
        ):
            if not node.args or not isinstance(node.args[0], ast.Constant) or not isinstance(node.args[0].value, str):
                result.add(f"<unresolved dynamic import in {module}:{node.lineno}>")
            else:
                target = node.args[0].value
                if target.startswith("."):
                    supplied_package = (
                        node.args[1]
                        if len(node.args) > 1
                        else next((keyword.value for keyword in node.keywords if keyword.arg == "package"), None)
                    )
                    if not isinstance(supplied_package, ast.Constant) or not isinstance(supplied_package.value, str):
                        result.add(f"<unresolved dynamic import in {module}:{node.lineno}>")
                        continue
                    target = importlib.util.resolve_name(target, supplied_package.value)
                result.add(target)
    # Python executes every real package __init__ on the way to a leaf module.
    for target in tuple(result) + (module,):
        parts = target.split(".")
        result.update(".".join(parts[:end]) for end in range(1, len(parts)) if ".".join(parts[:end]) in modules)
    result.discard(module)
    return result


def audit(root: Path) -> dict:
    """Walk every shared module and report the shortest forbidden dependency path."""
    modules = module_inventory(root)
    shared = sorted(module for module in modules if under(module, SHARED_PREFIXES))
    if not shared:
        raise ValueError(f"No shared backend modules found beneath {root}")
    graph = {module: imports(module, path, modules) for module, path in modules.items()}
    visited = set(shared)
    queue = deque((module, (module,)) for module in shared)
    failures = []
    while queue:
        module, chain = queue.popleft()
        for target in sorted(graph.get(module, ())):
            next_chain = (*chain, target)
            if under(target, FORBIDDEN_PREFIXES) or target.startswith("<unresolved dynamic import"):
                failures.append(" -> ".join(next_chain))
            elif target in modules and target not in visited:
                visited.add(target)
                queue.append((target, next_chain))
    if failures:
        raise ValueError("Forbidden shared backend dependency:\n" + "\n".join(sorted(set(failures))))
    return {"shared_modules": len(shared), "reachable_project_modules": len(visited), "forbidden_edges": 0}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path(__file__).resolve().parents[2] / "src/backend")
    args = parser.parse_args()
    try:
        print(json.dumps(audit(args.source), sort_keys=True))
    except (OSError, SyntaxError, ValueError) as error:
        parser.exit(1, f"{error}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Render shared HTTP contracts in an independently installed backend environment.

No delivery module is needed to construct the retained product request/response
views. Run with Python isolated mode from outside the source checkout.
"""

from __future__ import annotations

import importlib
import json
import sys

from pydantic import BaseModel

MODULES = (
    "anima_loadout",
    "chat",
    "chat_history",
    "content",
    "dispatch",
    "elevenlabs",
    "idle",
    "memory_entry",
    "memory_manager",
    "model_provider",
    "model_roles",
    "runtime_content",
    "typed_content",
    "user_profile",
)


def main() -> None:
    """Build the reusable schemas without bootstrapping a local application."""

    count = 0
    for name in MODULES:
        module = importlib.import_module(f"animama.app.contracts.{name}")
        for value in vars(module).values():
            if (
                isinstance(value, type)
                and issubclass(value, BaseModel)
                and value.__module__ == module.__name__
                and not value.__name__.startswith("_")
            ):
                value.model_json_schema()
                count += 1
    forbidden = (
        "animama.local",
        "animama.server",
        "animama.runtime",
        "animama.hooks",
        "animama.logging_config",
    )
    leaked = sorted(name for name in sys.modules if any(name == p or name.startswith(p + ".") for p in forbidden))
    assert not leaked, f"Shared contract imports initialized local composition: {leaked}"
    print(json.dumps({"modules": len(MODULES), "schemas": count, "local_imports": len(leaked)}))


if __name__ == "__main__":
    main()

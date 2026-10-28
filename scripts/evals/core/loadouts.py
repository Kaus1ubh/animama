"""Equipped Gesture lists (loadouts) the evaluations show the chat model."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

from animama.app.chat import RuntimeGestureDescriptor

from .inputs import EvalInputError, read_json, required_text

__all__ = ["Loadout", "load_loadout"]


@dataclass(frozen=True, slots=True)
class Loadout:
    """An equipped Gesture list, in the order the harness lists it to the model."""

    name: str
    gestures: tuple[RuntimeGestureDescriptor, ...]
    sha256: str = field(default="", compare=False)
    """SHA-256 of the loaded file's bytes, when it came from a file."""

    @property
    def selectors(self) -> tuple[str, ...]:
        return tuple(gesture.selector for gesture in self.gestures)


def load_loadout(path: Path) -> Loadout:
    """Read a loadout file: a non-empty JSON list of ``{selector, name, description}``."""

    data, sha256 = read_json(path)
    if not isinstance(data, list) or not data:
        raise EvalInputError(f"{path}: expected a non-empty JSON list of Gestures")
    gestures: list[RuntimeGestureDescriptor] = []
    selectors: set[str] = set()
    for index, entry in enumerate(data):
        where = f"{path}[{index}]"
        if not isinstance(entry, Mapping):
            raise EvalInputError(f"{where}: expected an object")
        selector = required_text(entry, "selector", where)
        if selector in selectors:
            raise EvalInputError(f"{where}: duplicate selector {selector!r}")
        selectors.add(selector)
        gestures.append(
            RuntimeGestureDescriptor(
                selector=selector,
                name=required_text(entry, "name", where),
                description=required_text(entry, "description", where),
            )
        )
    return Loadout(name=path.stem, gestures=tuple(gestures), sha256=sha256)

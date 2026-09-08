"""Normalize shipped Actions around their human-readable product folders.

The script is intentionally idempotent. It converts the legacy generated
Included layout into the same Action-owned layout written by the creators:

* ``<action>.meta.json`` is the typed Gesture/Reaction control document;
* ``<action>.json`` or ``<action>.vrma`` is the executable payload;
* one-owner Pose Clips live with their Action;
* Starter Idle Style animations live with the Idle Style rather than appearing
  as unrelated Gestures.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
INCLUDED_ROOT = REPOSITORY_ROOT / "content/included"


def _read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Expected a JSON object: {path}")
    return value


def _write_json(path: Path, value: dict[str, Any]) -> None:
    """Atomically replace one normalized JSON document."""

    temporary = path.with_name(f".{path.name}.normalize-tmp")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary.replace(path)


def _normalize_pose_action(action_root: Path, *, content_type: str) -> bool:
    """Move one legacy Pose Clip dependency into its owning Action folder."""

    slug = action_root.name
    old_control = action_root / f"{slug}.json"
    new_control = action_root / f"{slug}.meta.json"
    if new_control.exists():
        return False
    if not old_control.is_file():
        return False

    document = _read_json(old_control)
    if document.get("content_type") != content_type:
        return False
    implementation = document.get("implementation")
    if not isinstance(implementation, dict) or implementation.get("kind") != "anima_clip":
        return False
    technical_source = implementation.get("technical_source")
    if not isinstance(technical_source, dict) or technical_source.get("type") != "content_dependency":
        return False
    pose_ref = technical_source.get("ref")
    if not isinstance(pose_ref, str) or not pose_ref:
        raise ValueError(f"Action has an invalid Pose Clip reference: {old_control}")

    pose_source = INCLUDED_ROOT / "pose-clips" / f"{pose_ref}.json"
    if not pose_source.is_file():
        raise FileNotFoundError(f"Action Pose Clip is missing: {pose_source}")

    dependencies = document.get("dependencies", [])
    if not isinstance(dependencies, list):
        raise ValueError(f"Action dependencies must be an array: {old_control}")
    retained_dependencies = [
        dependency
        for dependency in dependencies
        if not (
            isinstance(dependency, dict)
            and dependency.get("content_type") == "pose_clip"
            and dependency.get("ref") == pose_ref
        )
    ]
    if len(retained_dependencies) == len(dependencies):
        raise ValueError(f"Action does not declare its Pose Clip dependency: {old_control}")

    document["implementation"] = {"kind": "anima_clip", "file_role": "sequence"}
    document["files"] = [{"path": f"{slug}.json", "role": "sequence"}]
    document["dependencies"] = retained_dependencies

    old_control.replace(new_control)
    _write_json(new_control, document)
    pose_source.replace(old_control)
    return True


def _normalize_pose_actions() -> None:
    """Normalize every shipped pose-backed Gesture and Reaction."""

    converted = 0
    for directory, content_type in (("gestures", "gesture"), ("reactions", "reaction")):
        family_root = INCLUDED_ROOT / directory
        for action_root in sorted(path for path in family_root.iterdir() if path.is_dir()):
            converted += int(_normalize_pose_action(action_root, content_type=content_type))

    remaining = sorted((INCLUDED_ROOT / "pose-clips").glob("*.json"))
    if len(remaining) == 1 and remaining[0].stem == "meme-dab":
        action_root = INCLUDED_ROOT / "gestures/meme-dab"
        action_root.mkdir(parents=True, exist_ok=True)
        remaining[0].replace(action_root / "meme-dab.json")
        _write_json(
            action_root / "meme-dab.meta.json",
            {
                "schema_version": 1,
                "content_type": "gesture",
                "content_id": "builtin:gesture:meme-dab",
                "version": 1,
                "semantic_key": "meme-dab",
                "name": "meme-dab",
                "ai_description": "Reusable avatar pose clip",
                "implementation": {"kind": "anima_clip", "file_role": "sequence"},
                "files": [{"path": "meme-dab.json", "role": "sequence"}],
                "dependencies": [],
            },
        )
        remaining = []

    if remaining:
        names = ", ".join(path.name for path in remaining)
        raise ValueError(f"Unclassified Included Pose Clips remain: {names}")
    pose_root = INCLUDED_ROOT / "pose-clips"
    if pose_root.exists() and not any(pose_root.iterdir()):
        pose_root.rmdir()

    if converted not in {0, 93}:
        raise ValueError(f"Expected either zero or 93 legacy Action conversions, found {converted}")


def _normalize_starter_idle_style() -> set[str]:
    """Move Idle Style-owned VRMAs out of the Gesture product directory."""

    descriptor = INCLUDED_ROOT / "idle-styles/starter/starter.json"
    document = _read_json(descriptor)
    animations = document.get("animations")
    dependencies = document.get("dependencies")
    if not isinstance(animations, list) or not isinstance(dependencies, list):
        raise ValueError("Starter Idle Style animations and dependencies must be arrays")

    owned_refs: set[str] = set()
    declared_files: list[dict[str, str]] = []
    animation_root = descriptor.parent / "animations"
    animation_root.mkdir(parents=True, exist_ok=True)
    for animation in animations:
        if not isinstance(animation, dict):
            raise ValueError("Starter Idle Style animation entries must be objects")
        technical_source = animation.pop("technical_source", None)
        if isinstance(technical_source, dict) and technical_source.get("type") == "content_dependency":
            reference = technical_source.get("ref")
            if not isinstance(reference, str) or not reference.startswith("gestures/"):
                raise ValueError("Starter Idle Style dependency reference is invalid")
            owned_refs.add(reference)
            source = INCLUDED_ROOT / reference
            filename = Path(reference).name.removeprefix("idle_")
            destination = animation_root / filename
            if source.exists():
                source.replace(destination)
            elif not destination.exists():
                raise FileNotFoundError(f"Starter Idle Style animation is missing: {source}")
            animation["file_ref"] = f"animations/{filename}"
        file_ref = animation.get("file_ref")
        if not isinstance(file_ref, str):
            raise ValueError("Starter Idle Style animation requires a local file_ref")
        declared_files.append({"path": file_ref, "role": "animation"})

    document["files"] = declared_files
    document["dependencies"] = [
        dependency
        for dependency in dependencies
        if not (isinstance(dependency, dict) and dependency.get("ref") in owned_refs)
    ]
    _write_json(descriptor, document)
    return owned_refs


def _normalize_vrma_gestures(idle_owned_refs: set[str]) -> None:
    """Place every remaining shipped VRMA Gesture in its own product folder."""

    gesture_root = INCLUDED_ROOT / "gestures"
    for source in sorted(gesture_root.glob("*.vrma")):
        relative = source.relative_to(INCLUDED_ROOT).as_posix()
        if relative in idle_owned_refs:
            continue
        slug = source.stem
        action_root = gesture_root / slug
        action_root.mkdir(parents=True, exist_ok=True)
        destination = action_root / source.name
        source.replace(destination)

        old_control = gesture_root / f"{slug}.meta.json"
        if old_control.exists():
            document = _read_json(old_control)
        else:
            document = {
                "schema_version": 1,
                "content_type": "gesture",
                "content_id": f"builtin:gesture:{slug}",
                "version": 1,
                "semantic_key": slug,
                "name": slug,
            }
        document.setdefault("schema_version", 1)
        document.setdefault("content_type", "gesture")
        document.setdefault("content_id", f"builtin:gesture:{slug}")
        document.setdefault("version", 1)
        document.setdefault("semantic_key", slug)
        document.setdefault("name", slug)
        document["implementation"] = {"kind": "vrma", "file_role": "animation"}
        document["files"] = [{"path": source.name, "role": "animation"}]
        document.setdefault("dependencies", [])
        _write_json(action_root / f"{slug}.meta.json", document)
        old_control.unlink(missing_ok=True)


def main() -> None:
    """Apply the complete Included Action layout normalization."""

    _normalize_pose_actions()
    idle_owned_refs = _normalize_starter_idle_style()
    _normalize_vrma_gestures(idle_owned_refs)


if __name__ == "__main__":
    main()

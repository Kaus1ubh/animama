"""Merge Included Avatar Effects that share art into family effects (ADR 0025, #543).

Usage (from the repository root)::

    uv run python scripts/content/merge_avatar_effects.py           # dry run
    uv run python scripts/content/merge_avatar_effects.py --write

A one-time repository migration, run before the merged variants are deleted
with ``pnpm -s effects promote``. It:

- writes each new family effect (``vfx/avatar/<family>/``) from its default
  variant: the same art, placement and motion, with every member's sound
  declared as an optional pack sound (the default's as ``on-apply``);
- writes ``src/backend/animama/resources/avatar-effect-merges.json``, mapping
  each removed effect to its family and the override, sound or silence that
  reproduces it, and ``tests/fixtures/avatar-effect-merge-variants.json``,
  the removed definitions the equivalence test compares against;
- rewrites every Included Gesture and Reaction that names a removed effect
  with ``rewrite_action_effect_merges``, keeping each file's formatting
  (files Prettier formats are formatted with it again);
- adds licence and source-review records for the new family files and points
  Action provenance texts at the families.

Mirror pairs keep their right-hand effect; only the left twin is removed. The
run is idempotent: a second run changes nothing. It never deletes files.

It ran once on 2026-10-14, before the variants were deleted, and cannot run
again now that they are gone; it records how the map and the families were made.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

from animama.app.contracts.avatar_effect import AvatarEffectDefinitionV2
from animama.app.services.avatar_effect_merges import AvatarEffectMerge, rewrite_action_effect_merges

ROOT = Path(__file__).resolve().parents[2]
INCLUDED = ROOT / "content/included"
EFFECTS = INCLUDED / "vfx/avatar"
MERGES_RESOURCE = ROOT / "src/backend/animama/resources/avatar-effect-merges.json"
VARIANTS_FIXTURE = ROOT / "tests/fixtures/avatar-effect-merge-variants.json"
INVENTORY = INCLUDED / "licenses/inventory.json"
SOURCE_REVIEW = ROOT / "licenses/source-review.json"
TEMPLATES = ROOT / "src/frontend/web/src/assets/effect-templates"
WEB = ROOT / "src/frontend/web"
EFFECT_PREFIX = "builtin:avatar-effect:"
SOUND_PREFIX = "builtin:sound-effect:"
PARTS = ("attachment", "appearance", "motion")

#: New family effects: their default variant (art, placement and motion) and members.
FAMILIES: dict[str, dict[str, Any]] = {
    "kira_star": {
        "default": "kira_star_head",
        "members": [
            "kira_star_head",
            "kira_star_tehe",
            "kira_star_wish",
            "kira_star_wish_left",
            "laugh_sparkle",
            "please_sparkle",
        ],
        "name": "Kira Star",
        "description": (
            'A small white-and-gold four-point "kira" star twinkles with a quick spin, the anime sparkle '
            "for an idol wink, a hopeful wish, an oops or a haughty laugh. Each Gesture or Reaction places it "
            "beside the head or on a hand."
        ),
    },
    "hearts_burst": {
        "default": "hearts_burst_hands",
        "members": ["hearts_burst_hands", "hearts_burst_kyaa", "hearts_burst_soft", "pat_hearts"],
        "name": "Hearts Burst",
        "description": (
            "Three small red hearts pop one after another and float up a little, for a warm thank-you, "
            "a delighted squeal, a comforting pat or a gentle, lovestruck daydream."
        ),
    },
    "heart_pop": {
        "default": "finger_heart_pop",
        "members": ["finger_heart_pop", "heart_hands_pop_chest", "kiss_heart_head", "heart_throb"],
        "name": "Heart Pop",
        "description": (
            "A cartoon red heart pops out and throbs, for a finger heart, a two-hand heart, a blown kiss "
            "or a warm hand on the heart."
        ),
    },
    "impact_burst": {
        "default": "badum_burst",
        "members": ["badum_burst", "badum_burst_left", "fist_bump_burst", "high_five_burst"],
        "name": "Impact Burst",
        "description": (
            'A ring of short yellow comic impact lines flashes out and rings away, the "pa!" of a drum hit, '
            "a fist bump or a high five."
        ),
    },
    "puff": {
        "default": "sigh_puff",
        # Steam Puffs stays its own effect: it floats above the head, where Sigh
        # and Huff Puff's mouth face option (faceCleanup) cannot apply.
        "members": ["sigh_puff", "huff_puff"],
        "name": "Puff",
        "description": (
            "A little cartoon breath puff bursts out beside the mouth and drifts away as it fades, for a "
            'long sigh or a sulky "hmph!".'
        ),
    },
}
#: Left twins removed in favour of the right-hand effect they mirror.
MIRRORS = {
    "shake_lines_left": "shake_lines",
    "finger_gun_spark_left": "finger_gun_spark",
    "drumroll_ticks_left": "drumroll_ticks",
    "cheer_sparkles_head_left": "cheer_sparkles_head",
}


def _read(path: Path) -> tuple[Any, str]:
    raw = path.read_text(encoding="utf-8")
    return json.loads(raw), raw


def _python_format(value: Any, raw: str) -> str:  # noqa: ANN401
    """Serialize like ``raw``: two-space indent or compact, with its trailing newline."""
    newline = "\n" if raw.endswith("\n") else ""
    if raw.lstrip().startswith("{\n"):
        return json.dumps(value, ensure_ascii=False, indent=2) + newline
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")) + newline


def _effect(stem: str) -> dict[str, Any]:
    value, _ = _read(EFFECTS / stem / f"{stem}.json")
    return value


def _sound_key(descriptor: dict[str, Any]) -> str | None:
    for dependency in descriptor.get("dependencies", []):
        if dependency.get("content_type") == "sound_effect":
            return str(dependency["ref"]).removeprefix(SOUND_PREFIX)
    return None


def _art(descriptor: dict[str, Any], folder: Path) -> dict[str, Any]:
    """The art with each image named by its bytes' digest: copies of one image compare equal."""
    art = _normalized(descriptor["definition"])["art"]
    for key in ("image", "otherEyeImage"):
        if art.get(key):
            art[key] = hashlib.sha256((folder / art[key]).read_bytes()).hexdigest()
    return art


def _normalized(definition: dict[str, Any]) -> dict[str, Any]:
    return AvatarEffectDefinitionV2.model_validate(definition).model_dump(mode="json", by_alias=True)


def _family_sounds(family: dict[str, Any]) -> dict[str, str]:
    """Pack key → alias: the default's sound is ``on-apply``, every other its key."""
    sounds: dict[str, str] = {}
    default_key = _sound_key(_effect(family["default"]))
    if default_key:
        sounds[default_key] = "on-apply"
    for member in family["members"]:
        key = _sound_key(_effect(member))
        if key and key not in sounds:
            sounds[key] = key
    return sounds


def _family_descriptor(stem: str, family: dict[str, Any]) -> dict[str, Any]:
    descriptor = copy.deepcopy(_effect(family["default"]))
    descriptor["content_id"] = f"{EFFECT_PREFIX}{stem}"
    descriptor["version"] = 1
    descriptor["name"] = family["name"]
    descriptor["description"] = family["description"]
    sounds = _family_sounds(family)
    descriptor["dependencies"] = [
        {"ref": f"{SOUND_PREFIX}{key}", "content_type": "sound_effect", "alias": alias, "optional": True}
        for key, alias in sounds.items()
    ]
    definition = descriptor["definition"]
    definition.pop("soundAlias", None)
    if sounds:
        definition["soundAlias"] = "on-apply"
    return descriptor


def _merge(target: dict[str, Any], art_folder: Path, sounds: dict[str, str], variant: dict[str, Any]) -> dict[str, Any]:
    """The override, sound and silence that make ``target`` (art in ``art_folder``) play as ``variant``."""
    target_parts, variant_parts = _normalized(target["definition"]), _normalized(variant["definition"])
    variant_folder = EFFECTS / str(variant["content_id"]).removeprefix(EFFECT_PREFIX)
    target_parts["art"], variant_parts["art"] = _art(target, art_folder), _art(variant, variant_folder)
    for kept in ("region", "art", "faceOptions"):
        if target_parts[kept] != variant_parts[kept]:
            raise SystemExit(f"{variant['content_id']}: its {kept} differs from {target['content_id']}'s")
    if target_parts["attachment"]["kind"] != variant_parts["attachment"]["kind"]:
        raise SystemExit(f"{variant['content_id']}: its attachment kind differs from {target['content_id']}'s")
    override = {
        part: copy.deepcopy(variant["definition"].get(part, {}))
        for part in PARTS
        if target_parts[part] != variant_parts[part]
    }
    entry: dict[str, Any] = {}
    if override:
        entry["override"] = override
    key = _sound_key(variant)
    if key is None:
        if _sound_key(target) is not None:
            entry["silent"] = True
    elif sounds.get(key) != "on-apply":
        entry["soundAlias"] = sounds[key]
    return entry


def _plan() -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    """Return (family descriptors, merges, removed variants)."""
    families: dict[str, dict[str, Any]] = {}
    merges: dict[str, dict[str, Any]] = {}
    variants: dict[str, dict[str, Any]] = {}
    for stem, family in FAMILIES.items():
        descriptor = _family_descriptor(stem, family)
        families[stem] = descriptor
        sounds = _family_sounds(family)
        for member in family["members"]:
            variant = _effect(member)
            ref = f"{EFFECT_PREFIX}{member}"
            merges[ref] = {
                "ref": descriptor["content_id"],
                **_merge(descriptor, EFFECTS / family["default"], sounds, variant),
            }
            variants[ref] = {"definition": variant["definition"], "sound": _sound_key(variant)}
    for left, right in MIRRORS.items():
        target, variant = _effect(right), _effect(left)
        sounds = {key: "on-apply"} if (key := _sound_key(target)) else {}
        ref = f"{EFFECT_PREFIX}{left}"
        merges[ref] = {"ref": target["content_id"], **_merge(target, EFFECTS / right, sounds, variant)}
        variants[ref] = {"definition": variant["definition"], "sound": _sound_key(variant)}
    return families, dict(sorted(merges.items())), dict(sorted(variants.items()))


def _write_json(path: Path, value: Any, changes: list[str], *, write: bool, raw: str | None = None) -> None:  # noqa: ANN401
    text = _python_format(value, raw) if raw is not None else json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return
    changes.append(str(path.relative_to(ROOT)))
    if write:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")


def _write_families(families: dict[str, dict[str, Any]], changes: list[str], *, write: bool) -> None:
    for stem, descriptor in families.items():
        default = FAMILIES[stem]["default"]
        folder = EFFECTS / stem
        _write_json(folder / f"{stem}.json", descriptor, changes, write=write)
        for file in descriptor["files"]:
            source, target = EFFECTS / default / file["path"], folder / file["path"]
            if not target.exists() or target.read_bytes() != source.read_bytes():
                changes.append(str(target.relative_to(ROOT)))
                if write:
                    folder.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(source, target)
        thumbnail, copy_to = TEMPLATES / f"{default}.webp", TEMPLATES / f"{stem}.webp"
        if thumbnail.exists() and (not copy_to.exists() or copy_to.read_bytes() != thumbnail.read_bytes()):
            changes.append(str(copy_to.relative_to(ROOT)))
            if write:
                shutil.copyfile(thumbnail, copy_to)


def _actions() -> list[tuple[Path, Path]]:
    """(descriptor, clip) of every Included Gesture and Reaction."""
    found = []
    for meta in sorted([*INCLUDED.glob("gestures/*/*.meta.json"), *INCLUDED.glob("reactions/*/*.meta.json")]):
        descriptor, _ = _read(meta)
        role = (descriptor.get("implementation") or {}).get("file_role", "sequence")
        paths = [file["path"] for file in descriptor.get("files", []) if file.get("role") == role]
        if len(paths) == 1 and paths[0].endswith(".json"):
            found.append((meta, meta.parent / paths[0]))
    return found


def _rewrite_actions(merges: dict[str, AvatarEffectMerge], changes: list[str], *, write: bool) -> list[Path]:
    """Rewrite Included Actions; return the files Prettier must format again."""
    prettier: list[Path] = []
    for meta, clip_path in _actions():
        descriptor, descriptor_raw = _read(meta)
        clip, clip_raw = _read(clip_path)
        rewritten = rewrite_action_effect_merges(descriptor, clip, merges)
        if rewritten is None:
            continue
        for path, value, raw, old in (
            (meta, rewritten[0], descriptor_raw, descriptor),
            (clip_path, rewritten[1], clip_raw, clip),
        ):
            if value == old:
                continue
            if _python_format(old, raw) != raw:
                prettier.append(path)
            _write_json(path, value, changes, write=write, raw=raw)
    return prettier


def _rewrite_records(families: dict[str, dict[str, Any]], changes: list[str], *, write: bool) -> None:
    removed = {member: stem for stem, family in FAMILIES.items() for member in family["members"]}
    removed.update(MIRRORS)
    inventory, inventory_raw = _read(INVENTORY)
    rules = inventory["rules"]
    for rule in rules:
        if rule["glob"].startswith(("gestures/", "reactions/")):
            for old, new in removed.items():
                rule["provenance"] = re.sub(
                    rf"vfx/avatar/{old}(?![A-Za-z0-9_])", f"vfx/avatar/{new}", rule["provenance"]
                )
    for stem, family in FAMILIES.items():
        # The family repeats its default's definition and image, so it takes
        # the default's own rules (none: the general vfx/avatar rule covers it).
        default_prefix, prefix = f"vfx/avatar/{family['default']}/", f"vfx/avatar/{stem}/"
        members = ", ".join(f"vfx/avatar/{member}" for member in family["members"])
        for default_rule in [rule for rule in rules if rule["glob"].startswith(default_prefix)]:
            glob = prefix + default_rule["glob"].removeprefix(default_prefix)
            if any(rule["glob"] == glob for rule in rules):
                continue
            rules.insert(
                rules.index(default_rule),
                {
                    **default_rule,
                    "glob": glob,
                    "provenance": (
                        f"Agent-authored merge (ADR 0025, #543) of the Included effects {members}, which shared "
                        f"one image; its definition and image are those of vfx/avatar/{family['default']}, whose "
                        f"record follows, and Gestures and Reactions place it per use. {default_rule['provenance']}"
                    ),
                },
            )
    _write_json(INVENTORY, inventory, changes, write=write, raw=inventory_raw)

    review, review_raw = _read(SOURCE_REVIEW)
    records = review["files"]
    paths = {record["path"] for record in records}
    for stem, descriptor in families.items():
        default = FAMILIES[stem]["default"]
        copies = {
            f"content/included/vfx/avatar/{default}/{default}.json": f"content/included/vfx/avatar/{stem}/{stem}.json",
            f"src/frontend/web/src/assets/effect-templates/{default}.webp": (
                f"src/frontend/web/src/assets/effect-templates/{stem}.webp"
            ),
            **{
                f"content/included/vfx/avatar/{default}/{file['path']}": (
                    f"content/included/vfx/avatar/{stem}/{file['path']}"
                )
                for file in descriptor["files"]
            },
        }
        for source, target in copies.items():
            if target in paths:
                continue
            record = next((record for record in records if record["path"] == source), None)
            if record is not None:
                records.append({**copy.deepcopy(record), "path": target})
                paths.add(target)
    records.sort(key=lambda record: record["path"])
    _write_json(SOURCE_REVIEW, review, changes, write=write, raw=review_raw)


def main(argv: list[str] | None = None) -> int:
    """Plan or write the merge; print every file it changes."""
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--write", action="store_true", help="write the changes (default: dry run)")
    args = parser.parse_args(argv)
    families, merges, variants = _plan()
    changes: list[str] = []
    _write_families(families, changes, write=args.write)
    _write_json(MERGES_RESOURCE, {"version": 1, "merges": merges}, changes, write=args.write)
    _write_json(VARIANTS_FIXTURE, variants, changes, write=args.write)
    merge_map = {
        removed: AvatarEffectMerge(
            ref=merge["ref"],
            override=merge.get("override", {}),
            sound_alias=merge.get("soundAlias"),
            silent=merge.get("silent", False),
        )
        for removed, merge in merges.items()
    }
    prettier = _rewrite_actions(merge_map, changes, write=args.write)
    _rewrite_records(families, changes, write=args.write)
    if args.write and prettier:
        subprocess.run(
            ["pnpm", "exec", "prettier", "--ignore-path", "/dev/null", "--write", *map(str, prettier)],
            cwd=WEB,
            check=True,
            stdout=subprocess.DEVNULL,
        )
    for change in changes:
        print(("Wrote " if args.write else "Would write ") + change)
    print(f"{len(changes)} file(s) {'written' if args.write else 'to write'}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Prepare manual Mixamo acquisition or install converted VRMAs as Local content."""

import argparse
import copy
import hashlib
import json
import os
import shutil
import struct
import tempfile
import webbrowser
from pathlib import Path, PurePosixPath

MAX_VRMA_BYTES = 128 * 1024 * 1024
MAX_JSON_BYTES = 8 * 1024 * 1024


def relative_path(value: str) -> Path:
    """Admit only explicit relative manifest paths, never parent traversal."""
    path = PurePosixPath(value)
    if path.is_absolute() or "\\" in value or any(part in {"", ".", ".."} for part in value.split("/")):
        raise ValueError(f"Unsafe manifest path: {value}")
    return Path(*path.parts)


def contained(root: Path, relative: str) -> Path:
    """Reject symlinks inside both the converted input and Local destination."""
    path = root
    for part in relative_path(relative).parts:
        path /= part
        if path.is_symlink():
            raise ValueError(f"Symlink is not an installation input or destination: {path}")
    return path


def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def validate_vrma(path: Path) -> None:
    """Reject pointers, renamed FBX, truncated GLBs and non-animation inputs.

    This is container/format admission, not a retargeting or visual-quality test.
    The normal content catalog/runtime still owns playback admission.
    """
    size = path.stat().st_size
    if not path.is_file() or not 20 <= size <= MAX_VRMA_BYTES:
        raise ValueError(f"Expected a bounded VRMA file: {path}")
    with path.open("rb") as stream:
        magic, version, declared = struct.unpack("<4sII", stream.read(12))
        if (magic, version, declared) != (b"glTF", 2, size):
            raise ValueError(f"Not a complete GLB/VRMA: {path}")
        document = None
        while stream.tell() < size:
            header = stream.read(8)
            if len(header) != 8:
                raise ValueError(f"Truncated GLB chunk: {path}")
            length, kind = struct.unpack("<II", header)
            if length % 4 or stream.tell() + length > size:
                raise ValueError(f"Invalid GLB chunk size: {path}")
            if document is None:
                if kind != 0x4E4F534A or length > MAX_JSON_BYTES:
                    raise ValueError(f"Expected a bounded first JSON chunk: {path}")
                document = json.loads(stream.read(length))
            else:
                stream.seek(length, 1)
        if not isinstance(document, dict) or not isinstance(document.get("extensions"), dict):
            raise ValueError(f"Missing VRMA extensions: {path}")
        if not isinstance(document["extensions"].get("VRMC_vrm_animation"), dict) or not document.get("animations"):
            raise ValueError(f"No VRM animation in converted input: {path}")


def tree_hashes(root: Path) -> dict[str, str]:
    result = {}
    for path in root.rglob("*"):
        if path.is_symlink() or not (path.is_file() or path.is_dir()):
            raise ValueError(f"Unsupported installed entry: {path}")
        if path.is_file():
            result[path.relative_to(root).as_posix()] = digest(path)
    return result


def install(manifest: dict, source: Path, local: Path) -> dict:
    """Install only the 29 former starter clips, preserving any existing edits.

    A whole typed item is staged before promotion. Retries keep identical items;
    differing existing items stop the operation before any promotion. No database,
    live loadout or Included content is modified.
    """
    if source.is_symlink() or local.is_symlink():
        raise ValueError("Input and Local roots must not be symlinks")
    source = source.resolve(strict=True)
    local = local.resolve()
    targets = [asset for asset in manifest["assets"] if asset["starter_target"]]
    groups: dict[str, list[tuple[Path, str, str]]] = {}
    documents = {}
    for asset in targets:
        # Converted inputs mirror the historical Included-relative paths.
        original = PurePosixPath(asset["target_path"]).relative_to("content/included")
        input_file = contained(source, original.as_posix())
        validate_vrma(input_file)
        destination = relative_path(asset["local_path"])
        item = Path(*destination.parts[:2]).as_posix()
        contained(local, destination.as_posix())
        groups.setdefault(item, []).append((input_file, destination.relative_to(item).as_posix(), digest(input_file)))
        if asset["category"] == "gesture":
            document = copy.deepcopy(asset["document"])
            document["content_id"] = f"local:gesture:{destination.parts[1]}"
            documents[item] = (f"{destination.parts[1]}.meta.json", document)
    idle = copy.deepcopy(manifest["idle_style_document"])
    idle["content_id"] = "local:idle-style:mixamo-starter"
    idle["name"] = "Mixamo Idle Motions"
    documents["idle-styles/mixamo-starter"] = ("mixamo-starter.json", idle)
    local.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".mixamo-install-", dir=local) as temporary:
        stage = Path(temporary)
        prepared = []
        for item, inputs in groups.items():
            folder = stage / item
            folder.mkdir(parents=True)
            for input_file, relative, expected in inputs:
                target = folder / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(input_file, target)
                if digest(target) != expected:
                    raise ValueError(f"Input changed while copying: {input_file}")
            name, document = documents[item]
            (folder / name).write_text(json.dumps(document, indent=2) + "\n")
            destination = contained(local, item)
            expected_tree = tree_hashes(folder)
            if destination.exists() and (not destination.is_dir() or tree_hashes(destination) != expected_tree):
                raise ValueError(
                    f"Existing Local content differs; preserve or rename it before installing: {destination}"
                )
            prepared.append((item, folder, destination, expected_tree))
        receipt = []
        for item, folder, destination, hashes in prepared:
            destination = contained(local, item)
            destination.parent.mkdir(parents=True, exist_ok=True)
            if destination.exists():
                if tree_hashes(destination) != hashes:
                    raise ValueError(f"Local content changed during installation: {destination}")
                outcome = "existing"
            else:
                os.rename(folder, destination)
                outcome = "installed"
            receipt.append({"item": item, "outcome": outcome, "sha256": hashes})
    return {"local_root": str(local), "animation_files": len(targets), "items": receipt}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepare", action="store_true", help="Write a private manual-acquisition checklist.")
    parser.add_argument("--open", action="store_true", help="Open Adobe Mixamo in your browser.")
    parser.add_argument(
        "--install-from", type=Path, help="Converted VRMA root with gestures/ and idle-styles/ subfolders."
    )
    parser.add_argument(
        "--local-root", type=Path, help="Local library destination (default: this checkout's content/local)."
    )
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    manifest = json.loads((root / "scripts/mixamo-assets.json").read_text())
    if args.local_root and not args.install_from:
        parser.error("--local-root requires --install-from")
    if args.install_from:
        try:
            receipt = install(manifest, args.install_from, args.local_root or root / "content/local")
        except (OSError, ValueError, KeyError, struct.error) as exc:
            parser.exit(1, f"Installation stopped: {exc}\n")
        print(json.dumps(receipt, indent=2))
        return
    targets = [asset for asset in manifest["assets"] if asset["starter_target"]]
    print("Optional Local Mixamo motions — download and conversion are manual.")
    print("Sign in at https://www.mixamo.com/ using your own Adobe account.")
    print("Choose a character, preview each animation, and Download FBX.")
    print("Record original URLs and export/conversion settings; labels are unverified search hints.")
    print("Convert to VRMA, then use --install-from. These motions are not required to start Animama.\n")
    for asset in targets:
        print(f"[ ] {asset['label_hint']} -> Local/{asset['local_path']}")
    if args.prepare:
        directory = root / "data/mixamo-acquisition"
        directory.mkdir(parents=True, exist_ok=True)
        checklist = directory / "checklist.json"
        entries = [
            {key: asset[key] for key in ("target_path", "local_path", "label_hint")}
            | {
                "animation_url": None,
                "character": None,
                "export_settings": None,
                "converted_vrma_path": None,
                "notes": "",
            }
            for asset in targets
        ]
        try:
            with checklist.open("x") as stream:
                json.dump({"schema_version": 1, "assets": entries}, stream, indent=2)
                stream.write("\n")
        except FileExistsError:
            print(f"Preserved existing checklist: {checklist}")
        else:
            print(f"Created private checklist: {checklist}")
    if args.open and not webbrowser.open("https://www.mixamo.com/"):
        print("Could not open a browser; visit https://www.mixamo.com/ manually.")


if __name__ == "__main__":
    main()

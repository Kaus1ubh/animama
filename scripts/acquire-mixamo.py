#!/usr/bin/env python3
"""Prepare a private checklist for manual Adobe downloads; conversion is deferred."""

import argparse
import json
import webbrowser
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--prepare", action="store_true", help="Write a private acquisition checklist."
    )
    parser.add_argument(
        "--open", action="store_true", help="Open Adobe Mixamo in your browser."
    )
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    manifest = json.loads((root / "scripts/mixamo-assets.json").read_text())
    targets = [asset for asset in manifest["assets"] if asset["starter_target"]]
    print("Manual Mixamo acquisition — download and conversion are not automated.")
    print("Sign in at https://www.mixamo.com/ using your own Adobe account.")
    print("Choose a character, search Animations, preview, adjust, and Download FBX.")
    print("Record each animation URL, character and export settings in the checklist.")
    print("Labels below are local hints, not verified Adobe animation identifiers.")
    print("Keep downloads private; .vrma conversion and installation are deferred.\n")
    for asset in targets:
        print(f"[ ] {asset['label_hint']} -> {asset['target_path']}")
    if args.prepare:
        directory = root / "data/mixamo-acquisition"
        directory.mkdir(parents=True, exist_ok=True)
        checklist = directory / "checklist.json"
        entries = [
            {
                **asset,
                "animation_url": None,
                "character": None,
                "export_settings": None,
                "downloaded_fbx_path": None,
                "downloaded": False,
                "notes": "",
            }
            for asset in targets
        ]
        # Preserve any user-filled checklist on repeated runs.
        try:
            with checklist.open("x") as stream:
                json.dump({"schema_version": 1, "assets": entries}, stream, indent=2)
                stream.write("\n")
        except FileExistsError:
            print(f"\nPreserved existing checklist: {checklist}")
        else:
            print(f"\nCreated private checklist: {checklist}")
    if args.open:
        if not webbrowser.open("https://www.mixamo.com/"):
            print("Could not open a browser; visit https://www.mixamo.com/ manually.")


if __name__ == "__main__":
    main()

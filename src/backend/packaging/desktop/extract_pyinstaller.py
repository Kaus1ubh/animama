"""Expand a PyInstaller executable's embedded archives for release scanning.

The frozen runtime keeps Python modules zlib-compressed inside the executable,
where byte and secret scanners cannot see them. This writes every CArchive
entry, and every module of each embedded PYZ, as a raw file under OUTPUT.
Run it with the desktop build interpreter, which provides PyInstaller.
"""

from __future__ import annotations

import argparse
from pathlib import Path, PurePosixPath

from PyInstaller.archive.readers import CArchiveReader


def _write(root: Path, name: str, data: bytes) -> None:
    # Archive names are untrusted input; keep every entry inside OUTPUT.
    parts = [part for part in PurePosixPath(name).parts if part not in ("/", "..")]
    target = root.joinpath(*parts) if parts else root / "entry"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("executable", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    archive = CArchiveReader(str(args.executable))
    count = 0
    for name, entry in archive.toc.items():
        if entry[-1] == "z":  # Embedded PYZ: extract each module's marshalled code.
            modules = archive.open_embedded_archive(name)
            for module in modules.toc:
                data = modules.extract(module, raw=True)
                if data is not None:
                    _write(args.output, f"{name}.contents/{module.replace('.', '/')}.pyc", data)
                    count += 1
            continue
        data = archive.extract(name)
        if data is not None:
            _write(args.output, name, data)
            count += 1
    if count == 0:
        raise SystemExit("PyInstaller archive contained no entries")


if __name__ == "__main__":
    main()

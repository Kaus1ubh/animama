"""Write a deterministic USTAR stream from an exact regular-file inventory.

This is a build tool, not an installer. No PAX, links, device files, outer root,
host timestamps, owners, or inferred archive members enter a feature pack.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import stat
import tarfile
from pathlib import Path, PurePosixPath


def archive(source: Path, inventory: list[dict], destination: Path) -> None:
    """Recheck every input while writing; abort if the inventory has changed."""

    source = source.resolve(strict=True)
    with tarfile.open(destination, "w", format=tarfile.USTAR_FORMAT, encoding="utf-8") as output:
        for entry in inventory:
            name = entry["path"]
            relative = PurePosixPath(name)
            if (
                relative.is_absolute()
                or relative.as_posix() != name
                or any(part in {"", ".", ".."} for part in name.split("/"))
            ):
                raise ValueError("Noncanonical archive input")
            file = source.joinpath(*relative.parts)
            if file.resolve(strict=True) != file or not file.is_relative_to(source):
                raise ValueError("Archive input escapes its root")
            descriptor = os.open(file, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(descriptor, "rb") as stream:
                info = os.fstat(stream.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size != entry["size_bytes"]:
                    raise ValueError("Archive input is not an exact regular file")
                hasher = hashlib.sha256()
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    hasher.update(block)
                if hasher.hexdigest() != entry["sha256"]:
                    raise ValueError("Archive input digest mismatch")
                stream.seek(0)
                header = tarfile.TarInfo(name)
                header.size = info.st_size
                header.mode = int(entry["mode"], 8)
                header.mtime = 946684800
                output.addfile(header, stream)
                if os.fstat(stream.fileno()).st_mtime_ns != info.st_mtime_ns:
                    raise ValueError("Archive input changed during packing")


if __name__ == "__main__":
    command = argparse.ArgumentParser(description=__doc__)
    command.add_argument("--source", type=Path, required=True)
    command.add_argument("--inventory", type=Path, required=True)
    command.add_argument("--output", type=Path, required=True)
    args = command.parse_args()
    archive(args.source, json.loads(args.inventory.read_text()), args.output)

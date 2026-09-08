"""Normalize exact staged payloads into a deterministic tar size artifact."""

from __future__ import annotations

import argparse
import json
import stat
import tarfile
from pathlib import Path

EPOCH = 946684800


def archive(output: Path, sources: list[Path]) -> dict[str, int]:
    sizes: dict[str, int] = {}
    with tarfile.open(output, "w", format=tarfile.PAX_FORMAT) as tar:
        for source in sources:
            total = 0

            # Avoid rglob following framework directory links on some platforms.
            def visit(folder: Path):
                for file in sorted(folder.iterdir()):
                    yield file
                    if file.is_dir() and not file.is_symlink():
                        yield from visit(file)

            for file in visit(source):
                relative = file.relative_to(source)
                info = tar.gettarinfo(str(file), arcname=f"{source.name}/{relative.as_posix()}")
                info.uid = info.gid = 0
                info.uname = info.gname = ""
                info.mtime = EPOCH
                info.pax_headers = {}
                if file.is_symlink():
                    if not file.resolve().is_relative_to(source.resolve()):
                        raise ValueError("Payload symlink escaped its component")
                    info.mode = 0o777
                    total += len(info.linkname.encode())
                    tar.addfile(info)
                elif file.is_file():
                    info.mode = 0o755 if file.stat().st_mode & stat.S_IXUSR else 0o644
                    total += file.stat().st_size
                    with file.open("rb") as handle:
                        tar.addfile(info, handle)
                elif file.is_dir():
                    info.mode = 0o755
                    tar.addfile(info)
                else:
                    raise ValueError("Special file in staged payload")
            sizes[source.name] = total
    return sizes


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("sources", type=Path, nargs="+")
    args = parser.parse_args()
    print(json.dumps(archive(args.output, args.sources), sort_keys=True))

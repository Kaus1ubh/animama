"""Export installed, locked Python dependency notices without host paths."""

from __future__ import annotations

import importlib.metadata
import json
import sys
from pathlib import Path


def declared_license(
    metadata: importlib.metadata.PackageMetadata,
    notices: list[dict[str, str]],
) -> str:
    """Return the strongest installed declaration without guessing an SPDX ID."""

    expression = metadata.get("License-Expression")
    if expression:
        return expression
    license_text = metadata.get("License")
    if license_text:
        if "\n" in license_text:
            notices.append({"path": "METADATA:License", "text": license_text})
            return "SEE-NOTICE"
        return license_text
    classifiers = sorted(
        {
            value.removeprefix("License :: OSI Approved :: ")
            for value in metadata.get_all("Classifier") or []
            if value.startswith("License :: OSI Approved :: ")
        }
    )
    if classifiers:
        return f"Declared classifier: {'; '.join(classifiers)}"
    return "SEE-NOTICE" if notices else "NOASSERTION"


NOTICE_NAME_TOKENS = ("license", "licence", "copying", "notice", "copyright")
MAX_NOTICE_BYTES = 4 * 1024 * 1024


def is_notice_file(file: importlib.metadata.PackagePath, declared: set[str]) -> bool:
    """Whether an installed file is a licence or notice text.

    A file counts when its name says so, or when the distribution's metadata
    declares it with ``License-File``. Declared files sit in ``.dist-info/licenses/``
    (PEP 639) or, in older wheels, at the top of ``.dist-info``, under any name:
    pypdfium2 declares PDFium's bundled components as files such as
    ``BUILD_LICENSES/freetype.txt``.
    """

    if any(token in file.name.lower() for token in NOTICE_NAME_TOKENS):
        return True
    parts = file.parts
    if len(parts) < 2 or not parts[0].endswith(".dist-info"):
        return False
    relative = "/".join(parts[1:])
    return relative in declared or (parts[1] == "licenses" and "/".join(parts[2:]) in declared)


def read_notice(path: Path) -> str:
    """A notice's text: UTF-8, or Latin-1 for older notices such as FreeType's, which every byte decodes."""

    data = path.read_bytes()
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("latin-1")


def dependency_licenses() -> list[dict[str, object]]:
    result = []
    for distribution in sorted(importlib.metadata.distributions(), key=lambda item: item.metadata["Name"].lower()):
        name = distribution.metadata["Name"]
        declared_files = {value.strip() for value in distribution.metadata.get_all("License-File") or []}
        texts = []
        for file in sorted(distribution.files or [], key=str):
            # Includes bundled native library notices under wheel dist-info.
            if is_notice_file(file, declared_files):
                candidate = Path(distribution.locate_file(file))
                if candidate.is_file() and candidate.stat().st_size < MAX_NOTICE_BYTES:
                    texts.append({"path": str(file), "text": read_notice(candidate)})
        declared = declared_license(distribution.metadata, texts)
        result.append(
            {
                "id": f"pypi:{name}@{distribution.version}",
                "name": name,
                "version": distribution.version,
                "license": declared,
                "source": f"https://pypi.org/project/{name}/{distribution.version}/",
                "review": "pending",
                "notices": texts,
            }
        )
    # Python's standalone build can include more native libraries; owner review
    # must reconcile their notices too. No filename implies distribution rights.
    license_paths = [Path(sys.base_prefix) / "lib/python3.12/LICENSE.txt", Path(sys.base_prefix) / "LICENSE.txt"]
    notices = [{"path": "LICENSE.txt", "text": p.read_text()} for p in license_paths if p.is_file()]
    result.append(
        {
            "id": f"cpython:{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
            "name": "CPython (python-build-standalone)",
            "version": ".".join(map(str, sys.version_info[:3])),
            "license": "Python-2.0",
            "source": "https://github.com/astral-sh/python-build-standalone",
            "review": "pending",
            "notices": notices,
        }
    )
    return result


if __name__ == "__main__":
    print(json.dumps(dependency_licenses(), indent=2, sort_keys=True))

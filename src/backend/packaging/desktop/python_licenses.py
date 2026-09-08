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


def dependency_licenses() -> list[dict[str, object]]:
    result = []
    for distribution in sorted(importlib.metadata.distributions(), key=lambda item: item.metadata["Name"].lower()):
        name = distribution.metadata["Name"]
        texts = []
        for file in sorted(distribution.files or [], key=str):
            # Includes bundled native library notices under wheel dist-info.
            if any(token in file.name.lower() for token in ("license", "copying", "notice", "copyright")):
                candidate = Path(distribution.locate_file(file))
                if candidate.is_file() and candidate.stat().st_size < 4 * 1024 * 1024:
                    try:
                        texts.append({"path": str(file), "text": candidate.read_text(encoding="utf-8")})
                    except UnicodeError:
                        continue
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

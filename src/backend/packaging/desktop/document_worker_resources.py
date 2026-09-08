"""Build-time model download and dependency notices for the optional worker.

Docling 2.100.0 downloads only layout/TableFormer here. These inputs still need
exact-inventory redistribution approval before a release catalog can use them.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from python_licenses import dependency_licenses


def prepare(root: Path) -> None:
    root.mkdir(parents=True, exist_ok=True)
    os.environ["TIKTOKEN_CACHE_DIR"] = str(root / "tiktoken")
    import tiktoken
    from docling.utils.model_downloader import download_models

    download_models(
        output_dir=root / "docling",
        with_layout=True,
        with_tableformer=True,
        with_code_formula=False,
        with_picture_classifier=False,
        with_rapidocr=False,
    )
    tiktoken.get_encoding("cl100k_base")
    (root / "DEPENDENCY_NOTICES.json").write_text(json.dumps(dependency_licenses(), indent=2) + "\n")


if __name__ == "__main__":
    prepare(Path(sys.argv[1]))

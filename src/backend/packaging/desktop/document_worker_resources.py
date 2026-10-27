"""Build-time model download and dependency notices for the optional worker.

Docling downloads only the layout model for its default Transformers engine and
TableFormer here. These inputs still need exact-inventory redistribution
approval before a release catalog can use them.
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
    from docling.datamodel.pipeline_options import LayoutObjectDetectionOptions
    from docling.models.utils.hf_model_download import download_hf_model
    from docling.utils.model_downloader import download_models

    models = root / "docling"
    download_models(
        output_dir=models,
        with_layout=False,
        with_tableformer=True,
        with_code_formula=False,
        with_picture_classifier=False,
        with_rapidocr=False,
    )
    # download_models(with_layout=True) also fetches every engine override's
    # repository, such as the ONNX layout model. The worker installs no
    # onnxruntime, so ship only the default engine's weights.
    layout = LayoutObjectDetectionOptions().model_spec
    download_hf_model(
        repo_id=layout.repo_id,
        revision=layout.revision,
        local_dir=models / layout.repo_id.replace("/", "--"),
    )
    tiktoken.get_encoding("cl100k_base")
    (root / "DEPENDENCY_NOTICES.json").write_text(json.dumps(dependency_licenses(), indent=2) + "\n")


if __name__ == "__main__":
    prepare(Path(sys.argv[1]))

"""Entrypoint for the independently frozen and signed optional document worker."""

from __future__ import annotations

import argparse
import asyncio
import importlib.metadata
import json
import os
import sys
from pathlib import Path


def configure_resources() -> Path:
    """Frozen processing never searches the checkout or downloads model weights."""

    if not getattr(sys, "frozen", False):
        raise RuntimeError("document_worker_requires_frozen_resources")
    root = Path(sys._MEIPASS) / "document-resources"  # type: ignore[attr-defined]
    for name in ("docling", "tiktoken"):
        directory = root / name
        if not directory.is_dir() or not any(file.is_file() for file in directory.rglob("*")):
            raise RuntimeError("document_worker_resources_missing")
    os.environ["ANIMAMA_DOCLING_ARTIFACTS_PATH"] = str(root / "docling")
    os.environ["TIKTOKEN_CACHE_DIR"] = str(root / "tiktoken")
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    # The reviewed artifact contains layout/table models, not OCR/VLM models.
    os.environ["ANIMAMA_USER_FILE_DOCLING_ENABLE_OCR"] = "0"
    return root


def main(argv: list[str] | None = None) -> int:
    """Audit resources or enter the fixed queue consumer, never execute a caller command."""

    command = argparse.ArgumentParser(description=__doc__)
    command.add_argument("--audit-resources", action="store_true")
    args = command.parse_args(argv)
    root = configure_resources()
    if args.audit_resources:
        from animama.adapters.parsers.docling_user_file_parser import DoclingUserFileParser
        from animama.adapters.parsers.text_user_file_parser import parse_text_user_file

        # Local conversion exercises Docling's native imports and packaged model
        # weights under HF offline mode, without a database or provider key.
        parser = DoclingUserFileParser(artifacts_path=root / "docling")
        asyncio.run(parser.warm_up())
        assert parse_text_user_file(payload=b"fixture", filename="fixture.txt", extension=".txt").text
        import tiktoken

        assert tiktoken.get_encoding("cl100k_base").encode("fixture")
        print(
            json.dumps(
                {
                    "schema": "animama-document-worker-audit/1",
                    "frozen": True,
                    "docling": importlib.metadata.version("docling"),
                    "torch": importlib.metadata.version("torch"),
                    "local_pdf_conversion": True,
                    "lightweight_parser": True,
                }
            )
        )
        return 0
    from animama.workers.user_file_processing import main as run_worker

    asyncio.run(run_worker())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

# -*- mode: python ; coding: utf-8 -*-
"""Frozen queue consumer; built in the file-worker venv, separate from core."""
import importlib.metadata
import os
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules, copy_metadata

repo = Path(SPECPATH).resolve().parents[3]
resources = Path(os.environ["ANIMAMA_WORKER_BUILD_RESOURCES"])
datas = collect_data_files("animama", excludes=["**/__pycache__/**"])
datas += [(str(resources), "document-resources")]
for distribution in importlib.metadata.distributions():
    datas += copy_metadata(distribution.metadata["Name"])
for package in ("docling", "docling_core", "docling_ibm_models", "docling_parse", "tiktoken_ext", "certifi"):
    datas += collect_data_files(package)
hidden = collect_submodules("tiktoken_ext") + collect_submodules("docling")
hidden += collect_submodules("docling_core") + collect_submodules("docling_ibm_models")
a = Analysis(
    [str(repo / "src/backend/packaging/desktop/document_worker_entrypoint.py")],
    pathex=[str(repo / "src/backend")], binaries=[], datas=datas, hiddenimports=hidden,
    hookspath=[], excludes=["pytest", "debugpy", "IPython", "tkinter"], noarchive=False,
)
a.datas = [entry for entry in a.datas if not entry[0].endswith("/direct_url.json")]
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="animama-document-worker",
          debug=False, bootloader_ignore_signals=False, strip=False, upx=False, console=True,
          target_arch="arm64" if sys.platform == "darwin" else None)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="animama-document-worker")

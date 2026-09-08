"""Docling-backed parser adapter for rich user-file formats."""

from __future__ import annotations

import asyncio
import math
import os
import tempfile
from pathlib import Path
from typing import Any

from animama.app.ports.user_file_parser_port import UserFileParser
from animama.domain.user_file_processing import ParsedUserFileDocument, UserFileChunkDraft, UserFileOutlineItem

DOCLING_EXTENSIONS = frozenset({".md", ".csv", ".html", ".htm", ".pdf", ".docx", ".pptx", ".xlsx"})
ZIP_OFFICE_EXTENSIONS = frozenset({".docx", ".pptx", ".xlsx"})
CHUNKER_NAME = "docling_hybrid"
DEFAULT_CHUNK_MAX_TOKENS = 800
DEFAULT_TOKENIZER_MODEL = "text-embedding-3-small"
MAX_METADATA_DOC_ITEMS = 8
MAX_METADATA_TEXT_CHARS = 240
MAX_SOURCE_OUTLINE_ITEMS = 201
MAX_SOURCE_OUTLINE_TITLE_CHARS = 1_000


class DoclingUserFileParserError(Exception):
    """Raised when a rich uploaded document cannot be converted."""


class DoclingUserFileParser(UserFileParser):
    """Convert rich uploaded documents to Markdown using Docling."""

    def __init__(
        self,
        *,
        timeout_seconds: int = 120,
        enable_ocr: bool = False,
        do_table_structure: bool = True,
        accelerator: str = "cpu",
        num_threads: int | None = None,
        table_mode: str = "fast",
        chunk_max_tokens: int = DEFAULT_CHUNK_MAX_TOKENS,
        tokenizer_model: str = DEFAULT_TOKENIZER_MODEL,
        artifacts_path: Path | None = None,
    ) -> None:
        self._timeout_seconds = max(1, int(timeout_seconds))
        self._enable_ocr = enable_ocr
        self._do_table_structure = do_table_structure
        self._accelerator = accelerator.strip().lower() or "cpu"
        self._num_threads = max(1, int(num_threads or os.cpu_count() or 1))
        self._table_mode = _normalize_table_mode(table_mode)
        self._chunk_max_tokens = max(1, int(chunk_max_tokens))
        self._tokenizer_model = tokenizer_model.strip() or DEFAULT_TOKENIZER_MODEL
        self._artifacts_path = artifacts_path
        self._converter: Any | None = None

    async def parse(
        self,
        *,
        payload: bytes,
        filename: str,
        extension: str,
    ) -> ParsedUserFileDocument:
        normalized_extension = extension.lower()
        if normalized_extension not in DOCLING_EXTENSIONS:
            raise DoclingUserFileParserError(f"Unsupported rich document extension: {normalized_extension}")
        _validate_header(payload, normalized_extension)
        return await asyncio.to_thread(
            self._parse_sync,
            payload=payload,
            filename=filename,
            extension=normalized_extension,
        )

    async def warm_up(self) -> None:
        """Initialize Docling's PDF pipeline before the first user-visible job."""

        await asyncio.to_thread(self._warm_up_sync)

    def _warm_up_sync(self) -> None:
        converter = self._get_converter()
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=True) as tmp:
            tmp.write(_minimal_warmup_pdf())
            tmp.flush()
            converter.convert(Path(tmp.name))

    def _parse_sync(self, *, payload: bytes, filename: str, extension: str) -> ParsedUserFileDocument:
        converter = self._get_converter()
        with tempfile.NamedTemporaryFile(suffix=extension, delete=True) as tmp:
            tmp.write(payload)
            tmp.flush()
            try:
                result = converter.convert(Path(tmp.name))
            except Exception as exc:
                raise DoclingUserFileParserError(_format_conversion_error(exc)) from exc

        document = getattr(result, "document", None)
        if document is None:
            raise DoclingUserFileParserError("Docling conversion returned no document")

        markdown = _export_markdown(document)
        structured_summary = _structured_summary(document)
        source_outline, source_outline_truncated, outline_warning = _extract_docling_outline(document)
        if not markdown.strip():
            raise DoclingUserFileParserError("Docling conversion returned no text")

        metadata = {
            "parser": "docling",
            "filename": filename,
            "extension": extension,
            "docling": structured_summary,
            "ocr_enabled": self._enable_ocr,
            "table_structure_enabled": self._do_table_structure,
            "table_mode": self._table_mode,
            "accelerator": self._accelerator,
            "num_threads": self._num_threads,
            "chunking": {
                "chunker": CHUNKER_NAME,
                "max_tokens": self._chunk_max_tokens,
                "tokenizer_model": self._tokenizer_model,
            },
        }
        if outline_warning is not None:
            _append_metadata_warning(metadata, outline_warning)
        chunks, warning = _chunk_docling_document(
            document=document,
            max_tokens=self._chunk_max_tokens,
            tokenizer_model=self._tokenizer_model,
        )
        if warning is not None:
            _append_metadata_warning(metadata, warning)
            chunks = None

        return ParsedUserFileDocument(
            text=markdown,
            parser_name="docling",
            metadata=metadata,
            chunks=chunks,
            source_outline=source_outline,
            source_outline_truncated=source_outline_truncated,
        )

    def _get_converter(self) -> Any:
        if self._converter is None:
            self._converter = self._make_converter()
        return self._converter

    def _make_converter(self) -> Any:
        try:
            from docling.datamodel.base_models import InputFormat
            from docling.datamodel.pipeline_options import PdfPipelineOptions
            from docling.document_converter import DocumentConverter, PdfFormatOption
        except Exception as exc:  # pragma: no cover - depends on optional package installation
            raise DoclingUserFileParserError(
                "Docling is not installed in this environment. Use the animama-file-worker image "
                "or run with `uv run --extra file-worker python -m animama.workers.user_file_processing`."
            ) from exc

        allowed_formats = [
            fmt
            for fmt in (
                _input_format(InputFormat, "PDF"),
                _input_format(InputFormat, "DOCX", "WORD"),
                _input_format(InputFormat, "PPTX", "POWERPOINT"),
                _input_format(InputFormat, "XLSX", "EXCEL"),
                _input_format(InputFormat, "HTML"),
                _input_format(InputFormat, "CSV"),
                _input_format(InputFormat, "MD", "MARKDOWN"),
            )
            if fmt is not None
        ]

        pdf_options = PdfPipelineOptions()
        if self._artifacts_path is not None:
            # The frozen worker supplies verified local weights before settings
            # are imported. Missing files fail; no remote fallback is enabled.
            pdf_options.artifacts_path = self._artifacts_path
            pdf_options.enable_remote_services = False
        pdf_options.do_ocr = self._enable_ocr
        pdf_options.do_table_structure = self._do_table_structure
        _set_table_structure_mode(pdf_options, self._table_mode)
        _set_if_present(pdf_options, "document_timeout", self._timeout_seconds)
        _set_if_present(pdf_options, "timeout", self._timeout_seconds)

        accelerator_options = _make_accelerator_options(self._accelerator, num_threads=self._num_threads)
        if accelerator_options is not None:
            _set_if_present(pdf_options, "accelerator_options", accelerator_options)

        pdf_format = _input_format(InputFormat, "PDF")
        format_options = {}
        if pdf_format is not None:
            format_options[pdf_format] = PdfFormatOption(pipeline_options=pdf_options)

        return DocumentConverter(
            allowed_formats=allowed_formats or None,
            format_options=format_options,
        )


def _validate_header(payload: bytes, extension: str) -> None:
    if extension == ".pdf" and not payload.startswith(b"%PDF-"):
        raise DoclingUserFileParserError("PDF header validation failed")
    if extension in ZIP_OFFICE_EXTENSIONS and not payload.startswith(b"PK"):
        raise DoclingUserFileParserError("Office document ZIP header validation failed")


def _format_conversion_error(exc: Exception) -> str:
    message = str(exc).strip() or exc.__class__.__name__
    lowered = message.lower()
    if any(word in lowered for word in ("password", "encrypted", "encrypt")):
        return "Encrypted or password-protected documents are not supported"
    return f"Docling conversion failed: {message[:400]}"


def _input_format(input_format: Any, *names: str) -> Any | None:
    for name in names:
        if hasattr(input_format, name):
            return getattr(input_format, name)
    return None


def _set_if_present(obj: Any, name: str, value: Any) -> None:
    if hasattr(obj, name):
        setattr(obj, name, value)


def _normalize_table_mode(table_mode: str) -> str:
    normalized = table_mode.strip().lower()
    if normalized in {"fast", "accurate"}:
        return normalized
    return "fast"


def _set_table_structure_mode(pdf_options: Any, table_mode: str) -> None:
    table_options = getattr(pdf_options, "table_structure_options", None)
    if table_options is None:
        return
    try:
        from docling.datamodel.pipeline_options import TableFormerMode

        mode = getattr(TableFormerMode, table_mode.upper(), None)
    except Exception:  # pragma: no cover - optional Docling enum path
        mode = None
    _set_if_present(table_options, "mode", mode or table_mode)


def _make_accelerator_options(accelerator: str, *, num_threads: int) -> Any | None:
    try:
        from docling.datamodel.accelerator_options import AcceleratorDevice, AcceleratorOptions
    except Exception:  # pragma: no cover - optional Docling submodule
        return None

    device_name = accelerator.upper()
    device = getattr(AcceleratorDevice, device_name, None)
    if device is None:
        device = getattr(AcceleratorDevice, "CPU", None)
    if device is None:
        return None
    try:
        return AcceleratorOptions(num_threads=max(1, num_threads), device=device)
    except TypeError:
        return AcceleratorOptions(device=device)


def _minimal_warmup_pdf() -> bytes:
    stream = b"BT /F1 12 Tf 72 72 Td (Anima Docling warmup) Tj ET\n"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] "
            b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>"
        ),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"endstream",
    ]
    body = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"
    offsets: list[int] = []
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(body))
        body += f"{index} 0 obj\n".encode() + obj + b"\nendobj\n"

    xref_offset = len(body)
    xref = b"xref\n0 6\n0000000000 65535 f \n"
    xref += b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets)
    trailer = f"trailer\n<< /Root 1 0 R /Size 6 >>\nstartxref\n{xref_offset}\n%%EOF\n".encode()
    return body + xref + trailer


def _chunk_docling_document(
    *,
    document: Any,
    max_tokens: int,
    tokenizer_model: str,
) -> tuple[list[UserFileChunkDraft] | None, str | None]:
    try:
        chunker = _make_hybrid_chunker(max_tokens=max_tokens, tokenizer_model=tokenizer_model)
        docling_chunks = list(chunker.chunk(dl_doc=document))
        chunks: list[UserFileChunkDraft] = []
        for chunk in docling_chunks:
            chunk_text = _normalize_chunk_text(str(getattr(chunk, "text", "")))
            if not chunk_text:
                continue
            embedding_text = _normalize_chunk_text(str(chunker.contextualize(chunk)))
            token_count = _count_chunk_tokens(chunker, embedding_text)
            chunks.append(
                UserFileChunkDraft(
                    chunk_index=len(chunks),
                    text=chunk_text,
                    char_count=len(chunk_text),
                    token_estimate=token_count,
                    metadata=_compact_chunk_metadata(chunk, token_count=token_count),
                    embedding_text=embedding_text,
                )
            )
    except Exception as exc:
        message = str(exc).strip() or exc.__class__.__name__
        return None, f"HybridChunker failed; using Markdown fallback chunking: {message[:300]}"

    if not chunks:
        return None, "HybridChunker returned no chunks; using Markdown fallback chunking"
    return chunks, None


def _make_hybrid_chunker(*, max_tokens: int, tokenizer_model: str) -> Any:
    from docling.chunking import HybridChunker
    from docling_core.transforms.chunker.tokenizer.openai import OpenAITokenizer

    tokenizer = OpenAITokenizer(
        tokenizer=_tiktoken_encoding_for_model(tokenizer_model),
        max_tokens=max_tokens,
    )
    return HybridChunker(tokenizer=tokenizer, merge_peers=True)


def _tiktoken_encoding_for_model(model: str) -> Any:
    import tiktoken

    try:
        return tiktoken.encoding_for_model(model)
    except Exception:
        return tiktoken.get_encoding("cl100k_base")


def _compact_chunk_metadata(chunk: Any, *, token_count: int) -> dict[str, Any]:
    meta = getattr(chunk, "meta", None)
    exported = _export_chunk_meta(meta)
    raw_doc_items = exported.get("doc_items")
    doc_items = raw_doc_items if isinstance(raw_doc_items, list) else []
    return {
        "parser": "docling",
        "chunker": CHUNKER_NAME,
        "headings": _compact_string_list(exported.get("headings")),
        "captions": _compact_string_list(exported.get("captions")),
        "origin": _compact_origin(exported.get("origin")),
        "doc_items": [_compact_doc_item(item) for item in doc_items[:MAX_METADATA_DOC_ITEMS]],
        "doc_item_count": len(doc_items),
        "token_count": token_count,
    }


def _export_chunk_meta(meta: Any) -> dict[str, Any]:
    if meta is None:
        return {}
    export = getattr(meta, "export_json_dict", None)
    if export is not None:
        try:
            exported = export()
        except Exception:
            exported = None
        if isinstance(exported, dict):
            return exported
    model_dump = getattr(meta, "model_dump", None)
    if model_dump is not None:
        try:
            dumped = model_dump(mode="json", by_alias=True, exclude_none=True)
        except TypeError:
            dumped = model_dump()
        if isinstance(dumped, dict):
            return dumped
    if isinstance(meta, dict):
        return dict(meta)
    return {}


def _compact_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [_compact_text(item) for item in value if str(item).strip()]


def _compact_origin(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    return {
        key: value[key]
        for key in ("filename", "mimetype", "binary_hash", "uri")
        if key in value and value[key] is not None
    }


def _compact_doc_item(value: Any) -> dict[str, Any]:
    item = value if isinstance(value, dict) else _export_chunk_meta(value)
    compact: dict[str, Any] = {}
    for key in ("self_ref", "label"):
        if item.get(key) is not None:
            compact[key] = item[key]
    if item.get("text") is not None:
        compact["text"] = _compact_text(item["text"])
    prov = item.get("prov")
    if isinstance(prov, list) and prov:
        first_prov = prov[0]
        if isinstance(first_prov, dict) and first_prov.get("page_no") is not None:
            compact["page_no"] = first_prov["page_no"]
    return compact


def _count_chunk_tokens(chunker: Any, text: str) -> int:
    tokenizer = getattr(chunker, "tokenizer", None)
    count_tokens = getattr(tokenizer, "count_tokens", None)
    if count_tokens is not None:
        try:
            return max(1, int(count_tokens(text=text)))
        except Exception:
            pass
    return _estimate_tokens(text)


def _estimate_tokens(text: str) -> int:
    stripped = text.strip()
    if not stripped:
        return 0
    return max(1, math.ceil(len(stripped) / 4))


def _compact_text(value: Any) -> str:
    text = str(value).strip()
    if len(text) <= MAX_METADATA_TEXT_CHARS:
        return text
    return f"{text[: MAX_METADATA_TEXT_CHARS - 3]}..."


def _normalize_chunk_text(text: str) -> str:
    return "\n".join(line.rstrip() for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n")).strip()


def _append_metadata_warning(metadata: dict[str, Any], warning: str) -> None:
    warnings = metadata.get("warnings")
    if isinstance(warnings, list):
        warnings.append(warning)
    else:
        metadata["warnings"] = [warning]


def _export_markdown(document: Any) -> str:
    export = getattr(document, "export_to_markdown", None)
    if export is None:
        raise DoclingUserFileParserError("Docling document cannot export Markdown")
    try:
        return str(export(compact_tables=True))
    except TypeError:
        return str(export())


def _structured_summary(document: Any) -> dict[str, Any]:
    export = getattr(document, "export_to_dict", None)
    if export is None:
        return {}
    try:
        structured = export()
    except Exception:
        return {}
    if not isinstance(structured, dict):
        return {}
    summary: dict[str, Any] = {"top_level_keys": sorted(str(key) for key in structured.keys())}
    for key in ("texts", "tables", "pictures", "groups", "pages"):
        value = structured.get(key)
        if isinstance(value, list):
            summary[f"{key}_count"] = len(value)
        elif isinstance(value, dict):
            summary[f"{key}_count"] = len(value)
    return summary


def _extract_docling_outline(
    document: Any,
) -> tuple[tuple[UserFileOutlineItem, ...], bool, str | None]:
    """Normalize Docling titles and section headers before its document is discarded."""

    iterate_items = getattr(document, "iterate_items", None)
    if not callable(iterate_items):
        return (), False, None

    outline: list[UserFileOutlineItem] = []
    truncated = False
    try:
        for item, raw_level in iterate_items():
            label = _docling_label_name(getattr(item, "label", None))
            if label not in {"TITLE", "SECTION_HEADER"}:
                continue
            title = str(getattr(item, "text", "")).strip()
            if not title:
                continue
            if len(title) > MAX_SOURCE_OUTLINE_TITLE_CHARS:
                title = title[:MAX_SOURCE_OUTLINE_TITLE_CHARS]
                truncated = True
            if len(outline) >= MAX_SOURCE_OUTLINE_ITEMS:
                truncated = True
                break
            if label == "TITLE":
                level = 1
            else:
                try:
                    level = int(raw_level)
                except (TypeError, ValueError):
                    level = 1
                level = min(6, max(1, level))
            outline.append(UserFileOutlineItem(level=level, title=title))
    except Exception as exc:
        message = str(exc).strip() or exc.__class__.__name__
        return (), False, f"Docling outline extraction failed; using Markdown fallback: {message[:300]}"
    return tuple(outline), truncated, None


def _docling_label_name(label: Any) -> str:
    for value in (getattr(label, "name", None), getattr(label, "value", None), label):
        if value is not None:
            normalized = str(value).strip().upper().replace("-", "_").replace(" ", "_")
            if normalized:
                return normalized
    return ""


__all__ = ["DOCLING_EXTENSIONS", "DoclingUserFileParser", "DoclingUserFileParserError"]

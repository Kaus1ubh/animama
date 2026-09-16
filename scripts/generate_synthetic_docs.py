#!/usr/bin/env python3
"""Generate searchable documentation artifacts for user-file upload testing."""

from __future__ import annotations

import argparse
import html
import os
import re
import sys
import tempfile
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, TypeVar, cast

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_DIR = ROOT / "artifacts" / "synthetic-user-files"
DOC_ROOTS = (Path("docs/backend"), Path("docs/frontend"))

OutputFormat = Literal["md", "pdf", "docx"]
SizePreset = Literal["xxsmall", "xsmall", "small", "large", "full"]

Choice = TypeVar("Choice", bound=str)

OUTPUT_FORMATS: tuple[OutputFormat, ...] = ("md", "pdf", "docx")
SIZE_PRESETS: tuple[SizePreset, ...] = ("xxsmall", "xsmall", "small", "large", "full")

# The curated presets are deliberately nested. Their current UTF-8 source sizes
# are approximately 0.04 MB, 0.08 MB, 0.17 MB, and 0.33 MB; full discovers
# every non-plan doc. Xsmall and xxsmall remain close to one half and one
# quarter of small as the selected documentation changes.
XXSMALL_SOURCE_PATHS = (
    "docs/backend/features/user-files.md",
    "docs/frontend/README.md",
    "docs/frontend/features/user-file-uploads.md",
)
XSMALL_SOURCE_PATHS = (
    *XXSMALL_SOURCE_PATHS,
    "docs/backend/runtime/chat.md",
)
SMALL_SOURCE_PATHS = (
    "docs/backend/README.md",
    "docs/backend/architecture/overview.md",
    "docs/backend/runtime/chat.md",
    "docs/backend/features/memory.md",
    "docs/backend/features/user-files.md",
    "docs/frontend/README.md",
    "docs/frontend/architecture/overview.md",
    "docs/frontend/architecture/data-layer.md",
    "docs/frontend/runtime/chat.md",
    "docs/frontend/features/user-file-uploads.md",
)
LARGE_SOURCE_PATHS = (
    *SMALL_SOURCE_PATHS,
    "docs/backend/features/memory-manager-and-episodic-memory.md",
    "docs/backend/runtime/model-client-providers.md",
    "docs/frontend/runtime/avatar-animation.md",
    "docs/frontend/runtime/scene-vfx.md",
    "docs/frontend/runtime/avatar-planner.md",
)

_HEADING_RE = re.compile(r"^(?P<marks>#{1,6})\s+(?P<title>.+?)\s*$")
_ILLEGAL_XML_CHAR_RE = re.compile(r"[\x00-\x08\x0B\x0C\x0E-\x1F]")


class SyntheticDocsError(RuntimeError):
    """Raised when the synthetic documentation artifact cannot be generated."""


@dataclass(frozen=True, slots=True)
class SourceDocument:
    """One repository documentation source included in an artifact."""

    relative_path: str
    content: str
    source_bytes: int


@dataclass(frozen=True, slots=True)
class SyntheticDocument:
    """Format-neutral documentation corpus ready for rendering."""

    preset: SizePreset
    sources: tuple[SourceDocument, ...]

    @property
    def source_bytes(self) -> int:
        return sum(source.source_bytes for source in self.sources)


def discover_source_paths(root: Path = ROOT) -> tuple[Path, ...]:
    """Discover every non-plan Markdown document in the backend and frontend roots."""

    discovered: list[Path] = []
    for relative_root in DOC_ROOTS:
        docs_root = root / relative_root
        if not docs_root.is_dir():
            raise SyntheticDocsError(f"Documentation root does not exist: {docs_root}")
        for path in docs_root.rglob("*.md"):
            relative_path = path.relative_to(root)
            if "plans" in relative_path.parts:
                continue
            discovered.append(relative_path)
    return tuple(sorted(discovered, key=lambda path: path.as_posix()))


def select_source_paths(preset: SizePreset, root: Path = ROOT) -> tuple[Path, ...]:
    """Return the deterministic source paths for one size preset."""

    if preset == "xxsmall":
        selected = tuple(Path(path) for path in XXSMALL_SOURCE_PATHS)
    elif preset == "xsmall":
        selected = tuple(Path(path) for path in XSMALL_SOURCE_PATHS)
    elif preset == "small":
        selected = tuple(Path(path) for path in SMALL_SOURCE_PATHS)
    elif preset == "large":
        selected = tuple(Path(path) for path in LARGE_SOURCE_PATHS)
    elif preset == "full":
        selected = discover_source_paths(root)
    else:  # pragma: no cover - argparse and typing constrain normal callers.
        raise SyntheticDocsError(f"Unsupported size preset: {preset}")

    missing = [str(path) for path in selected if not (root / path).is_file()]
    if missing:
        raise SyntheticDocsError(f"Documentation sources are missing: {', '.join(missing)}")
    return selected


def load_synthetic_document(preset: SizePreset, root: Path = ROOT) -> SyntheticDocument:
    """Read one preset with strict UTF-8 decoding and source-byte accounting."""

    sources: list[SourceDocument] = []
    for relative_path in select_source_paths(preset, root):
        path = root / relative_path
        try:
            payload = path.read_bytes()
            content = payload.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise SyntheticDocsError(f"Documentation source is not valid UTF-8: {path}") from exc
        except OSError as exc:
            raise SyntheticDocsError(f"Failed to read documentation source {path}: {exc}") from exc
        sources.append(
            SourceDocument(
                relative_path=relative_path.as_posix(),
                content=content,
                source_bytes=len(payload),
            )
        )
    return SyntheticDocument(preset=preset, sources=tuple(sources))


def render_markdown(document: SyntheticDocument, destination: Path) -> None:
    """Render the corpus as Markdown while preserving each source body."""

    parts = [
        "# Animama Synthetic Documentation Corpus\n\n",
        f"- Preset: `{document.preset}`\n",
        f"- Source documents: {len(document.sources)}\n",
        f"- Source UTF-8 bytes: {document.source_bytes}\n\n",
        "## Manifest\n\n",
    ]
    parts.extend(f"{index}. `{source.relative_path}`\n" for index, source in enumerate(document.sources, start=1))
    for source in document.sources:
        parts.extend(
            (
                "\n---\n\n",
                f"## Source: `{source.relative_path}`\n\n",
                f"<!-- BEGIN SOURCE: {source.relative_path} -->\n",
                source.content,
            )
        )
        if not source.content.endswith("\n"):
            parts.append("\n")
        parts.append(f"<!-- END SOURCE: {source.relative_path} -->\n")
    destination.write_text("".join(parts), encoding="utf-8")


def render_docx(document: SyntheticDocument, destination: Path) -> None:
    """Render the corpus as a searchable Word document."""

    try:
        from docx import Document
        from docx.enum.style import WD_STYLE_TYPE
        from docx.shared import Pt
    except ImportError as exc:  # pragma: no cover - exercised only in incomplete environments.
        raise SyntheticDocsError("DOCX generation requires the python-docx development dependency") from exc

    output = Document()
    output.core_properties.title = "Animama Synthetic Documentation Corpus"
    output.core_properties.subject = f"{document.preset} documentation upload/search fixture"
    output.add_heading("Animama Synthetic Documentation Corpus", level=0)
    output.add_paragraph(f"Preset: {document.preset}")
    output.add_paragraph(f"Source documents: {len(document.sources)}")
    output.add_paragraph(f"Source UTF-8 bytes: {document.source_bytes}")
    output.add_heading("Manifest", level=1)
    for source in document.sources:
        output.add_paragraph(_xml_safe(source.relative_path), style="List Bullet")

    styles = output.styles
    code_style = styles.add_style("Animama Code", WD_STYLE_TYPE.PARAGRAPH)
    code_style.font.name = "Courier New"
    code_style.font.size = Pt(8)

    for source in document.sources:
        output.add_page_break()
        output.add_heading(f"Source: {_xml_safe(source.relative_path)}", level=1)
        in_code = False
        for line in source.content.splitlines():
            clean_line = _xml_safe(line)
            if line.lstrip().startswith("```"):
                in_code = not in_code
                output.add_paragraph(clean_line, style="Animama Code")
                continue
            heading = None if in_code else _HEADING_RE.match(line)
            if heading is not None:
                output.add_heading(_xml_safe(heading.group("title")), level=min(len(heading.group("marks")) + 1, 9))
            elif in_code:
                output.add_paragraph(clean_line, style="Animama Code")
            else:
                output.add_paragraph(clean_line)
    output.save(str(destination))


def render_pdf(document: SyntheticDocument, destination: Path) -> None:
    """Render the corpus as a searchable PDF using embedded Unicode fonts."""

    try:
        import reportlab
        from reportlab.lib.colors import HexColor
        from reportlab.lib.pagesizes import LETTER
        from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
        from reportlab.lib.units import inch
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer
    except ImportError as exc:  # pragma: no cover - exercised only in incomplete environments.
        raise SyntheticDocsError("PDF generation requires the reportlab development dependency") from exc

    reportlab_font_dir = Path(reportlab.__file__).resolve().parent / "fonts"
    font_candidates = (
        Path("/System/Library/Fonts/Supplemental/Arial Unicode.ttf"),
        Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        Path("/usr/share/fonts/opentype/noto/NotoSans-Regular.ttf"),
        Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts" / "arial.ttf",
        reportlab_font_dir / "Vera.ttf",
    )
    required_codepoints = {
        ord(character)
        for source in document.sources
        for character in f"{source.relative_path}\n{source.content}"
        if ord(character) >= 32
    }
    selected_font = None
    selected_font_name = None
    for index, font_path in enumerate(font_candidates):
        if not font_path.is_file():
            continue
        font_name = f"AnimamaUnicode{index}"
        candidate = TTFont(font_name, str(font_path))
        if required_codepoints.issubset(candidate.face.charToGlyph):
            selected_font = candidate
            selected_font_name = font_name
            break
    if selected_font is None or selected_font_name is None:
        raise SyntheticDocsError("No installed PDF font covers every character in the selected documentation corpus")
    if selected_font_name not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(selected_font)

    sample_styles = getSampleStyleSheet()
    body_style = ParagraphStyle(
        "AnimamaBody",
        parent=sample_styles["BodyText"],
        fontName=selected_font_name,
        fontSize=8.5,
        leading=11,
        spaceAfter=3,
        splitLongWords=True,
    )
    code_style = ParagraphStyle(
        "AnimamaCode",
        parent=body_style,
        fontSize=7.5,
        leading=9.5,
        leftIndent=10,
        rightIndent=4,
        backColor=HexColor("#f3f4f6"),
    )
    title_style = ParagraphStyle(
        "AnimamaTitle",
        parent=sample_styles["Title"],
        fontName=selected_font_name,
        fontSize=18,
        leading=22,
    )
    source_style = ParagraphStyle(
        "AnimamaSource",
        parent=sample_styles["Heading1"],
        fontName=selected_font_name,
        fontSize=13,
        leading=16,
        spaceAfter=8,
    )
    heading_styles = {
        level: ParagraphStyle(
            f"AnimamaHeading{level}",
            parent=sample_styles[f"Heading{min(level, 6)}"],
            fontName=selected_font_name,
            fontSize=max(9, 15 - level),
            leading=max(11, 18 - level),
            spaceBefore=6,
            spaceAfter=4,
        )
        for level in range(1, 7)
    }

    pdf = SimpleDocTemplate(
        str(destination),
        pagesize=LETTER,
        rightMargin=0.65 * inch,
        leftMargin=0.65 * inch,
        topMargin=0.65 * inch,
        bottomMargin=0.65 * inch,
        title="Animama Synthetic Documentation Corpus",
        subject=f"{document.preset} documentation upload/search fixture",
    )
    story = [
        Paragraph("Animama Synthetic Documentation Corpus", title_style),
        Spacer(1, 8),
        Paragraph(f"Preset: {html.escape(document.preset)}", body_style),
        Paragraph(f"Source documents: {len(document.sources)}", body_style),
        Paragraph(f"Source UTF-8 bytes: {document.source_bytes}", body_style),
        Paragraph("Manifest", source_style),
    ]
    story.extend(Paragraph(html.escape(source.relative_path), body_style) for source in document.sources)

    for source in document.sources:
        story.extend((PageBreak(), Paragraph(f"Source: {html.escape(source.relative_path)}", source_style)))
        in_code = False
        for line in source.content.splitlines():
            if line.lstrip().startswith("```"):
                in_code = not in_code
                story.append(Paragraph(_pdf_line(line), code_style))
                continue
            heading = None if in_code else _HEADING_RE.match(line)
            if heading is not None:
                level = min(len(heading.group("marks")), 6)
                story.append(Paragraph(_pdf_line(heading.group("title")), heading_styles[level]))
            elif line:
                story.append(Paragraph(_pdf_line(line), code_style if in_code else body_style))
            else:
                story.append(Spacer(1, 4))
    pdf.build(story)


def render_document(document: SyntheticDocument, output_format: OutputFormat, destination: Path) -> None:
    """Render to a temporary sibling file and atomically replace the destination."""

    try:
        destination.parent.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise SyntheticDocsError(f"Failed to create output directory {destination.parent}: {exc}") from exc
    if not destination.parent.is_dir():
        raise SyntheticDocsError(f"Output directory is not a directory: {destination.parent}")

    try:
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{destination.stem}-",
            suffix=destination.suffix,
            dir=destination.parent,
        )
    except OSError as exc:
        raise SyntheticDocsError(f"Failed to create a temporary artifact in {destination.parent}: {exc}") from exc
    os.close(descriptor)
    temporary_path = Path(temporary_name)
    try:
        if output_format == "md":
            render_markdown(document, temporary_path)
        elif output_format == "pdf":
            render_pdf(document, temporary_path)
        elif output_format == "docx":
            render_docx(document, temporary_path)
        else:  # pragma: no cover - argparse and typing constrain normal callers.
            raise SyntheticDocsError(f"Unsupported output format: {output_format}")
        os.replace(temporary_path, destination)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise


def output_path(*, output_dir: Path, preset: SizePreset, output_format: OutputFormat) -> Path:
    """Return the stable artifact name for one preset and output format."""

    return output_dir / f"animama-docs-{preset}.{output_format}"


def prompt_for_choice(
    label: str,
    choices: Sequence[Choice],
    *,
    input_func: Callable[[str], str] = input,
    output: Callable[[str], None] = print,
) -> Choice:
    """Prompt until the user selects a numbered or named choice."""

    output(f"Choose {label}:")
    for index, choice in enumerate(choices, start=1):
        output(f"  {index}. {choice}")
    while True:
        try:
            answer = input_func(f"{label}> ").strip().lower()
        except EOFError as exc:
            raise SyntheticDocsError(f"No {label} was provided") from exc
        if answer in choices:
            return choices[choices.index(answer)]
        if answer.isdigit() and 1 <= int(answer) <= len(choices):
            return choices[int(answer) - 1]
        output(f"Invalid {label}. Choose 1-{len(choices)} or one of: {', '.join(choices)}.")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate searchable Markdown, PDF, or DOCX files from Animama's non-plan documentation."
    )
    parser.add_argument("--format", choices=OUTPUT_FORMATS, dest="output_format", help="Artifact file type.")
    parser.add_argument("--size", choices=SIZE_PRESETS, dest="preset", help="Documentation subset size.")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=f"Artifact directory (default: {DEFAULT_OUTPUT_DIR.relative_to(ROOT)}).",
    )
    return parser


def main(
    argv: Sequence[str] | None = None,
    *,
    input_func: Callable[[str], str] = input,
    root: Path = ROOT,
) -> int:
    """Run the interactive or flag-driven artifact generator."""

    args = _parser().parse_args(argv)
    # argparse choices and the generic prompt both constrain these literal values.
    output_format = (
        cast(OutputFormat, args.output_format)
        if args.output_format
        else prompt_for_choice("file type", OUTPUT_FORMATS, input_func=input_func)
    )
    preset = (
        cast(SizePreset, args.preset)
        if args.preset
        else prompt_for_choice("documentation size", SIZE_PRESETS, input_func=input_func)
    )
    document = load_synthetic_document(preset, root)
    destination = output_path(
        output_dir=args.output_dir.expanduser().resolve(),
        preset=preset,
        output_format=output_format,
    )
    render_document(document, output_format, destination)
    print(f"Generated: {destination}")
    print(f"Sources: {len(document.sources)}")
    print(f"Source bytes: {document.source_bytes}")
    print(f"Artifact bytes: {destination.stat().st_size}")
    return 0


def _xml_safe(value: str) -> str:
    return _ILLEGAL_XML_CHAR_RE.sub("", value)


def _pdf_line(value: str) -> str:
    # Preserve leading spaces in code and escape ReportLab's Paragraph mini-XML.
    value = _xml_safe(value)
    leading_spaces = len(value) - len(value.lstrip(" "))
    return "&nbsp;" * leading_spaces + html.escape(value[leading_spaces:])


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SyntheticDocsError as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc

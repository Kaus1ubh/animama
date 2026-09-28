from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from docx import Document
from pypdf import PdfReader

from scripts import generate_synthetic_docs as generator


def _fixture_document() -> generator.SyntheticDocument:
    content = (
        "# Search Fixture\n\n"
        "Project Atlas ↔ Project Lantern uses the primary stress marker ˈ for parser validation.\n\n"
        "```python\n"
        'value = "<atlas>&</atlas>"\n'
        "```\n\n"
        "Use search_uploaded_files to retrieve this attached synthetic document.\n"
    )
    return generator.SyntheticDocument(
        preset="small",
        sources=(
            generator.SourceDocument(
                relative_path="docs/backend/features/search-fixture.md",
                content=content,
                source_bytes=len(content.encode("utf-8")),
            ),
        ),
    )


def _artifact_text(path: Path) -> str:
    if path.suffix == ".md":
        return path.read_text(encoding="utf-8")
    if path.suffix == ".docx":
        return "\n".join(paragraph.text for paragraph in Document(str(path)).paragraphs)
    if path.suffix == ".pdf":
        return "\n".join(page.extract_text() or "" for page in PdfReader(path).pages)
    raise AssertionError(f"Unexpected fixture extension: {path.suffix}")


def test_presets_are_nested_balanced_and_exclude_plans() -> None:
    xxsmall_paths = generator.select_source_paths("xxsmall")
    xsmall_paths = generator.select_source_paths("xsmall")
    small_paths = generator.select_source_paths("small")
    large_paths = generator.select_source_paths("large")
    full_paths = generator.select_source_paths("full")

    assert set(xxsmall_paths) < set(xsmall_paths) < set(small_paths) < set(large_paths) < set(full_paths)
    assert all("plans" not in path.parts for path in full_paths)
    assert any(path.as_posix().startswith("docs/backend/") for path in xxsmall_paths)
    assert any(path.as_posix().startswith("docs/frontend/") for path in xxsmall_paths)

    source_sizes = {preset: generator.load_synthetic_document(preset).source_bytes for preset in generator.SIZE_PRESETS}
    assert source_sizes["xxsmall"] == pytest.approx(source_sizes["small"] / 4, rel=0.12)
    assert source_sizes["xsmall"] == pytest.approx(source_sizes["small"] / 2, rel=0.15)
    assert source_sizes["large"] >= source_sizes["small"] * 1.8
    assert source_sizes["full"] >= source_sizes["large"] * 2


def test_full_discovers_every_non_plan_markdown_document() -> None:
    selected = generator.select_source_paths("full")
    expected = tuple(
        sorted(
            (
                path.relative_to(generator.ROOT)
                for docs_root in generator.DOC_ROOTS
                for path in (generator.ROOT / docs_root).rglob("*.md")
                if "plans" not in path.relative_to(generator.ROOT).parts
            ),
            key=lambda path: path.as_posix(),
        )
    )

    assert selected == expected


@pytest.mark.parametrize("output_format", generator.OUTPUT_FORMATS)
def test_renderers_preserve_manifest_source_paths_and_searchable_text(tmp_path: Path, output_format: str) -> None:
    artifact = tmp_path / f"fixture.{output_format}"

    generator.render_document(_fixture_document(), output_format, artifact)  # type: ignore[arg-type]

    extracted = _artifact_text(artifact)
    assert "Animama Synthetic Documentation Corpus" in extracted
    assert "docs/backend/features/search-fixture.md" in extracted
    assert "Project Atlas" in extracted
    assert "Project Lantern" in extracted
    assert "↔" in extracted
    assert "ˈ" in extracted
    assert "search_uploaded_files" in extracted
    assert "atlas" in extracted
    assert artifact.stat().st_size > 0


def test_docx_renderer_removes_only_xml_illegal_control_characters(tmp_path: Path) -> None:
    content = "before\x01after"
    document = generator.SyntheticDocument(
        preset="small",
        sources=(generator.SourceDocument("fixture.md", content, len(content)),),
    )
    artifact = tmp_path / "fixture.docx"

    generator.render_document(document, "docx", artifact)

    assert "beforeafter" in _artifact_text(artifact)


def test_render_document_atomically_replaces_existing_artifact(tmp_path: Path) -> None:
    artifact = tmp_path / "animama-docs-small.md"
    artifact.write_text("stale content", encoding="utf-8")

    generator.render_document(_fixture_document(), "md", artifact)

    assert "stale content" not in artifact.read_text(encoding="utf-8")
    assert not list(tmp_path.glob(f".{artifact.stem}-*"))


def test_prompt_for_choice_retries_invalid_answers() -> None:
    answers: Iterator[str] = iter(("unknown", "4", "2"))
    output: list[str] = []

    selected = generator.prompt_for_choice(
        "file type",
        generator.OUTPUT_FORMATS,
        input_func=lambda _prompt: next(answers),
        output=output.append,
    )

    assert selected == "pdf"
    assert sum(line.startswith("Invalid file type") for line in output) == 2


def test_main_prompts_for_missing_choices_and_prints_summary(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    answers = iter(("1", "3"))
    expected_source_bytes = generator.load_synthetic_document("small").source_bytes

    result = generator.main(
        ["--output-dir", str(tmp_path)],
        input_func=lambda _prompt: next(answers),
    )

    artifact = tmp_path / "animama-docs-small.md"
    captured = capsys.readouterr()
    assert result == 0
    assert artifact.is_file()
    assert f"Generated: {artifact}" in captured.out
    assert "Sources: 12" in captured.out
    assert f"Source bytes: {expected_source_bytes}" in captured.out


def test_main_rejects_invalid_flag_choices() -> None:
    with pytest.raises(SystemExit):
        generator.main(["--format", "rtf", "--size", "small"])


def test_discovery_requires_both_documentation_roots(tmp_path: Path) -> None:
    (tmp_path / generator.DOC_ROOTS[0]).mkdir(parents=True)

    with pytest.raises(generator.SyntheticDocsError, match="Documentation root does not exist"):
        generator.discover_source_paths(tmp_path)


def test_loading_reports_invalid_utf8_source(tmp_path: Path) -> None:
    backend_docs = tmp_path / generator.DOC_ROOTS[0]
    frontend_docs = tmp_path / generator.DOC_ROOTS[1]
    backend_docs.mkdir(parents=True)
    frontend_docs.mkdir(parents=True)
    (backend_docs / "invalid.md").write_bytes(b"\xff\xfe")

    with pytest.raises(generator.SyntheticDocsError, match="not valid UTF-8"):
        generator.load_synthetic_document("full", tmp_path)

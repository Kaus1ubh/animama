# 0036: Uploads are processed in the core server without Docling

- Status: accepted (owner, 2026-11-12)
- Recorded: 2026-11-12
- Retrospective: no
- Original decision date: 2026-11-12 (owner decisions in
  [issue #871](https://github.com/raymond-van/animama/issues/871))
- Decision basis: Explicit owner decision, recorded in #871 and its
  [specification snapshot](../plans/core-upload-processing/core-upload-processing-spec.md);
  implementation choices in the
  [execution plan](../plans/core-upload-processing/core-upload-processing-execplan.md)
  Decision Log
- Partly supersedes: [ADR 0010](0010-shared-model-object-distribution.md)
  decision 6, which preserved archive handling and signed-code verification for
  `document-processing`, and the `document-processing` part of
  [ADR 0012](0012-backend-parakeet-model-assets.md) decision 5

## Context

Local compositions accept 14 upload formats. A durable job parses, chunks and
embeds each upload so an Anima can search and read it. Only a separate document
worker processed those jobs, and it needed Docling for every format except six
plain-text ones.

Docling is large. On the Compose worker image its `file-worker` extra added
about 1.1 GB of Python packages (torch, already the CPU-only build, was about
620 MB of it), and PDFs needed about 530 MB of downloaded layout and TableFormer
models. The desktop `document-processing` feature pack that would carry it had
a 1.5 GiB installed budget, as large as the core app's. Docling's models served
only PDFs: layout analysis (reading order, headings, running headers and
footers) and table structure. For DOCX, PPTX, XLSX, HTML, Markdown and CSV it
ran no models; it wrapped python-docx, python-pptx, openpyxl and BeautifulSoup
and chunked at headings.

As a result, no local composition processed uploads by default:

- **Desktop:** processing was enabled only while the pack was active. No pack
  was released, its signed macOS arm64 worker was never built, and the final
  desktop release's specification
  ([#837](https://github.com/raymond-van/animama/issues/837)) leaves its pack
  catalog empty. Every desktop upload, even a `.txt` file, was refused
  processing.
- **Self-host:** the Compose worker service was commented out, so jobs queued
  and files stayed at Processing.

## Decision

On 2026-11-12 (#871) the owner decided to make uploads work in every local
composition without Docling, giving up what its models added for PDFs:

1. **The core server processes uploads.** Every local composition (packaged
   desktop, built self-host and development) processes every accepted format
   inside the server process, through one path. No separate worker, feature
   pack or model file is installed, started or downloaded. The hosted
   composition still does not process uploads.
2. **Office documents and PDF text are read without Docling or torch.** DOCX,
   PPTX and XLSX use python-docx, python-pptx and openpyxl. A PDF is read from
   its text layer only: pages without selectable text are skipped and recorded,
   and a PDF with no text fails.
3. **Chunks follow headings.**
4. **The composer holds a send** while an attachment is uploading or
   processing, and until a failed attachment is removed.
5. **Docling is retired everywhere**: Docling, torch, the separate worker, the
   optional Compose worker and the `document-processing` pack, with its signed
   worker build, review and import tooling and release-workflow steps.
   `expanded-included-content` remains the only feature pack.
6. **The final desktop release is not delayed** for this change.

The specification accepted with these decisions adds that a failure a retry
cannot fix fails on the first attempt, that the runtime capability keeps its
shape (`worker_state` reports the in-server processor, `pack_id` stays a fixed
label), that `ANIMAMA_USER_FILE_PROCESSING_ENABLED=false` remains a self-host
off switch, and that each file is parsed under a time limit (default 120
seconds) and a memory limit.

The execution plan chose how: each file is parsed in a child process of the
same runtime (`parse-upload`) with an allowlisted environment and no network;
PDF text comes from pypdfium2, HTML from the standard library and XML through
defusedxml; the parser libraries form a `documents` extra that every local
environment installs and the hosted wheel omits; and chunks are sized in
`cl100k_base` tokens from the encoding file llama-index already bundles, so
nothing is downloaded.

## Alternatives

- **Release the `document-processing` pack.** It would keep Docling's PDF
  layout and table analysis, but needs a signed and notarized worker that was
  never built, a pack near its 1.5 GiB budget and its own redistribution
  review, and the final desktop release is specified without packs.
- **Process in the core on desktop only.** Self-host would keep a second,
  heavier processing path and a worker service that does not start by default.
- **Keep Docling as an optional self-host parser.** Operators could opt into
  PDF layout and table analysis, at the cost of two parsers, two chunkers and
  the torch dependency tree in the lockfile.

## Consequences

- PDFs lose layout analysis and table-structure recognition, and OCR (off by
  default before) is unavailable: a multi-column page reads in the order the
  PDF stores its text, PDF tables read as text, and scanned pages are skipped.
- Office reading, heading-aware chunking and the parse limits are Animama code
  to maintain, with tests for hostile inputs: ZIP bombs, entity expansion,
  encrypted, malformed and mismatched files, and the time and memory limits.
- The core app gains about 25–32 MB of parser libraries instead of an optional
  pack of up to 1.5 GiB. lxml statically links GNU libiconv (LGPL-2.1), and
  pypdfium2 carries the notices of PDFium's own components; both join the
  [redistribution review](../frontend/desktop/redistribution-review.md).
- Desktop uploads become readable offline; only embedding uses a provider.
- Chunks Docling already stored stay searchable; reprocessing replaces them.
- The HTTP contract, generated client and database schema do not change; the
  processing heartbeat keeps its `document-processing` row.
- Windows development with Uvicorn's auto-reload cannot start parse children,
  so upload jobs there retry and then fail; the packaged Windows app does not
  reload.
- The desktop release workflow loses its `prepare-worker` operation, and the
  changed lockfile and runtime inventory need fresh release review receipts.
  Animama Cloud's next repin refreshes its package inventories for the removed
  `file-worker` extra and modules.

## Evidence

- [Issue #871](https://github.com/raymond-van/animama/issues/871) and its
  [specification snapshot](../plans/core-upload-processing/core-upload-processing-spec.md):
  the problem, sizes, owner decisions and requirements R1–R7.
- [Execution plan](../plans/core-upload-processing/core-upload-processing-execplan.md):
  implementation choices, measurements and review findings.
- [User files](../backend/features/user-files.md): current processing, formats,
  limits and settings.
- [Feature packs](../frontend/desktop/feature-packs.md): the remaining pack and
  retired pack IDs.
- [`server/user_file_processing.py`](../../src/backend/animama/server/user_file_processing.py)
  and [`adapters/parsers/`](../../src/backend/animama/adapters/parsers/): the
  runner, the parse child and the parsers.

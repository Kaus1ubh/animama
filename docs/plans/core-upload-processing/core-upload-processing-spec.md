# Process uploads in the core server without Docling

Status: Agreed
Owner decision: direction and discovery choices agreed by the owner on
2026-11-12 and recorded in #871; this specification, including the seven
choices it proposed, was accepted as written on 2026-11-12.
Authority: [#871](https://github.com/raymond-van/animama/issues/871). This file
is a snapshot of that issue captured 2026-11-12T18:40:18Z; change the issue,
not this file.

## Problem and intended users

Local compositions accept 14 upload formats in the chat composer and the
Library. They store the original, then rely on a durable processing job to
parse, chunk and embed it, so an Anima can search and read it with
`search_uploaded_files` and `read_uploaded_file_chunks`. Only a separate
document worker processes those jobs, and it needs Docling for every format
except six plain-text ones.

- **Desktop:** the supervisor enables processing only when the
  `document-processing` feature pack is active. No pack has been released, its
  signed macOS arm64 worker has never been built, and R1.3 of the final desktop
  release specification (#837) leaves the final build's pack catalog empty.
  Every desktop upload is refused processing (`file_processing_unavailable`)
  and the app says document processing is not available, even for a `.txt`
  file the backend can already read with the standard library.
- **Self-host:** the Compose worker service is commented out. In a default
  stack processing is enabled but nothing claims the jobs, so uploads stay at
  Processing. A chat turn drops such attachments with only an INFO log, and the
  Anima says it cannot see the file.

The pack exists because Docling is large. Measured on the Compose worker image,
the `file-worker` extra adds about 1.1 GB of Python packages to the server
(torch is about 620 MB of that, already the CPU-only build), and PDFs need about
530 MB of downloaded layout and TableFormer models. The pack's installed budget
is 1.5 GiB, as large as the core app's.

Docling's models matter only for PDFs: layout analysis (reading order,
headings, running headers and footers) and table structure. For DOCX, PPTX,
XLSX, HTML, Markdown and CSV it runs no models and wraps python-docx,
python-pptx, openpyxl and BeautifulSoup. Its other contribution is chunking
that follows headings.

Intended users are people who use the desktop app or a self-hosted stack and
attach documents in chat or keep them in the Library. Maintainers also lose the
heaviest dependency tree and a signed-worker pipeline that was never used.

## Goals, scope and non-goals

Goals:

- Every local composition processes every accepted upload format inside the
  core server.
- Office documents and PDF text layers are read without Docling, torch or model
  files.
- Documents are chunked at their headings.
- The composer never sends a turn whose attachments the Anima cannot read yet.
- Docling, torch, the separate document worker, the optional Compose worker and
  the `document-processing` feature pack are retired.

Non-goals:

- OCR of scanned PDFs or images, PDF layout analysis and table-structure
  recognition.
- Formats beyond the current accepted list.
- The hosted composition, which does not process uploads.
- Reprocessing uploads saved before this change. Chunks Docling already
  produced stay searchable.
- Showing headings or page numbers to the Anima in tool results.
- The `expanded-included-content` feature pack.
- Holding the final desktop release for this work.

## Required behavior

### R1: The core server processes uploads

- **R1.1** In every local composition (packaged desktop, built self-host and
  development), finalizing an upload in a supported format queues a processing
  job that the core server process completes. No separate worker process,
  feature pack or model file is involved, and none has to be installed or
  started.
- **R1.2** The durable job contract stays: a claimed job holds a lease, a job
  interrupted by a stop or crash becomes claimable again when its lease expires
  and completes after a restart, and a transient failure retries up to the
  attempt limit.
- **R1.3** A failure that cannot succeed on retry (unsupported or malformed
  content, an encrypted document, a PDF with no text, or a limit in R3) fails
  the file on its first attempt, so the person sees the reason without waiting
  for retries.
- **R1.4** Embedding behavior is unchanged: an embedding failure leaves the
  file usable through keyword search (`ready_keyword_only`), and with embeddings
  off a processed file is `ready` for keyword search.
- **R1.5** Processing makes no network request other than to the configured
  embedding provider. Nothing is downloaded (no tokenizer, model or resource
  files), so the desktop app processes files offline when embeddings are off.
- **R1.6** Chat streaming and other requests keep responding normally while a
  file processes.
- **R1.7** The runtime capability keeps its shape. In local compositions
  `user_file_processing.enabled` is true and `worker_state` reports the
  in-server processor: `ready` while it runs, `stale` if it stops renewing its
  heartbeat. Self-host operators can still turn processing off with
  `ANIMAMA_USER_FILE_PROCESSING_ENABLED=false`, which keeps today's behavior:
  uploads are saved and processing is refused with
  `file_processing_unavailable`. The desktop app no longer sets this switch.
- **R1.8** The hosted composition's capabilities and behavior are unchanged.

### R2: Every accepted format is read

The supported formats are exactly the accepted upload list: `.txt`, `.md`,
`.rst`, `.org`, `.json`, `.csv`, `.tsv`, `.html`, `.htm`, `.xml`, `.docx`,
`.pptx`, `.xlsx` and `.pdf`. Each becomes Markdown text with its headings.

- **R2.1** Plain text: `.txt`, `.rst` and `.org` keep their text, `.md` keeps
  its Markdown, `.json` and `.xml` keep today's validation and output, and
  `.csv` and `.tsv` become Markdown tables.
- **R2.2** HTML: `.html` and `.htm` keep headings, paragraphs, lists, tables
  and link text in document order. Scripts, styles and markup are dropped.
- **R2.3** DOCX: headings (from heading styles), paragraphs, lists and tables
  in document order, read with python-docx.
- **R2.4** PPTX: slides in order, each under a heading with its title, followed
  by its text, tables and speaker notes, read with python-pptx.
- **R2.5** XLSX: each sheet in workbook order under a heading with its name, as
  a Markdown table of cell values (the values last saved with the workbook, not
  formulas), read with openpyxl.
- **R2.6** PDF: each page's text layer is read in the order the PDF stores it,
  without layout analysis, and page numbers are kept. Pages without selectable
  text are skipped. When at least one page has text, the file becomes ready,
  records the skipped page numbers, and the overview the Anima receives says
  which pages could not be read. When no page has text, the file fails with a
  reason saying it has no selectable text and may be scanned.
- **R2.7** An encrypted or password-protected document fails with the reason
  "Encrypted or password-protected documents are not supported".
- **R2.8** A file whose content does not match its extension, such as a
  `.docx` that is not a ZIP package or a `.pdf` without a PDF header, fails
  with a specific reason, as today.

### R3: Parsing untrusted files is bounded

- **R3.1** Each file is parsed under a time limit (default 120 seconds, the
  retired Docling timeout) and a memory limit. Exceeding either fails the file
  with a reason naming the limit, and the server keeps working normally.
- **R3.2** Office packages are expanded only within bounds on total
  uncompressed size and compression ratio, so a ZIP bomb fails the file instead
  of exhausting memory or disk.
- **R3.3** XML in `.xml`, `.docx`, `.pptx` and `.xlsx` files is parsed without
  external entities or DTD loading, and entity expansion is bounded.
- **R3.4** PDF decompression bombs and deeply nested structures fail the file
  within the R3.1 limits.
- **R3.5** Parsing never executes document content such as macros, scripts or
  embedded objects.
- **R3.6** The 25 MiB upload limit is unchanged.

### R4: Chunks follow headings

- **R4.1** Chunks split at heading boundaries. A section larger than the chunk
  size splits further at paragraph boundaries, then sentence boundaries; small
  adjacent sections may merge.
- **R4.2** Chunks stay within the configured chunk size
  (`ANIMAMA_USER_FILE_CHUNK_MAX_TOKENS`, default 800 tokens), counted offline.
- **R4.3** Each chunk's embedding text begins with its heading path, for
  example `Report > Results > Costs`. The stored chunk text does not carry that
  prefix.
- **R4.4** PDF chunks record the page numbers they span in their metadata.
- **R4.5** File overviews keep their outlines from document headings and their
  table, JSON and XML structure, as today.
- **R4.6** Processing the same file again yields the same chunks.

### R5: The composer holds sends until attachments are readable

- **R5.1** While any attachment in the composer tray is uploading, queued or
  processing, the person cannot send. The send control shows that it is
  waiting for files, and the typed message stays in the box. Sending becomes
  available once every attachment is `ready` or `ready_keyword_only`.
- **R5.2** A failed attachment shows its reason on its tray card through the
  existing stored-error display (a localized generic message with the English
  reason as detail). Sending stays unavailable until the person removes it.
- **R5.3** Removing a pending or failed attachment makes sending available
  again when no other attachment is pending.
- **R5.4** The hold applies to every way of sending a turn that carries the
  tray's attachments.
- **R5.5** Files chosen from the Library never hold a send, because the picker
  already lists only readable files.

### R6: Docling and the document-processing pack are retired

- **R6.1** Dependencies: the `file-worker` extra (Docling, torch, torchvision),
  the PyTorch CPU package index, the torch version hold and the extra's
  dependency-group conflict are removed. The lockfile contains no Docling,
  torch or torchvision.
- **R6.2** Backend: the Docling parser, the separate worker entry point, its
  frozen-worker runtime support, and settings that only configure Docling or
  the separate worker are removed.
- **R6.3** Self-host: the `animama-file-worker` image target, the commented
  Compose service, its Docling cache mount and the file-worker settings are
  removed from the Dockerfile, Compose files, `reset.sh` and `.env.example`.
- **R6.4** Desktop: the `document-processing` pack is removed from the pack
  catalog inputs, source manifest, size budgets and release records. The
  supervisor starts no document worker, the signed-worker build and its review
  and import tooling are removed with their release steps, and Settings and
  diagnostics no longer list the pack. The `expanded-included-content` pack
  works as before.
- **R6.5** The desktop app no longer shows "Document processing is not
  available in this app." Its uploads show the same progress as other local
  compositions.
- **R6.6** New or changed interface text exists in every UI locale: English
  and the beta locales Japanese, Korean, Simplified Chinese and Traditional
  Chinese.

### R7: Documentation and decision records match

- **R7.1** Current guidance (user files, development, desktop feature packs,
  runtime staging, releases and redistribution review) describes in-server
  processing and no longer documents Docling, the separate worker or the pack.
- **R7.2** An ADR records the retirement of Docling and the
  `document-processing` pack and amends ADR 0010 decision 6, which preserved
  signed-code verification for that pack. The Feature pack glossary entry no
  longer names document processing.
- **R7.3** The final desktop release record (#837) notes that this change
  supersedes its R3.4 wording and the R1.3 remark that both packs are deferred.
  The delivered specification itself stays as history.

## Constraints

- **Desktop size:** the added libraries (python-docx, python-pptx, openpyxl,
  lxml and a PDF library; about 25 MB uncompressed, measured on Linux) keep the
  core within `size-budgets.json` (750 MiB download, 1.5 GiB installed). The
  measured increase is recorded.
- **Licences:** every added library and bundled native component, including a
  PDF engine's own third-party components, appears in the packaged Python
  licence notices and passes the existing redistribution review.
- **Platforms:** works in the macOS arm64 and Windows x64 desktop builds, with
  native libraries bundled and signed as part of the core app.
- **Hosted and Cloud:** the hosted composition does not need the parser
  libraries, and its behavior is unchanged. Cloud consumes the shared package:
  its next repin refreshes its package inventories for the removed modules and
  extra, and admits or omits the new libraries.
- **Contracts:** public HTTP responses and the generated client have no
  breaking change (R1.7 keeps the capability shape).
- **Data:** no table or status change is expected. If one is needed, it edits
  the baseline migration. Existing uploads and their chunks keep working.
- **Security:** uploads are untrusted input (R3).
- **Performance:** on a typical desktop machine, a 50-page text PDF or a 1 MB
  DOCX becomes ready within 10 seconds, excluding embedding-provider time.
- **Release timing:** this ships in a desktop release if it is ready in time;
  the final desktop release is not delayed for it.

## Acceptance criteria

- [ ] Backend tests cover each format's output (headings, lists, tables,
  order, slide and sheet structure, PDF pages), chunking (heading boundaries,
  size limit, heading path, page metadata, repeatability) and the job path
  (lease recovery after a restart, transient retry, first-attempt failure).
- [ ] Backend tests cover hostile and broken inputs (ZIP bombs, entity
  expansion, encrypted Office and PDF files, image-only and partly scanned
  PDFs, malformed files, mismatched extensions, and the time and memory limits)
  and show that parsing makes no network request.
- [ ] Frontend tests cover the send hold for uploading, queued and processing
  attachments, the failed-attachment reason, and removal re-enabling sending.
- [ ] `make check-test`, `pnpm verify` and `pnpm e2e:test:fast` pass.
- [ ] On a built Compose stack with no worker service, one file of each
  supported format reaches `ready` and an Anima answers a question from each.
  A partly scanned PDF becomes ready with its skipped pages named in the
  Anima's overview, an image-only PDF and an encrypted document fail with their
  reasons, and a chat reply streams normally while a file near the size limit
  processes.
- [ ] In a locally packaged macOS app with no feature pack, the same
  per-format check passes with embeddings off, and the measured core size
  increase is recorded within budget.
- [ ] No dependency, packaging input, Compose file, setting or current
  document refers to Docling, torch, the separate document worker or the
  `document-processing` pack, apart from decision history.

## Open questions and decisions

Owner decisions (2026-11-12, recorded in #871):

- Process plain text, Office documents and PDF text in the core server without
  Docling or torch, instead of releasing the `document-processing` pack.
- Use one path for every local composition and retire Docling everywhere.
- Ship in a desktop release if ready; do not delay the final desktop release.
- Read Office documents with python-docx, python-pptx and openpyxl.
- A PDF with some text-less pages becomes ready with those pages recorded; a
  PDF with no text fails.
- Chunks follow headings.
- The composer holds sending while an attachment processes, and a failed
  attachment must be removed before sending.
- Acceptance: tests, a built Compose stack check and a locally packaged macOS
  app check.

Proposed in this draft and accepted with it (2026-11-12):

1. R5.1: sending is unavailable while files are pending; there is no queued
   send that fires automatically when they finish.
2. R1.3: failures that cannot succeed on retry fail on the first attempt.
3. R2.6: skipped PDF pages are named in the overview the Anima receives.
4. R2.4: PPTX speaker notes are included.
5. R1.7: the capability keeps its shape, and
   `ANIMAMA_USER_FILE_PROCESSING_ENABLED` stays as a self-host off switch.
6. R3.1: the default time limit is 120 seconds; memory and decompression
   bounds are set in the plan and covered by tests.
7. The performance bound under Constraints.

For the ExecPlan (implementation choices, not requirements):

- A processing loop in the server process, with parsing in a child process so
  the R3 limits can be enforced.
- pypdfium2 as the PDF library, unless the plan finds a reason for pypdf.
- How the parser libraries are declared, so the hosted install can omit them.
- How R4.2 counts tokens offline.
- Work order: in-server processing, the parsers and the send hold before
  Docling removal, so the desktop part can make a release.

## Spec

#871 (published 2026-11-12T18:40:18Z).

## ExecPlan

Pending: `to-execplan` writes
`docs/plans/core-upload-processing/core-upload-processing-execplan.md` after
this specification is agreed.

## Delivery links

- Parent issue: #871. Related: #837 (final desktop release), #868 (Compose
  worker PDF models).
- Branch: `feat/core-upload-processing`.

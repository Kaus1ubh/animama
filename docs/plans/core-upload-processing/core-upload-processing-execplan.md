# Process uploads in the core server without Docling

Source agreement: [#871](https://github.com/raymond-van/animama/issues/871),
published from the agreed [spec](core-upload-processing-spec.md) at
2026-11-12T18:40:18Z (accepted as written by the owner on 2026-11-12).
Authorized scope: the whole plan (owner approval G0, 2026-11-12).
Planning baseline and implementation base: `origin/main` at `aede262c0`.
Workspace: worktree `core-upload-processing`, branch
`feat/core-upload-processing`; no Compose stack yet.

## Purpose and context

After this plan, every local composition (packaged desktop, built self-host and
development) processes every accepted upload format inside the core server.
Office documents and PDF text layers are read without Docling, torch or model
files. Chunks follow headings, and the composer never sends a turn whose
attachments the Anima cannot read yet. Docling, torch, the separate document
worker, the optional Compose worker and the `document-processing` feature pack
are gone. The hosted composition, the generated client and the database schema
do not change.

Orientation, from read-only surveys on 2026-11-12 (line numbers at `aede262c0`):

- **Jobs.** `src/backend/animama/server/routers/user_files.py` `:process`
  (L343) enqueues through `UserFileProcessingService`
  (`app/services/user_file_processing_service.py`): `enqueue_processing_job`
  L324 (409 `file_processing_unavailable` when
  `animama_user_file_processing_enabled` is false), `claim_next_job` L383,
  `complete_claimed_job` L400-605 and `record_claimed_job_failure` L607 (retry
  delay `min(300, 2^(attempts-1))` seconds). The repository
  (`adapters/repositories/sqlalchemy/user_file_processing_repo.py`) claims
  queued or lease-expired running jobs with `attempts < max_attempts` and
  `SKIP LOCKED`, incrementing `attempts` at claim (L266-326). `mark_job_failure`
  (L517-552) requeues until the attempt limit. `reuse_processed_file`
  (L393-515) copies chunks from another upload with the same user, SHA-256 and
  extension.
- **Parsing and chunking.** `LIGHTWEIGHT_EXTENSIONS` (`.txt .rst .org .json
  .tsv .xml`) parse with the standard library (`parse_lightweight_user_file`).
  Everything else goes to `adapters/parsers/docling_user_file_parser.py`
  through the `UserFileParser` port (`app/ports/user_file_parser_port.py`).
  Domain types live in `domain/user_file_processing.py`
  (`ParsedUserFileDocument`, `UserFileChunkDraft`, `UserFileOutlineItem`,
  `UserFileOverview`). `chunk_parsed_user_file_document` (L197) uses a
  2,500-character window with 250 characters of overlap and repeats table
  headers for table-only documents. Parser-provided chunks are used as they
  are, and `embedding_text` feeds the embedder. `app/services/user_file_overview.py`
  `build_user_file_overview` takes its outline from `source_outline`, else from
  Markdown headings when `_supports_markdown_outline` (keyed partly on
  `parser_name == "docling"`), with JSON, XML, table and extractive fallbacks.
- **Worker.** `workers/user_file_processing.py` `UserFileProcessingWorker`
  creates its own engine, polls every 2 s, renews the heartbeat every 5 s
  (`runtime_worker_repo.record_document_heartbeat`, table
  `runtime_worker_heartbeats`, kind `document-processing`), resolves an
  embedder per job with `role_embedder`, and reads at most
  `anima_user_file_max_process_bytes` (10 MiB). It runs as the commented
  Compose `animama-file-worker` service, or on desktop through `runtime/cli.py`
  `worker user-files`, which execs the signed document-worker app from the pack.
- **Server composition.** `server/app.py` `create_local_app` starts
  `start_embedding_refresh` and automatic episode processing in
  `@on_event("startup")` and stops them on shutdown.
  `server/embedding_refresh.py` `EmbeddingRefreshWorker` is the pattern to
  follow: a task kept on `app.state`, a `wake()` event, and an embedder resolved
  through `ModelRoleSettings.for_app(app)` inside `runtime_credentials.pinned()`.
  No backend code starts child processes. The frozen entry point dispatches
  subcommands through `runtime/cli.py`.
- **Capability.** `server/runtime_capabilities.py` reports
  `user_file_processing` with `enabled`, `pack_id: "document-processing"`,
  `worker_state` and `last_heartbeat_at`
  (`app/contracts/runtime_capabilities.py` L18-23). Cloud's hosted routes pass
  `worker_state` and `pack_id`, so this shape stays (spec R1.7).
- **Desktop.** `src/frontend/desktop/src/main-process/runtime/supervisor.ts`
  sets `ANIMAMA_USER_FILE_PROCESSING_ENABLED` from the active pack (L206-218).
  The worker's lifecycle spans L443, 545-554, 624-631, 706-724, 761-798, 939,
  1008-1029 and 1071. The feature-pack machinery is generic except its
  signed-executable parts: `feature-packs/signature.ts`, `catalog.ts`
  L253-290, `feature-pack-build.ts`, `release-policy.mjs` L169 and L204-215,
  `release-macos.mjs` L187-194 and `measure.mjs`. `manager.ts`
  `RETIRED_PACK_IDS` with `removeRetiredPacks` is the existing way to retire a
  pack id, and `shared/desktop-runtime.ts` L113-117 lists the ids. Removing
  the pack only from the runtime JSON files makes staging throw
  (`validateReleasePolicy`, `measure.mjs`, `size.mjs`). The release smoke
  (`scripts/runtime/smoke-journey.mjs` L395-401) expects processing to be
  disabled on desktop.
- **Desktop Python.** The core environment is `uv sync --frozen
  --no-default-groups --group desktop-build` (`scripts/runtime/common.mjs`
  L393-410): base dependencies plus PyInstaller.
  `src/backend/packaging/desktop/python_licenses.py` lists every installed
  distribution. `pnpm desktop:mac:build:run` stages, packs and runs an unsigned
  local app without signing credentials.
- **Composer.** `web/src/ui/main/chat/ChatInterface.tsx` renders product-ui's
  `ChatInput` (`packages/product-ui/src/components/chat-input.tsx`). Its
  `disabled` also disables stop and voice-stop, and Enter submits regardless.
  Every send path runs `submitMessage` in
  `packages/product-ui/src/chat/useProductChatSession.ts`, which reads
  `getAttachedFileIds` (every tray file, whatever its status) at L1106. The
  send paths are the button, Enter, Voice Mode auto-send, prompt suggestions
  and desktop Quick Chat. Quick Chat clears its draft before the owner accepts
  it and sends the main window's tray. Tray state comes from
  `useUserFiles({ pollActive: true })` (every 3 s) and
  `web/src/lib/user-files/upload-card-status.ts`. The tray is never cleared
  after a send. Web tests use product-ui's built `dist`.
- **Records.** Every tracked file needs one entry in
  `licenses/source-review.json`, checked by
  `python3 scripts/public-release/check_source.py`; new files copy the fields
  of an existing original-work entry. The UI locales are `en`, `ja`, `ko`,
  `zh-Hans` and `zh-Hant`. product-ui has its own
  `locales/<tag>/product.json`, the term list is `src/frontend/i18n/terms.json`,
  and the process is in `docs/frontend/architecture/i18n.md`.

Boundaries: the hosted composition and Cloud behave as before, and the
generated client does not change. There is no schema change, because editing
the baseline migration changes the schema digest that desktop profiles verify.
Cloud refreshes its package inventories at its next repin, outside this plan.

## Progress

- [x] G0: the owner approved this plan on 2026-11-12.
- [x] Workspace setup: spec published to #871 (2026-11-12T18:40:18Z), label
  `triage:ready-for-agent`, environment installed, plan committed (p0).
- [ ] Phase 1: The core server processes uploads.
- [ ] Phase 2: Every accepted format is read.
- [ ] Phase 3: Chunks follow headings.
- [ ] Phase 4: The composer holds sends until attachments are readable.
- [ ] Phase 5: Docling, the separate worker and the pack are retired.
- [ ] Phase 6: Documentation and decision records.
- [ ] Final integration review, full pre-push suite and acceptance checks.
- [ ] PR opened with its evidence and remaining gates.

## Surprises & Discoveries

From planning research on 2026-11-12:

- No failure is permanent. Validation errors (a missing, empty or oversized
  payload, or no searchable text) retry three times, like crashes.
- A running job whose lease expires on its last attempt is never reclaimed, so
  its file stays at Processing; nothing sweeps it.
- Processing reads at most 10 MiB (`anima_user_file_max_process_bytes`) while
  uploads allow 25 MiB, so larger uploads fail processing. The spec keeps both
  limits; the acceptance check for a large file uses one near 10 MiB.
- The composer tray is never cleared after a send, so its files go with every
  later turn. Enter ignores `disabled`. Quick Chat sends the main window's tray
  and clears its own draft first.
- llama-index ships the `cl100k_base` tiktoken file in
  `llama_index/core/_static/tiktoken_cache`, which the desktop runtime already
  bundles.
- The Library's Process and Reprocess buttons are English-only and visible in
  production builds. Out of scope.
- `useRuntimeCapabilities` polls every 10 s while processing is enabled; with
  processing always on locally, that polling becomes permanent. Out of scope
  unless review finds a cost.
- Content reuse ignores which parser produced the source chunks, so re-uploading
  a file Docling processed reuses Docling's chunks. The spec keeps them.
- `python3 scripts/public-release/check_source.py` already fails on `main` at
  `aede262c0`: 14 files from earlier merges (the animation combo and reel
  scripts, and the humanoid bone repair module and its test) have no entry.
  This plan adds entries only for its own files and leaves that gap to the
  owner. Its checks therefore confirm that the report lists none of this
  task's files.

## Decision Log

- 2026-11-12, owner: direction, discovery choices and the spec, including its
  seven proposals, agreed (see the spec).
- 2026-11-12, owner: this plan approved as written (G0); the whole plan is
  authorized. The owner confirmed the scope is the desktop and self-host apps;
  the hosted Cloud app is unaffected.
- 2026-11-12, agent: parse in a child process started through a new runtime CLI
  subcommand (`parse-upload`) that exchanges JSON over pipes. Reasons:
  enforceable time and memory limits (R3.1), crash isolation, and one path for
  development, Compose and the frozen app without `multiprocessing` freeze
  support.
- 2026-11-12, agent: the parent enforces the time limit with a deadline and the
  memory limit by sampling the child's resident memory with psutil (a base
  dependency). Linux children also set `RLIMIT_AS`, which macOS ignores. The
  child blocks outbound sockets before parsing, so R1.5 holds by construction.
- 2026-11-12, agent: the parser libraries go in a new `documents` extra, so the
  hosted wheel can omit them. It holds python-docx, python-pptx, openpyxl,
  pypdfium2 and defusedxml, and every local environment installs it: Makefile
  `sync`, the CI sync step, the Dockerfile server stages and desktop
  `syncBuildEnvironment`. Locked today: python-docx 1.2.0 (MIT), python-pptx
  1.0.2 (MIT), openpyxl 3.1.5 (MIT), lxml 6.1.3 (BSD-3-Clause), pypdfium2
  5.14.0 (BSD-3-Clause or Apache-2.0, plus PDFium components) and defusedxml
  0.7.1 (PSF).
- 2026-11-12, agent: PDF text comes from pypdfium2. pypdf stays a
  development-only tool for building test fixtures.
- 2026-11-12, agent: HTML is read with the standard library's `html.parser`, and
  `.xml` with defusedxml.
- 2026-11-12, agent: token counts use tiktoken's `cl100k_base` from
  llama-index's bundled cache, with `TIKTOKEN_CACHE_DIR` set before import.
  `ANIMAMA_USER_FILE_CHUNK_TOKENIZER_MODEL` is retired.
- 2026-11-12, agent: a non-retryable failure marks the job and file failed at
  once using existing columns. A lease-expired job on its last attempt fails
  with an "interrupted" reason. No schema change.
- 2026-11-12, agent: the capability keeps `pack_id: "document-processing"` and
  `worker_state`. The runner records the existing heartbeat row with its own
  instance id, and the enqueue route wakes it so jobs start at once.
- 2026-11-12, agent: desktop retires the pack id through `RETIRED_PACK_IDS`.

## Phased implementation

Phases follow the agreed work order: in-server processing, the parsers and the
send hold land before the removal, so the desktop-visible part can make a
release. Phase 2 needs Phase 1's parse child, Phase 3 needs Phase 2's parser
output, Phase 4 needs only Phase 1, Phase 5 needs Phase 1's runner, and Phase 6
follows Phase 5. Each phase starts from the previous phase's commit.

### Workspace setup

After G0, in worktree `core-upload-processing`:

1. Publish the agreed spec as #871's body (parent-form sections), read it back,
   mark the spec file as a snapshot of the issue with its update time, and set
   the issue's triage label to `triage:ready-for-agent`.
2. Merge `origin/main` if it moved. Run `uv sync --python 3.12.13 --extra voice
   --extra viz --extra realtime --extra encrypt --all-packages --group dev`
   (the `make sync` set, pinned to Python 3.12.13), `pnpm install` in
   `src/frontend`, and `git lfs pull` before backend content tests.
3. Add source-review entries for the spec and plan, then commit
   `docs(uploads)[p0]: plan core upload processing`.

### Phase 1: The core server processes uploads

Review tier: high risk (concurrency, recovery, process management and the
capability contract).

Requirements: R1.1 to R1.8, R3.1, R3.6.

Steps, tests first in `tests/test_user_file_processing.py`,
`tests/test_runtime_capabilities.py` and new
`tests/test_user_file_processing_runner.py` and
`tests/test_user_file_parse_child.py`:

1. Non-retryable failures: add a rejection error in the processing service.
   `record_claimed_job_failure(..., retryable=False)` makes the repository fail
   the job and file at once. Today's validation errors (missing, empty or
   oversized payload, no searchable text) and parse rejections become
   non-retryable; unexpected errors keep retrying with backoff.
2. Interrupted last attempts: when claiming, a running job past its lease with
   `attempts >= max_attempts` is failed with "Processing was interrupted", so
   no file stays at Processing.
3. Parse child: `runtime/cli.py` gains `parse-upload`. It reads a JSON header
   and the payload from stdin and writes a serialized `ParsedUserFileDocument`
   or a rejection to stdout. It blocks sockets before importing parser code,
   sets `TIKTOKEN_CACHE_DIR` for Phase 3, and sets `RLIMIT_AS` on Linux.
   A new adapter, `adapters/parsers/isolated_user_file_parser.py`, implements
   `UserFileParser`. It starts the child (`sys.executable parse-upload` when
   frozen, `sys.executable -m animama.runtime.cli parse-upload` otherwise),
   enforces the deadline, samples the child's memory with psutil, kills it on
   either limit, and maps exits to non-retryable reasons. New settings:
   `ANIMAMA_USER_FILE_PARSE_TIMEOUT_SECONDS` (default 120) and
   `ANIMAMA_USER_FILE_PARSE_MEMORY_MB` (default 1024). In this phase the child
   reads the existing standard-library formats; other formats fail with a
   non-retryable "not supported yet" reason until Phase 2.
4. Runner: `server/user_file_processing.py` `UserFileProcessingRunner` follows
   `EmbeddingRefreshWorker`, with start, stop and wake helpers on `app.state`.
   `create_local_app` starts it when `animama_user_file_processing_enabled`.
   It takes the claim, complete, failure and heartbeat logic from
   `workers/user_file_processing.py` (the module itself goes in Phase 5) and
   uses the app's session factory. Each job resolves its embedder through
   `ModelRoleSettings.for_app(app)` and `role_embedder` inside
   `runtime_credentials.pinned()`. It processes one job at a time. Stop waits
   briefly for the current job, then leaves it to lease recovery. Confirm how
   many server processes each composition runs: several runners still claim
   safely with `SKIP LOCKED`, but the heartbeat row is per kind, so record what
   the capability shows.
5. The `:process` route wakes the runner after enqueueing.
6. Capability: `local_runtime_capabilities` compares the heartbeat with the
   runner's own instance id instead of `animama_document_worker_instance_id`.
   `enabled` stays tied to `ANIMAMA_USER_FILE_PROCESSING_ENABLED`. A test shows
   that the hosted capability response is unchanged.
7. Desktop: `supervisor.ts` stops setting `ANIMAMA_USER_FILE_PROCESSING_ENABLED`;
   its pack-specific worker code stays until Phase 5. `smoke-journey.mjs`
   L395-401 expects processing enabled on desktop. Update the supervisor and
   smoke tests.
8. Add source-review entries for new files.

Checks (from the worktree root unless noted):

- `uv run pytest -q tests/test_user_file_processing.py
  tests/test_user_file_processing_runner.py tests/test_user_file_parse_child.py
  tests/test_runtime_capabilities.py
  tests/test_product_http_runtime_capabilities.py
  tests/test_user_file_uploads.py tests/test_user_file_worker.py`; the worker
  tests pass or are adapted until Phase 5 removes them.
- `uv run ruff check`, `make mypy`, `python3 scripts/public-release/check_source.py`.
- From `src/frontend`: `pnpm --filter animama-desktop check` and the desktop
  test files covering the supervisor and the smoke journey.
- Task stack: `./reset.sh --name cup --base-port 8900`, or another free base
  port. With no worker service, a `.txt` and a `.json` uploaded in the composer
  reach Ready, and a `.docx` fails with the interim reason. A job interrupted
  by restarting `animama-server` completes after the restart. Keep the stack
  for the following phases and stop it when the session ends.

Recovery: `ANIMAMA_USER_FILE_PROCESSING_ENABLED=false` stops the runner; jobs
stay queued and resume when it is turned back on.

Completion: commit `feat(uploads)[p1]: process uploads inside the core server`.

Check record: not started.

#### Code Review #1 Findings

Not started.

#### Code Review #1 Revisions

Not started.

### Phase 2: Every accepted format is read

Review tier: high risk (new dependencies and the untrusted-input boundary).

Requirements: R2.1 to R2.8, R3.2 to R3.5; the licence and size constraints.

Steps, tests first in new `tests/test_user_file_parsers.py`. Fixtures are built
inside the tests: python-docx, python-pptx and openpyxl write Office files,
PDFs are small hand-written byte strings, pypdf (development only) encrypts
one, and hostile files are generated at test time:

1. Dependencies: add the `documents` extra and run `uv lock` (expect no
   version changes). Add `--extra documents` to Makefile `sync`, the CI
   `uv-sync` step in `.github/workflows/validate-public.yml`, the Dockerfile
   server stages and desktop `syncBuildEnvironment` in `common.mjs` with its
   test.
2. Parsers in `adapters/parsers/`: one module per family, a shared Markdown
   builder and a dispatcher. Each returns a `ParsedUserFileDocument` with
   Markdown text and `source_outline`:
   - **Text:** `parse_lightweight_user_file` moves here. `.csv` works like
     `.tsv`, `.md` stays as it is, and `.xml` is read through defusedxml.
   - **HTML:** `html.parser` keeps headings, paragraphs, lists, tables and link
     text, and drops scripts and styles.
   - **DOCX:** heading styles become levels; lists and tables keep body order.
   - **PPTX:** each slide is a heading with its title, followed by text frames,
     tables and notes.
   - **XLSX:** opened with `read_only=True` and `data_only=True`. Each sheet is
     a heading and a table, marked so table chunking applies.
   - **PDF:** pypdfium2 reads per-page text. Page offsets and skipped pages go
     in metadata, and the no-text and encrypted reasons apply.
   - **Dispatch:** the extension selects the parser. Header checks cover the
     PDF header and the ZIP container for Office files. An OLE compound-file
     header, which is how encrypted OOXML is stored, maps to the encrypted
     reason.
3. Bounds: a ZIP guard runs before any Office library opens the package. It
   limits the entry count, total uncompressed size and per-entry compression
   ratio, with module constants and tests. Confirm that python-docx and
   python-pptx parse with `resolve_entities=False` and that openpyxl uses
   defusedxml. No macro, script or embedded object is read.
4. The Phase 1 child dispatches every accepted extension, and the "not
   supported yet" path is removed.
5. Licences and size: confirm `python_licenses.py` lists the new
   distributions and that PDFium's bundled component notices are carried; add
   records under `licenses/third-party/` if pypdfium2's metadata lacks them.
   Measure the added size in the desktop build environment.
6. Add source-review entries for new files.

Checks:

- `uv run pytest -q tests/test_user_file_parsers.py
  tests/test_user_file_parse_child.py tests/test_user_file_processing.py`,
  `uv lock --check`, `uv run ruff check`, `make mypy`, and the
  `check_source.py` script.
- From `src/frontend`: the desktop test covering `syncBuildEnvironment`.
- `docker compose -f docker-compose.yml config --quiet` and the development
  selection. Rebuild `animama-server` for the task stack; one file of each
  supported format reaches Ready.

Completion: commit `feat(uploads)[p2]: read Office, HTML and PDF uploads without Docling`.

Check record: not started.

#### Code Review #1 Findings

Not started.

#### Code Review #1 Revisions

Not started.

### Phase 3: Chunks follow headings

Review tier: standard (behavior inside the processing service; no contract,
schema or dependency change).

Requirements: R4.1 to R4.6, and the overview note in R2.6.

Steps, tests first in `tests/test_user_file_processing.py` and
`tests/test_user_file_overview.py`:

1. A heading-aware chunker (`app/services/user_file_chunking.py`) used for
   every parsed document:
   - Sections follow Markdown headings.
   - Oversized sections split at paragraphs, then at sentences (including
     `。！？`), and small sibling sections merge up to the limit.
   - `embedding_text` is the heading path followed by the text.
   - PDF chunks carry `pages` from the parser's page offsets.
   - Table documents keep header-repeating table chunks under the sheet's
     heading path.
2. Token counts use `cl100k_base` from llama-index's cache, with
   `TIKTOKEN_CACHE_DIR` set before import in parent and child.
   `ANIMAMA_USER_FILE_CHUNK_MAX_TOKENS` keeps its meaning, and
   `ANIMAMA_USER_FILE_CHUNK_TOKENIZER_MODEL` is retired.
3. Overviews: the parsers' `source_outline` gives every format a structured
   overview. Skipped PDF pages appear in the overview description within its
   size bound. `_supports_markdown_outline` stops depending on
   `parser_name == "docling"`, while stored Docling rows still read correctly.
4. A repeatability test: processing the same file twice yields the same chunks.

Checks: the targeted `pytest` files; an offline test showing tokenization
works with sockets blocked and the cache directory set; `uv run ruff check`;
`make mypy`. On the task stack, a structured DOCX and a long Markdown file
produce chunks bounded by headings, as `/v1/files/debug/search` shows.

Completion: commit `feat(uploads)[p3]: chunk uploads at their headings`.

Check record: not started.

#### Code Review #1 Findings

Not started.

#### Code Review #1 Revisions

Not started.

### Phase 4: The composer holds sends until attachments are readable

Review tier: high risk (product-ui is a shared package whose exported API and
declarations change).

Requirements: R5.1 to R5.5, R6.5, and R6.6 for this phase's text.

Steps, tests first in `ui/components/chat-input-submit-state.test.ts`,
`lib/user-files` unit tests, `hooks/useDesktopQuickChatRuntime.test.ts`,
product-ui `tests/chat-lifecycle.test.mjs` and a new happy-dom test for held
sends:

1. A pure helper in `web/src/lib/user-files/` derives the hold from the tray's
   files and backend rows, keyed on the card status `id`:
   - **Waiting:** preparing, initializing, uploading, finalizing, queued,
     processing, or uploaded while processing is enabled.
   - **Blocked:** failed, or uploaded while processing is turned off.
   - **None:** every attachment is ready.

   Library selections never hold a send, because the picker lists only
   readable files (R5.5).
2. product-ui changes:
   - `useProductChatSession` accepts an optional hold callback. `submitMessage`
     checks it before clearing the input and returns false with the text kept.
   - `ChatInputSubmit` and `resolveChatInputSubmitState` show a held state
     (waiting for files, or remove failed files to send) without using
     `disabled`, so stop and voice-stop keep working.
   - A held Voice Mode auto-send keeps the spoken words and shows a notice.
3. `ChatInterface.tsx` passes the hold. `DesktopQuickChatSnapshot` and its
   validator carry it, so Quick Chat shows the held state and keeps its draft.
4. Remove the desktop-only `processingUnavailableDesktop` branch in
   `useUserFileUpload.ts` and its key in every locale; the generic message
   stays for the self-host off switch.
5. Add the new text in all five locales (web `chat.json` and `app.json`,
   product-ui `product.json`) following `docs/frontend/architecture/i18n.md`,
   then run `pnpm i18n:extract`.
6. Bump the product-ui version and check its declaration hashes as the
   package requires.

Checks (from `src/frontend`): `pnpm -s packages:build`; the targeted vitest
files; the product-ui tests; the i18n checks in
`docs/frontend/architecture/i18n.md`; and the browser tests that
`src/frontend/AGENTS.md` lists for composer changes. In the browser pane on
the task stack, sending is held while a file processes, with both the button
and Enter. A failed file shows its reason and sending returns when it is
removed. Voice Mode keeps held words.

Completion: commit `feat(chat)[p4]: hold sends until attachments are readable`.

Check record: not started.

#### Code Review #1 Findings

Not started.

#### Code Review #1 Revisions

Not started.

### Phase 5: Docling, the separate worker and the pack are retired

Review tier: high risk (dependencies, build, packaging and release tooling).

Requirements: R6.1 to R6.4, and R6.6 for this phase's text.

Steps, using the 2026-11-12 inventory. Remove the id from
`shared/desktop-runtime.ts` first and let the TypeScript errors drive the
desktop checklist:

1. Dependencies: remove the `file-worker` extra, the PyTorch index and
   sources, the `torch<2.14` hold with its comment, the dev-group conflict and
   the mypy override. Run `uv lock`; `uv.lock` then has no Docling, torch or
   torchvision.
2. Backend:
   - Delete the Docling parser, `runtime/document_worker.py` and
     `workers/user_file_processing.py`, whose loop now lives in the runner.
   - From `runtime/cli.py`, remove `worker user-files` and
     `delegate_document_worker`.
   - Remove the settings `ANIMAMA_DOCUMENT_WORKER_INSTANCE_ID`,
     `ANIMAMA_DOCUMENT_PACK_VERSION`, `ANIMAMA_DOCLING_ARTIFACTS_PATH` and
     `ANIMAMA_USER_FILE_DOCLING_*`.
   - Remove the document-job blocker in `feature_pack_removal_repo.py`, and
     the pack from `domain/feature_packs.py`.
   - Delete `animama-document-worker.spec`, `document_worker_entrypoint.py` and
     `document_worker_resources.py` under `src/backend/packaging/desktop/`.
   - Keep the heartbeat table and the capability contract. If dropping the id
     from desktop-control validation would change the OpenAPI document, keep
     the schema and refuse the id in the handler, so the generated client stays
     unchanged.
3. Self-host: delete the Dockerfile `animama-file-worker` stage, the commented
   Compose service, the `docling-cache` volume, the worker-related server
   environment, the Docling cache handling in `reset.sh`,
   `scripts/local-stack-state-common.sh` L28, and the `.env.example` keys.
4. Desktop:
   - Remove the document-worker paths from `supervisor.ts` (environment,
     start, stop, restart, readiness, update and credential handling) and its
     tests.
   - Delete `feature-packs/signature.ts`,
     `scripts/runtime/{document-worker.mjs,document-native.mjs,worker-input.mjs,worker-input.ts}`,
     `runtime/document-worker-launcher.c` and
     `runtime/document-worker.entitlements.plist`.
   - Drop the pack from `feature-pack-releases.json`, `source-manifest.json`,
     `size-budgets.json`, `feature-pack.schema.json`, `catalog.ts`,
     `feature-pack-build.ts`, `feature-packs.mjs`, `release-policy.mjs`,
     `release-macos.mjs`, `measure.mjs`, `smoke-policy.mjs`,
     `macos-acceptance.example.json`, the package scripts and `knip.json`. In
     `manager.ts`, add the id to `RETIRED_PACK_IDS`.
   - Remove the `prepare-worker` job and operation choice from
     `.github/workflows/release-desktop-macos.yml`.
   - The `expanded-included-content` pack keeps working.
5. Web:
   - Remove the pack row from `DesktopFeaturePacksPanel.tsx` and its locale
     keys, and reword `featurePacks.inUse` in every locale.
   - Remove the "Document worker" line and the pack panel from
     `LibraryChatUploadsDebugPanel.tsx`.
   - Update desktop-pack sample ids in tests. The hosted fixture and hosted
     exclusions stay.
6. Remove the `licenses/source-review.json` entries for deleted files.
7. The `uv.lock` and `source-manifest.json` changes invalidate the stored
   release review receipts. Regenerating them stays with the owner's release
   process; record this in the PR.

Checks:

- `uv lock --check`, `uv run pytest -q` on the affected test files,
  `uv run ruff check`, `make mypy`, `bash -n reset.sh`, both
  `docker compose ... config --quiet` selections, and the `check_source.py`
  script.
- A search for `docling|torch|document-processing|document_worker|file-worker`
  outside `docs/plans/` and `uv.lock` finds only decision history and the kept
  capability literal.
- From `src/frontend`: `pnpm --filter animama-desktop check` and
  `pnpm desktop:test`.
- `python3 ../../scripts/heavy-slot.py -- pnpm desktop:runtime:stage --
  --platform darwin --arch arm64` succeeds, the staged pack catalog has no
  `document-processing`, and the size budgets pass. Confirm first that no pack
  is running.

Completion: commit
`chore(uploads)[p5]: retire Docling and the document-processing pack`.

Check record: not started.

#### Code Review #1 Findings

Not started.

#### Code Review #1 Revisions

Not started.

### Phase 6: Documentation and decision records

Review tier: light (documentation). The final integration review covers it.

Requirements: R7.1 to R7.3.

Steps:

1. Current guidance:
   - **Backend:** `docs/backend/features/user-files.md`, and
     `docs/backend/operations/development.md`, whose "Optional document
     worker" section gives way to in-server processing, the `documents` extra,
     the limits and the settings. Also `desktop-runtime.md`,
     `model-assets.md`, `data-model.md` and `http-api.md` for the capability
     semantics.
   - **Desktop:** `docs/frontend/desktop/` (`feature-packs.md`,
     `runtime-staging.md`, `releases.md`, `overview.md`, `platforms.md`,
     `redistribution-review.md` and `troubleshooting.md`).
   - **Uploads UI:** `docs/frontend/features/user-file-uploads.md` for the
     send hold.
   - **Guides:** `src/backend/AGENTS.md`, `src/frontend/AGENTS.md`, the
     desktop `README.md` and `src/backend/packaging/desktop/README.md`.
   - Do not run Prettier on Markdown.
2. ADR 0035 records processing uploads in the core server without Docling,
   with its reasons (size, a signed worker never built, the final desktop
   release) and consequences. It amends ADR 0010 decision 6 and ADR 0012's
   document-processing remark; update their status lines and the ADR index.
3. The Feature pack glossary entry stops naming document processing.
4. At PR time, comment on #837 that #871 supersedes its R3.4 wording and the
   R1.3 remark that both packs are deferred.
5. Add the source-review entry for the ADR.

Checks: a search for stale references to the retired worker, pack and
settings, and the `check_source.py` script.

Completion: commit `docs(uploads)[p6]: describe in-server upload processing`.

Check record: not started.

## Final integration review

The review covers the combined acceptance for R1 to R7, folds in Phase 6, and
reuses still-valid phase evidence. After its repairs, the full pre-push suite
runs once on the final candidate through the heavy slot: root
`python3 scripts/heavy-slot.py -- make check-test`, then from `src/frontend`
`pnpm verify`, `pnpm web:test:browser` and `pnpm prettier:check`. Then
`python3 ../../scripts/heavy-slot.py -- pnpm e2e:test:fast` runs against a
disposable built stack.

### Code Review #1 Findings (final integration)

Not started.

### Code Review #1 Revisions (final integration)

Not started.

## Validation and acceptance

The agent runs these checks on the final candidate (the spec's acceptance
criteria):

1. **Built Compose stack:** `ANIMAMA_WEB_BUILD_MODE=production ./reset.sh
   --name cup --base-port 8900`, which has no worker service, with the stack's
   existing chat-provider configuration. In the browser pane:
   - One file of each of the 14 supported formats reaches Ready, and an Anima
     answers a question from each.
   - A partly scanned PDF becomes Ready with its skipped pages named in the
     Anima's overview.
   - An image-only PDF and an encrypted DOCX and PDF fail with their reasons.
   - A reply streams normally while a file near the 10 MiB processing limit
     processes.
   - With embeddings off, a 50-page text PDF and a 1 MB DOCX each go from
     upload to Ready in under 10 seconds (the spec's performance bound).
   - The send hold works with the button and with Enter.

   Stop the stack afterwards.
2. **Packaged macOS app:** `pnpm desktop:mac:build:run`, an unsigned local
   build with no feature pack. With embeddings off, the same per-format check
   passes. Record the core size increase from the stage report against
   `size-budgets.json`. Run no other checks while it packs.
3. **Windows x64:** there is no local Windows build environment. The desktop
   Windows release tests must still pass. The PR records native bundling of
   lxml and pypdfium2 on Windows as unperformed until the next Windows
   staging run.
4. **Records:** the PR records the results, environment limits and any
   unperformed check, and keeps local evidence apart from hosted CI.

Remaining gates after the PR:

- The owner approves the merge of the exact candidate.
- Cloud, at its next repin, refreshes its package inventories for the removed
  `file-worker` extra and modules, and omits or admits the `documents` extra.
- The desktop release stays owner-run; its review receipts must be
  regenerated.
- If the final desktop release is scheduled before Phase 5 lands, the owner
  decides whether Phases 1 to 4 ship as their own PR. The default is one PR.

## Idempotence and recovery

- No schema change. Jobs and files are durable, and
  `ANIMAMA_USER_FILE_PROCESSING_ENABLED=false` stops processing without losing
  data.
- A failed or killed parse child never affects the server; it fails that file
  with a reason.
- Tests, `uv lock` and desktop staging can be rerun. Reverting a phase commit
  restores the previous behavior; reverting Phase 5 restores the dependencies
  through the lockfile.
- The `cup` stack is task-owned: `./reset.sh --name cup` restarts it, and it is
  stopped after acceptance.
- A development profile that still holds a `document-processing` pack has it
  removed on start through `RETIRED_PACK_IDS`.

## Outcomes & Retrospective

Not started.

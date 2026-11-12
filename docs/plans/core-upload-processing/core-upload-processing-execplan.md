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
- [x] Phase 1: The core server processes uploads (review passed after two
  repair rounds; the stack check moved to Phase 2).
- [x] Phase 2: Every accepted format is read (review passed after one repair
  round; the stack check passed for Phases 1, 2 and 4, except the
  skipped-pages note, which is Phase 3 work).
- [x] Phase 3: Chunks follow headings (review passed after two repair rounds;
  the stack check showed heading chunks, PDF page ranges and the skipped-pages
  answer).
- [x] Phase 4: The composer holds sends until attachments are readable
  (review passed after two repair rounds; the browser-pane checks moved to the
  Phase 2 stack check).
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
- Phase 1: Windows development with auto-reload cannot start child
  processes, because uvicorn's reloader uses a selector event loop. There,
  jobs retry and then fail. The packaged Windows app does not reload.
- Phase 1: Compose passes an explicit environment list to `animama-server`, so
  the new parse-limit settings, and the poll, lease and size settings, cannot
  be overridden in a self-host stack until Compose and `.env.example` list
  them. Phase 2 adds them while it edits the Compose and Docker files.

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
- 2026-11-12, agent (Phase 2): a PDF with only an owner (permissions)
  password is read, because it opens without a password, as in viewers and
  the retired Docling path. Its copy restriction is not enforced. Only PDFs
  that need a password to open get the encrypted reason. Reported to the
  owner.
- 2026-11-12, agent (Phase 2): `.xml` files, and the XML inside Office
  packages, are refused if they declare any entity, which is stricter than
  before and allowed by R3.3.
- 2026-11-12, agent (Phase 2): lxml is new to the desktop app and statically
  links GNU libiconv (LGPL-2.1). This is reported to the owner and recorded in
  the redistribution-review doc (Phase 6).
- 2026-11-12, agent (implementation): Phase 4 ran in parallel with Phase 1
  because they touch separate files. It is committed after Phase 1, and Phases
  2 and 3 follow. The text parser moved to `adapters/parsers/` in Phase 1
  rather than Phase 2, so the child stays small (see the Phase 1 notes).

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

Implementation notes (2026-11-12):

- **Text parser moved early.** The child does not import the service module.
  It imports `adapters/parsers/text_user_file_parser.py` instead, and the
  Markdown table helper moved to the domain module. Importing
  `animama.app.services` pulled in the ORM, pgvector and numpy. In a Linux
  container the child then took about 550 MB of address space, 10 OpenBLAS
  threads and 1 s to start, and crashed inside OpenBLAS under a 256 MB limit.
  Now it takes about 40 MB, one thread and 0.1 s, and a test pins its import
  footprint. A 149 MB JSON file under a 128 MB limit fails with the memory
  reason.
- **Responsiveness.** Chunking and the overview run in a worker thread.
  In-loop they blocked for 1.3 s (overview of 10 MiB of text) and 1.15 s
  (chunking a 7.8 MB table). A test checks that the server keeps answering.
- **Child hardening.** The child runs in its own session (a process group
  without a window on Windows) with a scrubbed environment: no `ANIMAMA_*`
  variables and no provider keys. Core dumps are off, a CPU-time limit bounds
  an orphaned child, and its stdout is protected from stray library output.
- **Claims.** Claiming always commits, so the sweep of interrupted last
  attempts sticks even when nothing is claimed. A file with a newer queued job
  is left alone.
- **Wake and settings.** The `:process` route wakes the runner through a
  FastAPI dependency, and the OpenAPI document is byte-identical. Settings
  reject zero, negative or infinite parse limits at startup.
- **Process count.** Every composition runs one runner: built Compose and
  desktop `serve` run one uvicorn process, and development Compose and the
  native launcher run the reloader plus one app process.
- **Desktop smoke.** The smoke journey records `no_automatic_optional_download`
  and a new `core_upload_processing` check.

Check record (uncommitted tree; the Phase 1 files hash to tree `0ed87dff` on
top of `e0ce5ff01`):

- Red first: the new runner, child and capability tests failed before the
  implementation.
- `timeout 1200 uv run --no-sync pytest -q tests/test_user_file_processing.py
  tests/test_user_file_processing_runner.py tests/test_user_file_parse_child.py
  tests/test_runtime_capabilities.py
  tests/test_product_http_runtime_capabilities.py
  tests/test_user_file_uploads.py tests/test_user_file_worker.py`: exit 0, 139
  passed, 1 skipped. The skipped test is Linux-only (`RLIMIT_AS`) and was
  checked by hand in a Linux container.
- The related composition, packaging, wiring and boundary test files: 37
  passed. Import boundary checker: 0 forbidden edges.
- `uv run --no-sync ruff check` passed; `ruff format --check src/backend tests`
  was clean; `UV_NO_SYNC=1 make mypy` found no issues in 897 files.
- From `src/frontend`: `pnpm --filter animama-desktop check` exit 0; the
  runtime-supervisor and smoke-hardening vitest files: 65 passed.
- Not run in this phase: the task-stack check (moved to the Phase 2 stack
  check, which covers it), the frozen app, Windows, and the full pre-push
  suite.

#### Code Review #1 Findings

The review covered tree `0ed87dff` (all 25 files matched) at high risk. The
reviewer reran:

- The phase's pytest command (139 passed, 1 skipped), `ruff check`,
  `make mypy` and the import boundary checker.
- The two desktop vitest files (65 passed).
- An OpenAPI export: byte-identical to the baseline (sha256 `f3fa651d`).

It also probed the event loop and the child environment.

- P1-R1-F1 (blocking): the final chunk write flushes every chunk at once.
  pgvector's bind processing then holds the event loop: 4,660 chunks with
  1536-dimension embeddings stalled it for 1.62 s. Content reuse rebinds
  vectors the same way.
- P1-R1-F2 (blocking): the child environment removed only `ANIMAMA_*`
  variables and provider keys. `PGPASSWORD`, `PGHOST`, `PGUSER` and unrelated
  shell secrets still reached the child.
- P1-R1-F3 (blocking): the six new files had no source-review entry.
- P1-R1-F4: the child's `error_type` was never logged.
- P1-R1-F5: a child that died for environmental reasons failed the file
  permanently. The desktop smoke would not catch a broken frozen
  `parse-upload` dispatch.
- P1-R1-F6: `read_claimed_upload` reported every read error as "not found",
  which is now permanent.
- P1-R1-F7: the interrupted-restart stack check had to carry over to Phase
  2, and the hosted-capability test from step 6 was missing.
- P1-R1-F8: in the interim, a running optional worker or pack would lose
  Office and PDF jobs to the runner's "not supported yet" until Phase 2, so
  Phases 1 and 2 must ship together.
- P1-R1-F9 (optional): a graceful stop left the cancelled job to the 300 s
  lease. For Phase 2, check that pypdfium2 and lxml start under the Linux
  `RLIMIT_AS`.

The reviewer judged the Windows auto-reload limitation acceptable for
packaged and Compose use, and to be documented in Phase 6. It verified sound:
the claim and sweep transitions, wake ordering, child cancellation and
reaping, the pipe handling, and the instance-id capability.

#### Code Review #1 Revisions

All findings were accepted.

- F3: entries are added with the Phase 1 commit.
- F7: the stack check already carries over in Phase 2.
- F8: Phases 1 and 2 ship together in this plan's single PR.
- F1, F2, F4, F5 (with a smoke check that requires a ready worker and, where
  practical, one `.txt` reaching Ready), F6, the hosted test from F7, and F9's
  requeue went back to the implementer as repair round 1.

Repair round 1 results:

- **F1.** Chunks are written 32 per flush (`CHUNK_WRITE_BATCH`). Content reuse
  copies chunks inside the database with one `INSERT … SELECT`, so vectors
  never pass through Python. It keeps the chunk ids, the current-model vector
  rule and the metadata rewrite. On the reviewer's case of 4,660 chunks ×
  1,536 dimensions:

  | Path | Max loop gap before | Max loop gap after | Total time |
  |---|---|---|---|
  | Write | 1.63 s | 0.02 s | 2.91 s → 2.88 s |
  | Reuse | not measured | 0.009 s | 0.73 s |

  Write and reuse have tests with embeddings on.
- **F2.** The child's environment is an allowlist: path, home, temp, locale,
  `LD_LIBRARY_PATH`, `TIKTOKEN_CACHE_DIR`, named Python and PyInstaller
  variables, and Windows system variables. Its test includes `PG*`, cloud and
  token secrets.
- **F4.** A `UserFileParseError` base carries `error_type`. The runner logs it
  with the job and file ids and the extension, and logs only the length of
  the child's stderr.
- **F5.** A child that ends without a valid answer raises a retryable
  `UserFileParseChildError`. Timeouts, the memory limit and content rejections
  stay permanent. The desktop smoke requires `worker_state` `ready`, its
  `desktop-smoke.txt` to reach Ready with chunks, and the file to stay Ready
  after a restart.
- **F6.** A new port error, `PrivateFileUnavailableError`, covers a missing
  file and a size mismatch, which are permanent. Other read errors retry.
- **F7.** A hosted-style composition test checks the exact hosted
  `user_file_processing` values and that no runner starts.
- **F9.** A graceful stop requeues the in-flight job without spending its
  attempt.

Implementer's record after the round:

- The Phase 1 pytest command: 150 passed, 1 skipped. Related tests: 41
  passed.
- Ruff, `make mypy` (897 files) and the boundary checker were clean. The
  OpenAPI document is unchanged.
- The desktop check and the two desktop vitest files (65) passed.

The packaged-app smoke itself was not run. The Phase 1 files hash to tree
`ab324dac` on `e0ce5ff01`; Code Review #2 rechecks them.

#### Code Review #2 Findings

The targeted recheck covered tree `ab324dac` (all 28 files matched) at high
risk. It confirmed F1, F2, F4, F5, F6, F7 and F9.

- **F1.** The reviewer's probe showed a 0.020 s longest loop gap for writes
  and 0.010 s for reuse. All 4,660 rows were copied with matching vectors.
  The SQL copy keeps the chunk-id form, owner filter, current-model vector
  rule, embedding text, counts, metadata rewrite and database defaults. The
  batches only flush, and the service commits once, so other sessions never
  see a partial set of chunks.
- **F2.** The probe dropped `PG*`, `ANIMAMA_*`, provider, cloud and token
  secrets and `PYTHONSTARTUP`, and real children still start.
- **F9.** Requeue cannot race the sweep or another claimer. It runs while
  the heartbeat still renews the lease, and it is conditioned on
  `status='running' AND locked_by=<self>`.

There were no regressions. One non-blocking note: the release smoke accepted
only `ready`, so an embedding hiccup that leaves the file `ready_keyword_only`
would fail it.

The reviewer reran the Phase 1 pytest files plus `test_local_app_composition.py`
and `test_user_file_storage.py` (159 passed, 1 skipped), `ruff check`,
`make mypy`, the boundary checker and the two desktop vitest files (65
passed).

#### Code Review #2 Revisions

The smoke now accepts `ready` or `ready_keyword_only` for processing and
persistence, through a `searchable` list. `node --check` passed, the
smoke-hardening tests passed (6), and Prettier was clean. This is repair round
2; Code Review #3 rechecks it.

#### Code Review #3 Findings

The recheck found only the smoke file changed since `ab324dac`. The change is
correct: a missing response short-circuits before `chunk_count` is read, and
`ready_keyword_only` still proves the packaged child read the file. The
reviewer reran `node --check` and the smoke-hardening tests (6 passed). No
blocking finding remains, and Phase 1 passes review. The source-review entries
for the six new files land with this commit.

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
- Composer checks in the browser pane on the same stack, deferred from
  Phases 1 and 4:
  - Sending is held while a file processes, with both the button and Enter.
  - A failed file shows its reason, and removing it makes sending available
    again.
  - Voice Mode keeps held words.
  - Desktop Quick Chat keeps its draft and shows the hold. If the browser
    pane cannot reach Quick Chat, this moves to the packaged-app check.
  - A job interrupted by restarting `animama-server` completes after the
    restart.

Completion: commit `feat(uploads)[p2]: read Office, HTML and PDF uploads without Docling`.

Stack check (2026-11-12). Stack `cup`: development build, base port 8900,
application at `http://animama-cup.localhost:8900`, with the uncommitted
Phase 2 tree `64fe2856` on `2e3e3e1bf`. Only the web service is published, on
loopback; the server and PostgreSQL are private, and there is no worker
service. The server image has the parser libraries and no Docling. The browser
pane was hidden, and clicks, typing and DOM checks worked.

- **Formats.** One file of each of the 14 formats, plus a partly scanned PDF,
  reached Ready within about 6 s. Annie answered every file's code word
  correctly over four turns: the existing per-turn file-reading limit stopped
  the first turn after four reads. Annie could not name the partly scanned
  PDF's skipped pages, because the overview note is Phase 3 work.
- **Large file.** A 9 MiB text file reached Ready in about 2.7 s, and Annie
  answered from it.
- **Hold.**
  - While the file processed, the send control read "Waiting for files to be
    ready" (`aria-disabled`).
  - A real Enter showed "Attached files are not ready yet.", kept the text and
    sent nothing.
  - The control returned to "Send message" at Ready.
- **Failures.** All three failed on attempt 1, and the server logged their
  error types:
  - An image-only PDF failed with "This PDF has no selectable text; it may be
    scanned." (`NoSelectableText`).
  - An encrypted PDF and an encrypted DOCX failed with "Encrypted or
    password-protected documents are not supported" (`EncryptedDocument`).

  The control read "Remove unreadable files to send". Enter showed "Remove
  unreadable files before sending.", and removing the files restored "Send
  message".
- **Concurrency.** In a second tab, a chat reply streamed to completion while
  three unique 9 MiB files parsed: 0.17–0.25 s per parse, 1.7–1.9 s per job,
  between 16:11:25 and 16:11:30. Byte-identical re-uploads skip parsing
  through content reuse. Timing inside the hidden pane is throttled, so the
  quantitative bound rests on Phase 1's loop-gap tests.
- **Restart.** Restarting `animama-server` while four unique 9 MiB files
  processed lost nothing. One job finished during the graceful shutdown, the
  rest after startup, and all four were Ready about 7 s after the restart. The
  requeue-on-cancel path was not reached live; tests cover it.
- **Not checked live:** Voice Mode (no microphone in the pane; tests cover
  it) and desktop Quick Chat (moved to the packaged-app check).

Implementation notes (2026-11-12):

- **New modules.** `adapters/parsers/` gains `dispatch.py` (its set equals
  `ALLOWED_USER_FILE_EXTENSIONS`, tested), `markdown_builder.py`,
  `rejections.py`, `office_package.py`, and one module per format for HTML,
  DOCX, PPTX, XLSX and PDF. Each imports its library inside the parse
  function. The text parser is now `parse_text_user_file`/`TEXT_EXTENSIONS`,
  with a `.md` outline, `.csv`, and `.xml` through defusedxml. The child
  dispatches every format and blocks numpy.
- **Office package checks.** An OLE header gets the encrypted reason. The ZIP
  guard allows up to 10,000 parts, 256 MiB expanded, and a ratio of 100 for
  parts over 1 MiB. XML entities in `.xml`, XLSX, DOCX and PPTX share one
  reason.
- **DOCX.** Title is level 1 and Heading N is level N+1. Tracked insertions
  and content controls are read; deletions, TOC paragraphs, text boxes,
  headers and footers are skipped.
- **PPTX.** Placeholders become list items, and date, footer and number
  placeholders are skipped.
- **XLSX.** Leading and trailing empty rows and columns are trimmed. A
  workbook or deck with no text gets the no-text reason.
- **PDF.** Bookmarks become the outline, up to 1,000.
- **HTML.** Legacy charsets decode with browser superset encodings.
- **Restriction-only PDFs.** A PDF with only an owner (permissions) password
  opens without a password and is read. Only PDFs that need a password to open
  get the encrypted reason. This is a reading of R2.7, reported to the owner.
- **Install.** `--extra documents` is in the Makefile, the CI `uv-sync` step,
  `scripts/ci/local_validate.py`, both Dockerfile server syncs, `common.mjs`
  (with a new arguments test) and the `development.md` sync commands. Compose
  and `.env.example` gain the five user-file settings.
- **Licences.** `python_licenses.py` now includes declared licence files, the
  `LICENCE` spelling and a Latin-1 fallback. Before, it dropped pypdfium2's 18
  PDFium-component notices and openpyxl's, et_xmlfile's and FreeType's notices.
  As a side effect, PyJWT, Pygments, SQLAlchemy, asyncpg, nltk, sse-starlette,
  tqdm and animama-backend gain notices. lxml's notice says its wheels bundle
  LGPL-2.1 iconv, which goes to the owner's redistribution review.
- **Freezing.** No spec change was needed: pyinstaller-hooks-contrib covers
  pypdfium2_raw, the docx and pptx templates, openpyxl and lxml. A frozen
  PyInstaller 6.22.2 probe read every format. Minimum macOS versions are 13.0
  (PDFium) and 11.0 (lxml).
- **Size.** 32.4 MB in the macOS venv (lxml 19.9 MB of it) and 25.3 MB on
  Linux aarch64.
- **Memory limit.** On Linux, the child read every format under a 1 GiB limit
  and a 256 MB limit. Without the numpy block, XLSX crashed in OpenBLAS at 256
  MB.
- **Speed.** A 50-page PDF took 0.17 s and a 0.71 MB DOCX 0.89 s through the
  real child.

Check record (uncommitted tree `64fe2856` on `2e3e3e1bf`; all exit 0):

- `timeout 1500 uv run --no-sync pytest -q tests/test_user_file_parsers.py
  tests/test_user_file_parse_child.py tests/test_user_file_processing.py
  tests/test_user_file_processing_runner.py tests/test_user_file_uploads.py
  tests/test_desktop_runtime_packaging.py`: 201 passed, 1 skipped.
- `uv lock --check` (lock diff: only the extra's metadata, no version
  changes); `ruff check`; `ruff format --check src/backend tests`.
- `UV_NO_SYNC=1 make mypy`: no issues in 908 files. Boundary checker: 0 edges.
- `pnpm --filter animama-desktop check`; `runtime-packaging.test.mjs`: 83
  passed.
- Both `docker compose ... config --quiet` selections.
- Neighbouring backend tests: 200 passed. `scripts/ci` unit tests: 143 OK.

#### Code Review #1 Findings

The review covered tree `64fe2856` (rebuilt and matched) at high risk. The
reviewer reran:

- The pytest command (201 passed, 1 skipped), `uv lock --check`,
  `ruff check`, `make mypy` and the boundary checker.
- `runtime-packaging.test.mjs` (83 passed) and the `scripts/ci` unit tests
  (143 OK).
- Both Compose config checks, and `check-repository-dependencies.py` (0
  private dependencies).
- `check_source.py`, which fails only on `main`'s 14 missing entries.

Probes are in the session scratchpad.

- P2-R1-F1 (blocking): the ZIP guard trusted declared sizes. A 408 KB DOCX
  whose part declared 1,000 bytes passed and added 809 MiB before being
  refused. Through the child, deflate and bzip2 variants were stopped only by
  the memory limit.
- P2-R1-F2 (blocking): `MARKDOWN_ATX_HEADING_RE` backtracked cubically. A
  6 KB `.txt` made the server-side overview take 14.5 s on the single runner,
  though the event loop stayed responsive. Long `.md` lines exceeded the
  child's time limit. `\s` also let U+3000 and the no-break space form
  headings.
- P2-R1-F3 (blocking): the eleven new files had no source-review entry.
- Non-blocking:
  - lxml statically links LGPL-2.1 GNU libiconv, for the redistribution
    review.
  - The `python_licenses.py` side effects are sound (198 records, no binary
    text), but the test list misses XlsxWriter.
  - R3.4 has no test: a 1.5 MB Flate-bomb PDF hits the memory limit, and deep
    nesting and huge page counts parse normally.
  - A non-text `<meta charset>` such as `base64` failed the file.
  - A legacy OLE `.doc` renamed `.docx` got the encrypted reason instead of
    the mismatch reason.
  - A UTF-8 BOM stayed in the first CSV cell.
  - Refusing every XML entity declaration is stricter than before.
  - Reading owner-password-only PDFs fits R2.7's intent but ignores their copy
    restriction.
  - A 4M-cell XLSX answer cost the server 12.1 s and 272 MiB to decode.
  - A venv without `--extra documents` failed Office and PDF files with a
    vague reason.

  The reviewer found the dependencies, CI and hosted-wheel exclusion correct.

#### Code Review #1 Revisions

All findings were accepted.

- F3: entries are added with the Phase 2 commit.
- The lxml licence note goes to the Phase 6 redistribution-review doc and the
  owner's report.
- The stricter XML entity rule and the owner-password reading are recorded in
  the Decision Log.
- The XLSX answer cost moves to Phase 3, which owns how tables travel.
- F1, F2, XlsxWriter, an R3.4 Flate-bomb test, charset fallback, telling
  encrypted packages from legacy OLE files, BOM handling and the
  missing-extra reason went back to the implementer as repair round 1.

Repair round 1 results:

- **F1.** Entries that are neither stored nor deflated are refused. Every
  part is inflated once, 64 KiB at a time, and refused if it grows past its
  recorded size, so the real total stays within the cap. Tests cover lying
  parts in all three formats, bzip2 and LZMA refusals, a corrupt stream and an
  honest part.
- **F2.** The heading pattern is `^ {0,3}(#{1,6})(?:[ \t]+(.*))?$`, with the
  closing run stripped in Python and `[ \t]` in the fence pattern too. The
  builder's escape matches it exactly. Overview titles are cut before
  normalising, which fixes a related quadratic path.
- **Other repairs.** XlsxWriter joins the notice test. A Flate-bomb test was
  added. A non-text or unknown HTML charset falls back to UTF-8. An OLE file
  holding an `EncryptedPackage` stream gets the encrypted reason, and any
  other OLE file the mismatch reason. Text formats decode as `utf-8-sig`. A
  missing documents extra gives "This installation cannot read .docx files:
  the documents extra is not installed." (`DocumentsExtraMissing`).
- **Memory backstop.** The Linux `RLIMIT_AS` backstop equalled the memory
  limit, so PDFium aborted first and a bomb failed as retryable. The backstop
  is now twice the memory limit plus 512 MB, and the parent samples resident
  memory every 10 ms.

Implementer's checks: the Phase 2 pytest command passed 226 with 1 skipped,
and the lock, Ruff, mypy and boundary checks were clean.

#### Code Review #2 Findings

The targeted recheck covered tree `c84de78e` (rebuilt and matched; diffed
against `64fe2856`) at high risk. It confirmed every fix:

- **F1.** Through the real child, a lying deflate part was refused at a 33 MiB
  peak (was 1,131), and bzip2 and LZMA parts at 31–32 MiB.
- **F2.** A 20,000-character hostile line takes 0.003 ms, and server-side
  overviews 0.001 s.
- **Flate bomb.** It now stops at a 1,102 MiB peak under 1,024 MB, and 306 MiB
  under 256 MB.
- **Other repairs.** The charset fallbacks, BOM handling and missing-extra
  reason were verified.

The reviewer answered three follow-up questions:

- **Sampling.** Sampling every 10 ms costs about 0.9% of a core. A burst can
  overshoot by about 180 MB at most; 50–78 MiB was measured.
- **Inflation cost.** It stays within the parse time limit. The worst case,
  10,000 entries sharing one part, extrapolates to about 55 s, and `zipfile`
  then refuses overlapped entries. A one-pass cap is optional and not taken.
- **OLE check.** It can be fooled only into the other refusal reason, and
  never opens the file.

There were no regressions. The reviewer reran the Phase 2 pytest command (226
passed, 1 skipped), the overview tests (16 passed), Ruff, mypy, the boundary
checker and the lock check. No blocking finding remains; F3 lands with this
commit, and Phase 2 passes review.

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

Implementation notes (2026-11-12):

- **Modules.** `app/services/user_file_chunking.py` is the heading-aware
  chunker. `app/util/text_tokens.py` builds `cl100k_base` directly from
  llama-index's bundled file after a SHA-256 check, so tiktoken never resolves
  or downloads anything. A missing or damaged file falls back to a CJK-aware
  estimate with one warning. Runs over 512 characters are counted in pieces,
  because tiktoken is quadratic on long unbroken runs.
- **Merging and splitting.** Adjacent sections merge while they fit whole,
  keeping their heading lines, and the chunk path is the headings they share.
  Oversized sections split by paragraphs, sentences, lines, words, then a
  token cut, and never merge. Table-only documents never merge, so each sheet
  keeps its own chunks.
- **Size.** The 800-token limit covers the embedding text. A path longer than
  a quarter of the limit drops its outer headings. Chunks no longer overlap,
  and `token_estimate` is an exact `cl100k_base` count.
- **Tables.** `tables` carries summaries (header cells, row count, sheet and
  range) instead of cells, and the chunker finds tables in the Markdown and
  repeats their header row. CSV and TSV cells with a newline or pipe are
  escaped onto one line.
- **Metadata.** `pdf_pages` is no longer copied into stored metadata.
- **Overviews.** Markdown outlines are keyed on format rather than the Docling
  parser name, table overviews come from the summaries, and the
  skipped-pages note is added.
- **Settings.** The tokenizer setting is retired, and the server refuses a
  chunk size below 64. `ANIMAMA_USER_FILE_CHUNK_MAX_TOKENS` still needs a
  Compose and `.env.example` entry, which Phase 5 part 2 adds.
- **XLSX answer** (6 MiB, 4M cells): the answer shrank from 42.9 to 19.6 MiB,
  decode memory from +247 to +35 MiB, and peak RSS from 500 to 279 MiB.
  Chunking went from 2.05 s to 3.09 s, and from 9,091 to 18,182 chunks,
  because the 800-token limit is now enforced. A 9.9 MiB workbook (6.6M cells)
  still gives a 32.4 MiB answer and 30,000 chunks, about 24M tokens to embed.
  The spec has no output cap, so none was added; the owner is told.
- **Timings,** in a worker thread, with the longest event-loop gap:

  | File | Chunking | Overview | Longest loop gap |
  |---|---|---|---|
  | 9 MiB text | 0.67 s | 0.57 s | 46 ms |
  | 8.6 MiB Markdown with 9,000 headings | 0.82 s | — | 34 ms |
  | 100-page PDF | 0.02 s | — | 17 ms |
  | 9 MiB CSV | 0.55 s | — | 34 ms |

- **Docs.** `docs/backend/features/user-files.md` gains Chunking, Overview and
  settings sections, and `development.md` one sentence.

Check record (uncommitted tree `a8b5b0e1` on `56cce87de`):

- Red first: the new tests failed before the implementation.
- The six-file Phase 3 pytest command: 258 passed, 1 skipped. Related chat,
  runner, uploads, composition, memory-tool and packaging tests: 451 passed.
- `ruff check` and `ruff format --check` were clean, `make mypy` found no
  issues (911 files), and the boundary checker found 0 edges.
- Stack check on `cup`, with the backend reloaded on the Phase 3 tree:
  - A DOCX with three headed sections gave two chunks under 800 tokens:
    "Field guide", covering Birds and Trees merged, and "Field guide > Rivers".
    The embedding text starts with the heading path, and the stored text has
    no prefix.
  - A four-page PDF with blank pages 2 and 4 gave one chunk with
    `pages: [1, 3]`.
  - Annie answered: "Pages two and four have no readable text, and the code
    word is QUARTZ-89."

#### Code Review #1 Findings

The review covered tree `a8b5b0e1` at standard tier. The reviewer judged
R4.1–R4.6, R2.6 and the XLSX item met. It fuzzed 400 Markdown documents
(22,748 chunks, limits 64–800, tables, unusual spaces, CJK and code blocks):
no chunk went over its limit, no text was lost, and a second run was
identical. The tokenizer matches `tiktoken_ext.openai_public`, and no consumer
other than the overview reads `tables`.

- P3-R1-F1 (blocking): wide tables and long runs of short words held every
  chunk's pieces and split words up front.
  - A 9 MiB CSV with 1,000 columns took 10.2 s, raised RSS from 385 to 1,166
    MiB, stalled the loop for 301 ms, and produced only prose chunks.
  - A one-line 9 MiB word list took 7.2 s, reached 1,402 MiB RSS and stalled
    the loop for 266 ms.
- P3-R1-F2: token-only limits let a fixed-width report produce 28,097-character
  chunks. The read tool's estimate refuses those as too long to read.
- P3-R1-F3: a chunk size of 1 or 2 looped forever, though settings forbid
  values under 64.
- P3-R1-F4: the "exact count" claims were overstated for indented table rows
  and cut runs.
- P3-R1-F5: exact counting is unverified in the packaged app; the staged
  runtime predates Phase 3.
- P3-R1-F6 (optional): a stale XLSX docstring, and an unused tokenizer-cache
  hook in the child.

#### Code Review #1 Revisions

All findings were accepted.

- F5 is added to the packaged-app check: its log must not contain the "token
  counts are estimated" warning.
- F1 to F4 and F6 went back to the implementer as repair round 1. F1 was to
  emit chunk summaries and split lazily, with a memory and time regression
  probe. F2 was a character cap matching the read tool. F3 was a minimum-size
  guard. F4 was counting each final chunk exactly.

Repair round 1 results:

- **F1.** The chunker was rewritten.
  - Sections stream, and each chunk is found by guessing a cut, snapping back
    to the best boundary in the span's second half, then counting.
    Boundaries go from block, to sentence, line, table cell, space, and
    finally a hard cut.
  - No object is made per word, line or row, and each chunk's metadata is
    recorded when it is emitted.
  - Wide tables: a header too big for a chunk gets its own chunks. Row chunks
    repeat a header cut to its first columns when it would take over half a
    chunk, and long rows split after a cell.
  - Measurements:

    | Probe | Time | Memory | Longest loop gap |
    |---|---|---|---|
    | Wide CSV | 9.3 s → 2.1 s | flat (was +781 MiB) | 239 ms → 1 ms; all chunks `table`, 13,328 of 13,335 repeat the header |
    | One-line word list | 6.7 s → 0.7 s | 1,402 → 195 MiB | — |
    | Unpunctuated CJK | 22.8 s → 2.7 s | — | — |
    | Realistic Japanese Markdown | 0.8 s → 0.6 s | — | — |

  - A bounded memory and time test covers single-character words,
    unpunctuated CJK and a wide CSV.
- **F2.** A chunk's text holds at most 4 × `max_tokens` characters (3,200 by
  default). An end-to-end test reads every chunk of a fixed-width report
  through `read_uploaded_file_chunks`. The chunk size is now limited to
  64–2,000, so a chunk always fits one read.
- **F3.** The chunker raises `ValueError` outside 64–2,000.
- **F4.** `token_estimate` is the exact encoded count of the final embedding
  text, exact up to 16,384 characters, and the wording matches.
- **F6.** The docstring is fixed, and the child's unused tokenizer-cache hook
  is removed.

English prose usually hits the character cap first, at about 740 tokens per
chunk.

Implementer's record:

- The six-file Phase 3 pytest command: 266 passed, 1 skipped.
- The related set: 452 passed.
- Ruff, mypy (911 files) and the boundary checker were clean.

The Phase 3 files hash to tree `e7266167`; Code Review #2 rechecks them.

#### Code Review #2 Findings

The targeted recheck covered tree `e7266167` (matched) at standard tier and
confirmed F1, F3, F4 and F6.

- **F1.** Reruns kept memory flat with loop gaps of 1–15 ms. The wide CSV took
  2.2 s, the word run 0.8 s, unpunctuated CJK 2.7 s and Japanese Markdown
  0.6 s. A 20,000-column CSV and one-line base64 also stayed flat.
- **Fuzz.** A reduced fuzz of 300 documents gave 73,279 chunks, with limits
  64–2,000, CJK, Cyrillic, wide and indented tables, code blocks and long
  runs. It found no chunk over a limit, no lost text, no wrong path, no
  inexact estimate, and identical reruns.
- **F2 (non-blocking gap).** The cap guarantees the read limit only for ASCII,
  because the read tool counts each non-ASCII character as a token. At 2,000,
  Cyrillic word runs reached 6,209 and runs of `—` reached 8,041 estimated
  tokens, over the tool's 6,000.

The reviewer reran the six-file pytest command (266 passed, 1 skipped) and
`test_memory_file_tools.py` (85 passed).

#### Code Review #2 Revisions

F2's gap was closed in repair round 2 by lowering the largest chunk size to
1,400. Then 4 × 1,400 = 5,600 characters, which is at most 5,600 estimated
tokens in any script, inside the read tool's 6,000 with room for framing. The
docstrings and `user-files.md` say so. A new test checks `— `, `что `, `…` and
`漢` runs at the largest size against the read tool's own estimate. At
standard tier, this one-constant change needs no reviewer recheck. After it,
the six Phase 3 files plus `test_memory_file_tools.py` passed 355 with 1
skipped, and `ruff check`, `make mypy` (911 files) and the boundary checker
(0 edges) were clean. Phase 3 passes review.

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

Implementation notes (2026-11-12). This phase ran in parallel with Phase 1 on
separate files and is committed right after it.

- **Hold states.** `blocked` wins over `waiting`, because waiting alone would
  never release the send.
- **Voice Mode.** With Voice Mode on and held words in the box, the button
  offers stop-voice instead of the held state, because the microphone control
  only mutes.
- **Failed enqueue.** It marks the card failed with its reason, so the hold
  blocks instead of waiting forever. If capabilities cannot be read, the hook
  still requests the enqueue and lets the server decide.
- **Quick Chat.** It shows the held state in a tooltip, with no toast.
- **Wording.** "Waiting for files to be ready", "Remove unreadable files to
  send". "Unreadable" also covers originals saved while processing is turned
  off.
- **Declarations.** Four product-ui `.d.ts` files changed additively
  (`chat/session-bindings`, `chat/useProductChatSession`,
  `components/chat-input-submit-state`, `components/chat-input`), so
  product-ui moved from 0.19.0 to 0.20.0 in `package.json` and
  `contracts/hosted-web.md`. Cloud admits 0.20.0 at its repin.
- **Docs.** `docs/frontend/features/user-file-uploads.md` describes the hold,
  and `docs/frontend/runtime/voice.md` held voice turns. The upload doc's pack
  section is Phase 5 and 6 work.

Check record (uncommitted tree; the Phase 4 files hash to tree `53112b41` on
top of `e0ce5ff01`; from `src/frontend`):

- Red first: 11 failures across 6 files, plus 1 for Voice Mode.
- `timeout 900 pnpm -s packages:build` and `pnpm -s packages:check`: exit 0.
- `pnpm --filter animama-web check:source`: exit 0.
- Targeted vitest (6 files): 50 passed. Neighbouring chat, user-files,
  uploads, hooks, library, components and routes folders: 60 files, 417
  passed.
- `pnpm --filter @animama/product-ui test`: 50 passed.
- `pnpm i18n:extract`, `pnpm i18n:check` and `pnpm i18n:status`: exit 0.
- `pnpm web:lint`: exit 0. `pnpm prettier:workspace --check`: exit 0.
- Browser: `hosted-composition` 29 passed. `hosted-workflows` passed 25 when
  run alone; under load it failed 1 unrelated settings test on a first-page
  timeout.
- Not run: the browser-pane check on a stack (moved to the Phase 2 stack
  check), `pnpm verify`, e2e and the full pre-push suite.

#### Code Review #1 Findings

The review covered tree `53112b41`, recomputed unchanged before and after the
reviewer's runs, at high risk. The reviewer reran:

- `packages:build` (exactly the 4 expected declarations changed; 66 files),
  `packages:check`, and the product-ui tests (50 passed).
- The 6 targeted vitest files (50 passed), and 62 neighbouring files (432
  passed).
- `check:source`, `i18n:check`, `i18n:status`, `web:lint`, and
  `hosted-composition` (29 passed).

Findings:

- P4-R1-F1 (blocking): the three new files have no `licenses/source-review.json`
  entry.
- P4-R1-F2 (non-blocking): the browser-pane checks deferred to Phase 2 were
  not listed there. These are a failed file's reason, removal re-enabling
  sending, held Voice Mode words and the Quick Chat draft. The reviewer also
  suggested a helper test for removing the failed file from a failed and ready
  pair.
- P4-R1-F3: a held Enter in Quick Chat was silent, and the doc's "a notice
  says why" was untrue there.
- P4-R1-F4: the upload doc did not mention the Voice Mode exception.
- P4-R1-F5 (optional): the held `aria-disabled` replaced a consumer's value.
- P4-R1-F6 (optional): the snapshot's `attachmentHold` was optional, for an
  owner window that predates the hold. The project wants no pre-launch
  compatibility paths.
- P4-R1-F7 (optional): the hold arguments were built twice in
  `ChatInterface.tsx`.
- P4-R1-F8 (optional, narrow race): the hold was checked before chat creation
  awaited, but file ids were read after it.

Verified with no finding: every send path passes the guard before the input
is cleared, polled rows release the hold, the card-status precedence change is
safe, and R6.5 and R6.6 are met across all five locales.

#### Code Review #1 Revisions

All eight findings were accepted.

- F1: entries are added with the Phase 4 commit.
- F2: the checks were added to the Phase 2 stack check. A helper test was
  added (`chat-attachment-hold.test.ts`): removing the failed file from a
  failed and ready pair gives `none`.
- F3: a held Quick Chat submit shows the same localized notice and keeps the
  draft. product-ui exports `useChatAttachmentHoldNotice`, which both the
  session and Quick Chat use. New test:
  `web/src/routes/-quick-chat-attachment-hold.test.tsx`.
- F4: the upload doc states the Voice Mode exception and the Quick Chat
  notice.
- F5: the held control sets `aria-disabled={held || consumer value}`.
- F6: the snapshot field is required and validated.
- F7: a single `holdFor` builds the hold arguments.
- F8: attached file ids are read right after the hold check, before any
  await, with a test that adds a file during chat creation.

Four new tests failed before these repairs. After them, the implementer's
record:

- `packages:build`, `packages:check` and product-ui 50 passed.
- 7 targeted files 55 passed; 61 neighbouring files 422 passed.
- `check:source`, `i18n:check`, `web:lint` and both Prettier checks passed.
- Declarations: still the same 4 files, within the 0.20.0 bump.

#### Code Review #2 Findings

The targeted recheck covered tree `cd8eb101` at high risk. It confirmed F2 to
F8 and found one regression from F6.

- P4-R2-F1 (blocking): the Quick Chat safety-bridge fixture in
  `CompanionSafetyView.test.tsx` lacked the now-required `attachmentHold`.
  The earlier neighbouring run had not included `src/ui/safety`.

The reviewer reran `packages:build` and `packages:check`, the declaration
diff, product-ui (50 passed), the 7 targeted files (55 passed), 65
neighbouring files (442 passed, 1 failed: F1), `check:source`, `i18n:check`
and `web:lint`.

#### Code Review #2 Revisions

P4-R2-F1 was fixed by adding `attachmentHold: "none"` to the fixture. The file
passed 9 tests. A grep shows the only other snapshot fixture is already
updated. This is repair round 2, the last allowed; Code Review #3 rechecks
it.

#### Code Review #3 Findings

The recheck confirmed the fix (fixture line only) and reran 65 neighbouring
vitest files, which passed 443, and `check:source`, which exited 0. No
blocking finding remains, so Phase 4 passes review.

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

Implementation notes, part 1: desktop, web, Compose and CI. This ran in
parallel with Phase 3, on files Phase 3 does not touch.

- **Deleted:** `feature-packs/signature.ts`,
  `scripts/runtime/{document-worker.mjs,document-native.mjs,worker-input.mjs,worker-input.ts}`,
  `runtime/document-worker-launcher.c` and
  `runtime/document-worker.entitlements.plist`.
- **Supervisor.** It loses every worker path and its environment, and
  `document_job` is no longer a removal blocker.
- **Pack catalog.** `catalog.ts` requires every pack to be data-only,
  unsigned and mode `0644`. `manager.ts` loses the executable-verifier seam and
  adds the id to `RETIRED_PACK_IDS`. `shared/desktop-runtime.ts` drops the id.
- **Release tooling.** The pack builder, `feature-packs.mjs`,
  `release-policy.mjs` (the core app's `team_id`/`signing_identity` stay),
  `release-macos.mjs`, `measure.mjs` and `smoke-policy.mjs` drop the pack.
- **Runtime JSONs and scripts.** The runtime JSONs and schema, the acceptance
  example, the package scripts and `knip.json` drop it too.
- **Release workflow.** The macOS release workflow loses its `operation` input,
  `prepare-worker` job and build gate, and its concurrency group is fixed.
- **Web.** The pack row and the debug panel's pack panel and "Document worker"
  line are gone. `featurePacks.inUse` is reworded and the pack strings removed
  in all five locales.
- **Self-host.** The Dockerfile worker stage, the commented Compose service,
  the `docling-cache` volume, a stale Torch comment, the Docling cache in
  `reset.sh` and `scripts/local-stack-state-common.sh` are gone.
- **Expanded pack.** Its flows stay: the manifest format keeps its fields, so
  existing manifests stay compatible, and catalog and update limits follow
  `featurePackIds.length`, now 1.
- **New tests.** A leftover document pack starts no worker, passes no
  `ANIMAMA_DOCUMENT_*` environment and is removed. The retired id is refused
  as a release input and as a size budget.
- **Kept on purpose:** the generated capability `pack_id` literal, the hosted
  route exclusion and the retirement entry.

Check record, part 1 (uncommitted; from `src/frontend` unless noted):

- `pnpm --filter animama-desktop check` exit 0.
- `pnpm desktop:test` passed 645 with 14 skipped on rerun. The first run
  failed `fuses.test.mjs` under load average 5; that file reads the real
  Electron binary and passed alone.
- `check:source` exit 0. Touched vitest files plus `LibraryPage.test.tsx`
  passed 29, and the touched browser file passed 5.
- `i18n:check`, `web:lint` and `prettier:check` exit 0. Knip, which is not in
  `pnpm check`, kept its 1,077 existing findings with none new.
- From the root: `bash -n reset.sh`, both Compose config selections and
  `validate_local_compose.py` exit 0. `tests/test_compose_network_boundaries.py`
  and `test_local_state_scripts.py` passed 151.
- `python3 ../../scripts/heavy-slot.py -- pnpm desktop:runtime:stage --
  --platform darwin --arch arm64` exit 0 in about 3.5 min, with the runtime
  audit OK. It first required `pnpm install --frozen-lockfile` after the
  product-ui 0.20.0 bump; the lockfile was unchanged. The pack catalog has no
  entries, and the build and size reports list only the deferred
  `expanded-included-content`. The core stage, including the Phase 2 parser
  libraries, is 878,048,581 B installed and 395,458,096 B to download,
  against budgets of 1,610,612,736 and 786,432,000.

Check record: part 2 (backend and dependencies) follows Phase 3.

#### Code Review #1 Findings (part 1)

The review covered tree `ec3ea0cc` (recomputed unchanged at start and end) at
high risk, scoped to part 1; part 2 gets its own review. The reviewer reran:

- the desktop check, `pnpm desktop:test` (645 passed, 14 skipped, no flake)
  and the five touched desktop test files (205 passed);
- `check:source`, the touched web vitest files (29 passed), `i18n:check` and
  `web:lint`;
- `bash -n` on both shell scripts, both Compose selections with
  `validate_local_compose.py`, and the Compose and state-script tests (151
  passed);
- a YAML and reference check of the workflow (actionlint is not installed);
- `check_source.py` against temporary indexes.

Findings:

- P5-R1-F1 (blocking): the seven deleted desktop files still had
  source-review entries, which surfaced as `stale: 7` against the part-1
  tree.
- P5-R1-F2 (blocking): `.env.example` still set the dead
  `ANIMAMA_DOCLING_CACHE_HOST_PATH`.
- P5-R1-F3 (blocking, trivial): desktop Settings search still listed
  "document processing" as a keyword for the feature-pack section.
- P5-R1-F4: stale wording remained in `electron-guide.md`, `files.ts`,
  `release-windows.mjs` and a `LibraryPage.tsx` comment. The
  `DesktopFeaturePacksPanel` `only` prop is used only by its test.
- P5-R1-F5 (optional): the manifest schema and types still allow platform
  values, signing and mode `0755` that validation now refuses. The platform
  check is unreachable.
- P5-R1-F6: the debug panel's processing-off note is English-only. The file
  is exempt from i18n, but the panel renders in production.
- P5-R1-F7: follow-ups for part 2 (the packaging README and the now-uncalled
  worker spec and resources) and Phase 6 (`releases.md` and
  `runtime-staging.md`). The next signed release needs new reviews. The
  default stack's `./cache/docling` folder can be deleted.

Verified with no defect: the supervisor lifecycle, the expanded-pack
validation and digests, the macOS and Windows release policies, the smoke
checks, workflow references and concurrency, `reset.sh` on existing stacks,
and the i18n wording.

#### Code Review #1 Revisions (part 1)

- F3 fixed: the keyword is removed. The part-2 review rechecks it.
- F1 and F2 move to part 2, which removes the stale entries and the
  `.env.example` key with the backend ones.
- F4 accepted for part 2.
- F5 declined: the manifest format stays stable for existing
  expanded-pack manifests, as the comment in `catalog.ts` documents.
- F6 goes to the owner, alongside the existing English-only debug panel note.
- F7 is split between part 2, Phase 6 and the PR's remaining gates.

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
   `size-budgets.json`. Run no other checks while it packs. The app's
   backend log must not contain the "token counts are estimated" warning, so
   that counting uses the bundled tokenizer file (P3-R1-F5). Desktop Quick
   Chat shows the hold and keeps its draft, which was deferred from Phase 4.
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

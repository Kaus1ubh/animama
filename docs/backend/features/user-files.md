# User Files

User files are installation-owned uploaded documents. They are stored separately from
anima archives and the memory filesystem. The upload API supports
upload, processing, listing, deletion, and debug retrieval validation. Uploaded
files can be attached to direct chat turns by backend file ID after upload
initialization. Processed attached chunks are available to direct chat through
`search_uploaded_files` for relevance retrieval and
`read_uploaded_file_chunks` for bounded ordered reading. When those tools are
available, the prompt includes a request-local
`# List of attached user-uploaded files` section with each validated filename
and persisted chunk count, plus any safe processing overview available for the
current turn. The count helps the model plan bounded sequential reads without
exposing opaque backend file IDs, which remain outside model-facing prompts and
tool results.

## Current Surfaces

Backend API:

- `POST /v1/files/uploads`
- `POST /v1/files/{file_id}:finalize`
- `POST /v1/files/{file_id}:process`
- `POST /v1/files/debug/search`
- `POST /v1/memory/debug/search-memory-files`
- `GET /v1/files`
- `GET /v1/files/{file_id}`
- `DELETE /v1/files/{file_id}`
- `DELETE /v1/files/uploads/{file_id}`
- `GET /v1/runtime-capabilities`

Frontend UI:

- Chat composer paperclip button opens an attachment popover with **Upload from
  computer** first and a searchable list of the current user's existing
  `ready`/`ready_keyword_only` files below it. New-upload IDs and selected
  existing IDs are merged into `attached_file_ids` for the next `chat:sse`
  request.
- `/a/library?section=chat-uploads` shows private upload status,
  processing status, selected delete controls, process/reprocess actions, and
  debug search.

Worker:

- `animama.workers.user_file_processing`
- The checked-in Compose `animama-file-worker` service is commented out. Start
  parsing only after deliberately configuring that private service or host worker.
- Embedded desktop supervises the separate signed document pack; core does not
  include Docling/Torch or silently start a replacement parser.

## Optional Processing Capability

The owner-protected capability API separates pack availability (`enabled`) from
worker liveness (`disabled`, `starting`, `ready`, `stale`). The document worker
writes a heartbeat every five seconds. Twenty seconds without a matching
heartbeat is stale, but enabled work can still queue durably. A disabled pack
causes the service to reject process requests with 409 and
`{"detail":{"code":"file_processing_unavailable"}}` before file lookup or
job creation. Upload initialization, bytes, and finalization remain available.

The frontend preserves the saved original and offers installation instead of
showing a failed processing job. Existing indexed chunks remain searchable.
Pack removal is blocked by live running leases; queued rows survive and resume
after reinstallation. Heartbeat renewal extends only the worker's own running
jobs, and shutdown prevents new claims. Desktop model weights and tokenizer
resources are packaged and loaded offline; no runtime Docling download is used.

In desktop, private originals live below the supervisor's `ANIMAMA_DATA_ROOT`
inside `~/Library/Application Support/Animama/data`, not in app resources or the
document pack. Removing/replacing a pack is not file deletion. No signed worker
release is approved yet; fixture/core checks are not production conversion
acceptance. See [Desktop operations](../operations/desktop-runtime.md) for helper
verification and backups, and [Feature packs](../../frontend/desktop/feature-packs.md)
for the user-facing flow.

## Supported Files

Allowed extensions:

- text and markup: `.txt`, `.md`, `.rst`, `.org`, `.json`, `.html`, `.htm`,
  `.xml`
- tabular text: `.csv`, `.tsv`
- rich documents: `.pdf`, `.docx`, `.pptx`, `.xlsx`

The upload API rejects extensions outside the allowlist. Macro-enabled Office
files such as `.docm`, `.xlsm`, and `.pptm` remain blocked, along with
executables, scripts, installers, and archive formats.

Upload size defaults to `25 MiB` through `ANIMAMA_USER_FILE_MAX_UPLOAD_BYTES`.
Processing size defaults to `10 MiB` through `ANIMAMA_USER_FILE_MAX_PROCESS_BYTES`.

## Step-By-Step Upload And Processing Walkthrough

This is the normal browser path when a user uploads a file from the chat
composer or `/a/library?section=chat-uploads`. Library's Chat Uploads tab observes the
same inventory and links to the memory Uploads manager; it does not own another
upload pipeline.

1. The user picks one or more files.

   The frontend uses Uppy. Uppy enforces the browser-side allowlist and size
   limit before it attempts an upload. The chat composer and memory/upload
   surfaces use the same upload hook, so both entry points follow the same
   backend lifecycle.

2. The frontend initializes the upload.

   For each selected file, the browser calls:

   ```http
   POST /v1/files/uploads
   ```

   The request includes the original filename, browser content type, and byte
   size. The backend authenticates the user and validates the filename,
   extension, declared size, and content type string.

3. The backend creates a pending file row.

   The backend generates a new `file-...` ID and private locator. Clients do
   not provide private locators. The generated locator is scoped under:

   ```text
   user-files/{user_id}/{file_id}/original
   ```

   The backend stores a `user_file` row with status `pending_upload`, the
   installation principal in `user_id`, the generated locator, the display filename,
   declared content type, declared byte size, and an upload expiry timestamp.

4. The backend returns an authenticated local upload target.

   The response contains the file ID, `PUT` method, API-relative
   `/v1/files/{file_id}/content` URL, required headers, and expiry time.

5. The browser uploads bytes through FastAPI.

   Uppy resolves the URL against the same application origin without a bearer token.
   FastAPI enforces declared/configured bounds, streams through a disk-backed
   spool under `data/staging/uploads`, and atomically promotes the file to
   `data/user-files/<user>/<file>/original`.

6. The frontend finalizes the upload.

   After Uppy reports object upload success, the frontend calls:

   ```http
   POST /v1/files/{file_id}:finalize
   ```

   Finalization remains separate so the backend can verify the promoted local
   file before treating the row as durable.

7. The backend verifies the object and marks it uploaded.

   Finalize reloads the current user's row, checks that the generated locator
   still belongs under that user's prefix, stats the exact local file through
   the private storage adapter, verifies existence and size, and confirms the
   row is still pending. On success the file status becomes `uploaded`.

8. The frontend enqueues processing.

   When fresh runtime capabilities allow it, the upload hook enqueues processing
   after finalization by calling:

   ```http
   POST /v1/files/{file_id}:process
   ```

   The `/a/library?section=chat-uploads` page can also process or reprocess a file
   manually. A normal process request reuses an existing queued or running job.
   If the file is already `ready` or `ready_keyword_only`, a non-forced request
   returns the current state without duplicating work. Reprocess actions send
   `force=true`.

9. The backend stores a durable processing job.

   The API request does not parse the file. It creates a
   `user_file_processing_job` row with status `queued`, marks the file
   `processing`, commits, and returns `202 Accepted` with the job ID and current
   statuses.

10. The file worker claims the job.

    The `animama-file-worker` process polls Postgres. It leases work with
    `FOR UPDATE SKIP LOCKED`, marks a job `running`, records `locked_by` and
    `locked_at`, increments attempts, and commits. If a worker exits while a job
    is running, another worker can reclaim the job after the lease expires.

11. The worker opens and validates the local file.

    The worker opens the backend-owned local locator through a private storage
    port with the expected exact size. It rejects missing, changed, empty, or
    oversized payloads. Rich formats receive
    lightweight header checks before parsing: PDFs must begin with `%PDF-`, and
    DOCX/PPTX/XLSX files must look like ZIP containers.

12. The worker computes and checks a content digest.

    After validation, the worker computes SHA-256 from the downloaded bytes. A
    non-forced job looks for another current-user file with the same digest,
    normalized extension, `ready` or `ready_keyword_only` status, and at least
    one chunk. When it finds one, it atomically clones that file's chunks and
    embeddings into independent chunk rows for the new file, copies its
    overview and processing result, stores the digest, completes the job, and
    skips parsing and embedding. It never reuses a foreign-user file. A
    `force=true` job always performs fresh processing.

13. The worker parses and chunks the file when content was not reused.

    Simple formats `.txt`, `.rst`, `.org`, `.json`, `.tsv`, and `.xml` use
    stdlib parsing. Markdown, CSV, HTML, PDF, DOCX, PPTX, and XLSX use Docling's
    Python API through the full `docling` dependency installed in the worker
    image. The worker routes PyTorch dependencies to CPU-only wheels through
    uv's explicit `pytorch-cpu` index, so the image does not include CUDA
    runtime packages. Docling exports Markdown for fallback/debug metadata, then
    tries Docling Core's `HybridChunker` for structure-aware chunks.

    `HybridChunker` uses Docling's document hierarchy plus an OpenAI/tiktoken
    tokenizer. Chunk sizing defaults to `800` tokens through
    `ANIMAMA_USER_FILE_CHUNK_MAX_TOKENS`. The tokenizer model defaults to
    `ANIMAMA_USER_FILE_CHUNK_TOKENIZER_MODEL`, then `ANIMAMA_EMBEDDING_MODEL`,
    then `text-embedding-3-small`. If tiktoken cannot resolve the configured
    model, the worker falls back to the `cl100k_base` encoding. The local
    Compose worker defaults to four CPUs and four GiB of memory, and Docling
    table recognition defaults to `fast` mode to reduce CPU processing time.

    The worker warms Docling's PDF pipeline at startup by default. Warm-up moves
    pipeline/model initialization out of the first user-file job, but the worker
    will not claim queued jobs until warm-up finishes or logs a warning.

    For Docling chunks, Anima stores display text in `user_file_chunk.text`
    but embeds Docling's contextualized text, which includes useful heading and
    caption context. That contextualized embedding text is transient and is not
    persisted in a column or metadata.

    PDF OCR is disabled by default. Scanned PDFs may fail or produce little text
    until OCR is explicitly enabled with `ANIMAMA_USER_FILE_DOCLING_ENABLE_OCR`.
    Encrypted or password-protected documents are rejected with a processing
    error.

14. The worker falls back to deterministic text chunking when needed.

    If Docling chunking fails or returns no chunks, the parser records a warning
    in parser metadata and the service falls back to Markdown character-window
    chunking. Simple stdlib formats always use the deterministic fallback
    chunker. Prose chunks target about 2,500 characters with about 250
    characters of overlap. Table-only stdlib TSV output is chunked by Markdown
    table row groups.

15. The worker embeds chunks when possible.

    If an embedder is configured, the worker embeds parser-provided
    contextualized text when available, otherwise the stored chunk text. It then
    stores pgvector embeddings. If embedding is unavailable or fails, the worker
    keeps the chunks for keyword search and records a warning instead of
    discarding the upload.

16. The worker replaces chunks and completes the job.

    Reprocessing is idempotent: existing chunks for that file are replaced in
    one success path, then deterministic replacement chunks are written. On
    success the job becomes `succeeded`, the file receives `processed_at` and
    the verified SHA-256 digest in `user_file.sha256`, and the file status
    becomes:
    - `ready` when chunks and embeddings were stored.
    - `ready_keyword_only` when chunks were stored but embeddings were not.

17. Failures are retried or surfaced.

    Processing failures store a concise `last_error`. Jobs retry with bounded
    attempts and backoff. After the configured max attempts, the job becomes
    `failed` and the file status becomes `failed`.

18. The frontend observes status through polling.

    The memory Uploads surface polls `GET /v1/files` while any file is
    `pending_upload`, `uploaded`, `processing`, or has a queued/running latest
    job. The response includes file metadata, chunk count, latest processing job
    summary, and any visible error.

19. The user can debug search processed chunks.

    The memory Uploads surface calls:

    ```http
    POST /v1/files/debug/search
    ```

    Search runs only over current-user chunks. Selecting files in the table
    scopes search to those file IDs.

Content reuse deliberately copies rather than aliases processed rows. The two
uploads remain independent for attachment, deletion, and force-reprocessing.
The target file keeps unrelated metadata; copied operational metadata records
`content_reused: true` but does not expose the source file ID. Existing rows
with `sha256 = null` are not backfilled automatically. If two identical uploads
are processed concurrently before either becomes ready, both may do full work;
later duplicates can reuse either completed result.

## Statuses

File statuses:

- `pending_upload`: metadata row exists but its local file is not finalized.
- `uploaded`: the promoted local file exists and passed finalize checks.
- `processing`: at least one processing job has been enqueued.
- `ready`: chunks and embeddings are available.
- `ready_keyword_only`: chunks are available, but embeddings were unavailable or
  failed.
- `failed`: upload finalization or processing failed.
- `aborted`: pending upload was canceled.
- `delete_pending`: object cleanup failed; normal list/search should hide or
  ignore the row as appropriate.
- `deleted`: tombstoned row, hidden from normal list APIs.

Processing job statuses:

- `queued`
- `running`
- `succeeded`
- `failed`
- `canceled`

Frontend tracks transient Uppy metadata stages: `preparing`, `initializing`, `uploading`, `finalizing`, `queued`, `processing`, `failed`. These fill UI gaps before backend polling returns an authoritative file status.

## Chunking

Chunking turns one parsed file into smaller searchable rows in
`user_file_chunk`. Each chunk has a stable `chunk_index`, extracted text,
character count, estimated token count, optional embedding, and parser/source
metadata. Reprocessing deletes existing chunks for the file and writes a new
deterministic chunk set before marking the job succeeded.

Docling-parsed formats use Docling Core's `HybridChunker`:

- Supported Docling formats are `.md`, `.csv`, `.html`, `.htm`, `.pdf`,
  `.docx`, `.pptx`, and `.xlsx`.
- `HybridChunker` starts from Docling's document hierarchy, splits chunks that
  exceed the configured token budget, and merges compatible neighboring chunks
  when `merge_peers` allows it.
- Anima stores display text in chunk rows and embeds Docling's contextualized
  text. Contextualized text is transient and is not exposed through public APIs.
- Hybrid chunk metadata is compacted to stable keys: `parser`, `chunker`,
  `headings`, `captions`, `origin`, `doc_items`, `doc_item_count`, and
  `token_count`. Bulky Docling document items are truncated in metadata while
  `doc_item_count` preserves the original item count.

Simple formats and Docling fallback use the deterministic character/table
chunker:

- Prose chunks target about 2,500 characters.
- Neighboring prose chunks overlap by about 250 characters.
- The splitter prefers paragraph boundaries, then line boundaries, before
  falling back to the character window.
- Table-only stdlib TSV output is chunked by Markdown table row groups so the
  table header stays with each group.

This fallback strategy is predictable and dependency-light, and it keeps simple
text formats out of Docling.

## Processing Overviews

Newly processed and force-reprocessed files receive deterministic navigation
metadata at `user_file.metadata.overview`. The version 1 object contains a
bounded `description`, ordered `outline` entries with heading levels, an
extraction `method`, and an `outline_truncated` flag. Operational parser,
embedding, warning, and chunk-count details remain under
`user_file.metadata.processing`.

Rich files use Docling's native title and section tree while the converted
document is available, with exported Markdown headings as a fallback. JSON,
XML, and table-only files use format-specific structural summaries. Plain text
without recognized structure receives an extractive description and an empty
outline rather than fabricated sections. Overview extraction is local and
deterministic: it does not call a model provider, and a safe fallback prevents
overview failures from failing an otherwise searchable processing job.

Existing ready files are not backfilled automatically. Reprocess with
`force=true` to replace their chunks and generate the current overview version.
The overview is processing metadata for later source selection; search results,
not the overview alone, remain the evidence for document-content answers.

## Search And Retrieval

`POST /v1/files/debug/search` accepts:

- `query`: required search text.
- `limit`: 1 to 50, default 10.
- `file_ids`: optional current-user file filter.
- `mode`: `keyword`, `semantic`, or `hybrid`.

Search modes:

- `keyword`: PostgreSQL full-text search over chunk text.
- `semantic`: embed the query and search pgvector chunk embeddings.
- `hybrid`: run keyword search plus semantic search, then combine ranks with
  reciprocal rank fusion. If semantic search is unavailable in hybrid mode, the
  API returns keyword results with a warning.

Results include file ID, original filename, extension, chunk ID, chunk index,
score, match type, chunk text, and chunk metadata. Original object keys and
download URLs are not exposed.

`POST /v1/memory/debug/search-memory-files` is the smaller read-only debug route
for the direct-chat `search_memory_files` tool path. It accepts only `query` and
returns `memory_results` for user-scope markdown memory entries. Uploaded-file
debugging remains under `POST /v1/files/debug/search`, which can be scoped with
`file_ids` and run in `hybrid` mode to exercise the same retrieval machinery
used by `search_uploaded_files`.

Keyword search uses PostgreSQL full-text search. PostgreSQL turns chunk text
into a `tsvector`: normalized searchable lexemes produced by dictionaries such
as the English stemmer and stop-word filter. It turns the user's query into a
`tsquery` with `websearch_to_tsquery`, which accepts familiar web-search syntax.
Rows match when the text vector satisfies the query, and Anima ranks matches
with `ts_rank_cd`, PostgreSQL's cover-density rank function. Cover-density
ranking rewards matches where query terms appear close together.

This is not BM25. BM25 is a probabilistic relevance formula used by systems
such as Lucene/OpenSearch/Elasticsearch. It combines term frequency saturation,
inverse document frequency, and document-length normalization. PostgreSQL FTS is
excellent as a built-in, transactional keyword index and works well for MVP
debug retrieval, but BM25 usually gives stronger and more tunable ranking for
large search corpora. If keyword relevance becomes a product requirement,
Anima could add a BM25-backed engine such as ParadeDB or a dedicated search
service later.

Semantic search embeds the query with the configured embedding provider, then
uses pgvector cosine distance against stored chunk embeddings. The SQL orders by
nearest vector first with `<=>` and reports score as `1 - distance`. Chunks
without embeddings are skipped. Files that processed without embeddings remain
searchable by keyword and show status `ready_keyword_only`.

Hybrid search asks both retrievers for a wider candidate set, then combines
their ranks with reciprocal rank fusion. For each ranked list, result rank `r`
contributes `1 / (60 + r)` to that chunk's fused score. A chunk returned by both
keyword and semantic search receives both contributions, so agreement between
retrievers is rewarded. Final results sort by fused score descending, then by
file ID and chunk index for deterministic tie-breaking.

Direct chat also exposes `read_uploaded_file_chunks` for attached files that
passed the same request-local ownership, searchable-status, and non-empty-chunk
validation as uploaded-file search. The tool requires one exact filename, a
zero-based starting chunk index, and a chunk count from 1 through 5. Filename
matching is case-insensitive; an unknown name returns an error and never
broadens into reading every attachment. Same-named attachments are returned as
separate groups in request attachment order.

The reader returns complete stored chunks in source order with explicit
`next_start_chunk` and `has_more` pagination. One serialized result is bounded
to 24,000 characters and reports response truncation rather than splitting
chunk text. Results contain only the canonical filename, chunk index, chunk
text, and pagination fields—never internal file/chunk IDs, embeddings, parser
metadata, object keys, or storage URLs. The Anima should use search for
relevance, exact phrases, and locating a chunk; it should use bounded reads for
whole-document synthesis, sequential sections, or surrounding context.

## Local Worker

Run the worker directly:

```bash
uv run --extra file-worker python -m animama.workers.user_file_processing
```

Run the local Compose stack with the worker:

```bash
./reset.sh
```

For named stacks:

```bash
./reset.sh --name abc --base-port 8200
docker compose -p animama-abc logs -f animama-file-worker animama-server
```

The backend Dockerfile has separate final targets. The `animama-server` image
intentionally omits Docling/parser dependencies, while the
`animama-file-worker` image installs the full `docling` package backed by
CPU-only PyTorch wheels. The worker service exposes no host ports, depends on
healthy Postgres, mounts a Docling cache volume, drops Linux capabilities, uses
`no-new-privileges`, and runs with CPU, memory, pids, and tmpfs limits.

Plain `./reset.sh` does not automatically rebuild images after dependency
changes. Rebuild explicitly when needed:

```bash
docker compose build animama-file-worker
./reset.sh --build animama-file-worker
```

## Configuration

Storage:

- `ANIMAMA_DATA_ROOT` supplies the private data root. Compose mounts it at
  `/var/lib/animama/data`.
- Originals live below `data/user-files`; request spools live below
  `data/staging/uploads`.
- No R2/S3/MinIO endpoint, bucket, or credentials are required.

Limits:

- `ANIMAMA_USER_FILE_MAX_UPLOAD_BYTES`: upload declaration limit. Defaults to
  `25 MiB`.
- `ANIMAMA_USER_FILE_MAX_PROCESS_BYTES`: worker payload limit. Defaults to
  `10 MiB`.

Worker loop:

- `ANIMAMA_USER_FILE_WORKER_ID`: optional explicit worker ID.
- `ANIMAMA_USER_FILE_PROCESSING_POLL_SECONDS`: poll interval. Defaults to `2`.
- `ANIMAMA_USER_FILE_PROCESSING_BATCH_SIZE`: jobs claimed per poll. Defaults to
  `1`.
- `ANIMAMA_USER_FILE_PROCESSING_LEASE_SECONDS`: running-job lease. Defaults to
  `300`.
- `ANIMAMA_USER_FILE_PROCESSING_MAX_ATTEMPTS`: retry limit. Defaults to `3`.

Docling:

- `ANIMAMA_USER_FILE_DOCLING_TIMEOUT_SECONDS`: conversion timeout. Defaults to
  `120`.
- `ANIMAMA_USER_FILE_DOCLING_ENABLE_OCR`: PDF OCR flag. Defaults to `false`.
- `ANIMAMA_USER_FILE_DOCLING_DO_TABLE_STRUCTURE`: table extraction flag.
  Defaults to `true`.
- `ANIMAMA_USER_FILE_DOCLING_ACCELERATOR`: Docling accelerator. Defaults to
  `cpu`.
- `ANIMAMA_USER_FILE_DOCLING_NUM_THREADS`: Docling CPU inference threads.
  Defaults to `4`.
- `ANIMAMA_USER_FILE_DOCLING_TABLE_MODE`: table extraction mode, `fast` or
  `accurate`. Defaults to `fast`.
- `ANIMAMA_USER_FILE_DOCLING_WARMUP`: warm Docling's PDF pipeline when the
  worker starts. Defaults to `true`.
- `ANIMAMA_USER_FILE_CHUNK_MAX_TOKENS`: Docling `HybridChunker` token budget.
  Defaults to `800`.
- `ANIMAMA_USER_FILE_CHUNK_TOKENIZER_MODEL`: OpenAI/tiktoken model name for
  `HybridChunker` sizing. Defaults to `ANIMAMA_EMBEDDING_MODEL`, then
  `text-embedding-3-small`.

Compose worker resources:

- `ANIMAMA_FILE_WORKER_CPUS`: CPU quota for the `animama-file-worker` service.
  Defaults to `4.0`.
- `ANIMAMA_FILE_WORKER_MEMORY`: memory limit for the `animama-file-worker`
  service. Defaults to `4g`.

## Data Model And Ownership

`ORMUserFile` stores the original upload metadata. It is scoped by the generated
installation principal in `user_id` and uses backend-generated object keys. `ORMUserFileProcessingJob`
stores durable processing work and lease metadata. `ORMUserFileChunk` stores
searchable extracted chunks and denormalizes `user_id` for ownership filters.

Current APIs always filter file, job, and chunk access by the admitted installation
request principal. One installation cannot list, finalize, process, search, or
delete another owner's files. Original locators are not accepted from clients and are
not returned by the public APIs.

The original-file, chunk, job and optional-worker heartbeat tables are part of
the accountless `baseline_20260908` baseline. A database stamped with a removed
revision needs the explicit development reset boundary described in
[Database operations](../operations/development.md#database); ordinary worker
restarts preserve ownership, uploads and queued jobs.

## Deletion And Recovery

Deleting a file is best-effort for local private storage and durable for
search. The API attempts to delete the local file, tombstones the row as
`deleted` when deletion succeeds, marks it `delete_pending` when filesystem
cleanup fails,
and deletes stored chunks so debug search no longer returns them.

Pending uploads can be aborted with `DELETE /v1/files/uploads/{file_id}`. If the
browser PUT fails, the pending row remains until abort or expiry cleanup is
added later.

Processing enqueue is idempotent. Worker leases are recoverable after lease
expiration. Reprocessing with `force=true` replaces chunks idempotently.

## Non-Goals

This MVP does not:

- expose original file download URLs
- attach uploads to chat turns
- let chat requests target specific uploads by file ID
- let agents read original object bytes
- enable OCR by default
- support encrypted/password-protected documents
- support macro-enabled Office files

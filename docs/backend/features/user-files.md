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
tool results. A model without tool calling receives neither the tools nor the
list, so its turns cannot search or read attachments; the chat composer says
so.

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
- `/library?section=chat-uploads` shows private upload status,
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

Chat and Library use the same upload lifecycle:

1. Uppy checks the browser allowlist and size, then calls
   `POST /v1/files/uploads` with filename, content type, and declared size.
   The backend validates these fields and creates an owned `pending_upload`
   row with expiry and a private `user-files/{user_id}/{file_id}/original`
   locator.
2. The response supplies the file ID, API-relative PUT target, required headers,
   and expiry. The browser uploads to `/v1/files/{file_id}/content` at the same
   origin. FastAPI bounds the stream, spools under `data/staging/uploads`, and
   atomically promotes the bytes to the private locator.
3. `POST /v1/files/{file_id}:finalize` rechecks ownership, pending status,
   containment, existence, and exact size before marking the file `uploaded`.
   Successful byte transfer alone does not finalize an upload.
4. When fresh capabilities allow processing, the client calls
   `POST /v1/files/{file_id}:process`. This creates a durable queued job and
   returns `202`; parsing never runs in the API request. Normal requests reuse
   queued/running work or an already-ready result. `force=true` reprocesses it.
5. The worker claims jobs with `FOR UPDATE SKIP LOCKED`, records its lease and
   attempt, and verifies the original's size and format. Missing, changed, empty,
   or oversized originals fail; PDFs require `%PDF-` and Office documents must
   be ZIP containers. Expired leases can be reclaimed after a worker exits.
6. Before parsing, a non-forced job may reuse an owned ready file with the same
   SHA-256, normalized extension, and at least one chunk. It copies chunks,
   overview, and processing results into independent rows, and copies vectors
   only when they come from the owner's current embeddings model. Otherwise it
   parses and [chunks](#chunking) the document, then embeds it when the
   [embeddings role](#embeddings-role) is on. Embedding failure retains
   keyword-searchable chunks with a warning.
7. Successful processing replaces chunks, stores the digest and timestamp, and
   marks the job `succeeded`. The file becomes `ready`, or `ready_keyword_only`
   when embedding failed. Failures record `last_error` and retry
   with bounded backoff; exhausted jobs and files become `failed`. The client
   polls `GET /v1/files` for authoritative status and processing summaries.

Reused uploads remain independent for attachment, deletion, and forced
reprocessing. `content_reused: true` records reuse without exposing the source
file ID. Existing null digests are not backfilled; simultaneous duplicate
uploads may both process before either result is ready.

By default, the worker warms Docling's PDF pipeline before claiming jobs. Warm-up failures
log a warning. Tokenization uses the configured model, falling back to
`cl100k_base` when tiktoken cannot resolve it. Scanned PDFs need explicit OCR;
encrypted/password-protected documents fail processing.

## Embeddings role

Vectors come from the owner's embeddings model role: an App Settings
assignment (`models.embedding_model_provider_id`), else
`ANIMAMA_DEFAULT_EMBEDDING_MODEL_PROVIDER_ID`. Embeddings are off until one is
chosen; files are still processed and searched by keyword. Any row of kind
`embedding` works, including the built-in `OpenAIHTTPAgent:text-embedding-3-small`
and local models served through a connection's `/v1/embeddings`.

Each chunk records the catalog row id of the model that produced its vector
(`embedding_model_id`) and the contextualized text that was embedded
(`embedding_text`, when it differs from the display text). Search compares only
vectors from the current model. After the role changes, an in-process task
started by the local application re-embeds chunks and archive passages in
batches, resting when nothing is stale, waking when settings change and backing
off after failures. Text the model cannot embed (too long, blank, refused
while the rest of the batch succeeds, or refused on its own three times) is
recorded without a vector so it cannot stall the rest. Until the third
rejection the batch fails and the role reports `retrying`; the count
(`embedding_rejections`) belongs to the rejecting model and the current text,
and restarts for another model or edited text. A rejection counts only when the
model then embeds a fixed check text containing no owner content, so a
misconfigured or failing model that refuses everything keeps retrying instead
of dropping vectors. `GET /v1/model-roles` reports progress under
`embeddings_refresh`, including the category of a failing batch.

## Statuses

File statuses:

- `pending_upload`: metadata row exists but its local file is not finalized.
- `uploaded`: the promoted local file exists and passed finalize checks.
- `processing`: at least one processing job has been enqueued.
- `ready`: chunks are available, with vectors when embeddings are on.
- `ready_keyword_only`: chunks are available, but embedding failed. Re-embedding
  marks the file `ready` once every chunk has a vector.
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
  text, kept in `embedding_text` so re-embedding matches. Contextualized text is
  not exposed through public APIs.
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
- `semantic`: embed the query and search pgvector chunk embeddings. Returns
  `503` while embeddings are off.
- `hybrid`: run keyword search plus semantic search, then combine ranks with
  reciprocal rank fusion. While embeddings are off or the searched files wait
  for re-embedding, hybrid search returns keyword results only; a failed query
  embedding returns keyword results with a warning.

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

The `english` parser keeps unspaced Japanese, Chinese and Thai text as one
lexeme. So besides the whole query's full-text match, a chunk also matches when
it contains every query word or quoted phrase with a non-ASCII letter or digit
as a case-insensitive substring and its other words match
([memory search](memory.md#search_memory_files) has the matching rules). A
`-term` of that kind excludes chunks containing it. `OR` beside a non-ASCII word
works only through the full-text match, and chunks that match only by substring
rank with a score of 0. The `search_uploaded_files` description asks the model to
separate words with spaces in Japanese, Chinese or Thai too.

Semantic search embeds the query with the embeddings-role model, then uses
pgvector cosine distance against stored chunk embeddings from that same model.
The SQL orders by nearest vector first with `<=>` and reports score as
`1 - distance`. Chunks without a current vector are skipped.

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
to about 6,000 estimated tokens (24,000 English characters) and reports response truncation rather than splitting
chunk text. Results contain only the canonical filename, chunk index, chunk
text, and pagination fields—never internal file/chunk IDs, embeddings, parser
metadata, object keys, or storage URLs. The Anima should use search for
relevance, exact phrases, and locating a chunk; it should use bounded reads for
whole-document synthesis, sequential sections, or surrounding context.

## Local Worker

Run a host worker with the same database and private storage configuration as
the backend:

```bash
uv run --no-dev --extra file-worker python -m animama.workers.user_file_processing
```

The Compose worker service is commented out. Configure it explicitly before
starting or rebuilding it; see
[optional document worker setup](../operations/development.md#optional-document-worker).
The `animama-server` image excludes parser dependencies; the separate
`animama-file-worker` target installs Docling with CPU-only PyTorch.

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
  `HybridChunker` sizing. Defaults to `text-embedding-3-small`; it only sizes
  chunks and is independent of the embeddings model.

Compose worker resources:

- `ANIMAMA_FILE_WORKER_CPUS`: CPU quota for the `animama-file-worker` service.
  Defaults to `2.0`.
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

## Known Limitations

- Stored vectors are keyed by catalog row ID. Pointing an embeddings
  connection at another server keeps the row ID, so existing vectors still
  count as current: search compares them with the new server's vectors, and a
  dimension mismatch fails semantic search. To re-embed, switch the Embeddings
  role to a different model row, for example one added on a new connection.

## Non-Goals

The API does not expose original download URLs or let agents read original
bytes. OCR is opt-in; encrypted/password-protected documents and macro-enabled
Office files are unsupported.

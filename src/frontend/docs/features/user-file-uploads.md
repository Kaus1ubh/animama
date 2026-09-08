# User File Uploads

The web app exposes the backend user-file MVP through a shared Uppy upload flow
and Library's private Chat Uploads section. Uploaded files are installation-owned
and can be attached to the next chat request by backend file ID once upload
initialization succeeds.

## User Surfaces

- Chat composer: the paperclip button opens an attachment popover. Its first
  row, **Upload from computer**, opens the browser file picker. Below that row,
  users can search and select installation uploads that are already `ready` or
  `ready_keyword_only` and have chunks. New uploads and selected existing files
  appear as compact cards above the text row. Their backend `file_id` values are
  merged and sent as `attached_file_ids` with the next `chat:sse` request.
  On main chat routes, users can also drag files anywhere over the page and
  drop them to add those files to the same composer upload tray.
- `/a/library?section=chat-uploads`: lists uploaded files, shows file and
  processing status, supports upload, selected deletion, process/reprocess
  actions, and debug search.

Both surfaces use `src/frontend/web/src/hooks/useUserFileUpload.ts` for new
browser files, so private local upload, finalize, and processing enqueue
behavior stay consistent. Selecting a previously uploaded file does not add it
to Uppy or repeat any upload lifecycle request; composer state holds its
existing backend ID directly.

## Upload Flow

1. The user selects files with Uppy or drops files onto the main chat page.
2. Uppy applies browser-side restrictions from
   `src/frontend/web/src/lib/user-files/uploads.ts`.
3. Uppy's existing generic PUT transport callback calls
   `POST /v1/files/uploads` through `useInitUserFileUpload`.
4. The backend returns an Animama `file_id`, private API-relative
   `PUT` URL, method, and required headers.
5. Uppy PUTs the original file through FastAPI, which streams it into local
   private storage.
6. On `upload-success`, `useUserFileUpload` calls
   `POST /v1/files/{file_id}:finalize`.
7. The hook reads fresh `GET /v1/runtime-capabilities` metadata. It calls
   `POST /v1/files/{file_id}:process` only when processing is enabled.
8. The hook invalidates user-file queries through the finalize/process
   mutations and shows toast feedback.

The chat composer keeps new-upload and existing-file cards visible until the
user removes them locally or leaves the chat surface. Removing a new upload
card removes it from local Uppy state; removing a previously uploaded card
removes its ID from local composer selection state. Neither action deletes the
installation-owned backend file. Cards combine transient Uppy metadata for
browser-side stages with `useUserFiles({ pollActive: true })` status when the
backend file row is known. Library's Chat Uploads management panel keeps its
Dashboard modal behavior and adds compact upload progress visibility.

## Optional Desktop Processing

Embedded desktop stores and finalizes originals without the document pack.
Those files stay `uploaded`/Original saved, rather than displaying a failed
processing job or polling forever. The Library explains that extraction/search
needs the pack and offers the same main-window Install controls as Settings.
Already indexed files remain searchable. The hook also preserves the successful
upload if a later capability or enqueue request fails.

`useRuntimeCapabilities` reads the owner-protected capability endpoint. An
absent pack has `enabled: false`; disabled processing cannot enqueue even from
a stale renderer (`409`, `detail.code: file_processing_unavailable`). An installed
pack can be `starting`, `ready`, or `stale`: starting/stale workers may accept
durable queued work, and the Library shows that liveness separately. Removal
waits for running jobs; originals and queued jobs survive it. Self-hosted web
uses the same capability response but has no desktop Install bridge.

## Backend Lifecycle Details

The frontend upload hook hides most of the backend lifecycle from UI components,
but the lifecycle has three distinct backend operations: init, finalize, and
process. The processing endpoint only queues work; a separate worker performs
the expensive parsing and chunking.

### Init: `POST /v1/files/uploads`

Frontend caller:

- `useInitUserFileUpload`
- invoked from Uppy's `AwsS3.getUploadParameters(...)` callback in
  `useUserFileUpload`

Request body:

```json
{
  "filename": "notes.pdf",
  "content_type": "application/pdf",
  "size_bytes": 12345
}
```

What the backend does:

1. Resolves the gateway-authenticated installation principal.
2. Validates the original filename:
   - trims path-like input down to the display basename
   - rejects empty, control-character, and over-255-character names
   - lowercases and checks the extension against the backend allowlist
   - rejects explicitly blocked executable, archive, script, and macro-enabled
     Office extensions
3. Validates the declared size:
   - must be positive
   - must be at or below `ANIMAMA_USER_FILE_MAX_UPLOAD_BYTES`
4. Validates the declared content type string:
   - defaults blank values to `application/octet-stream`
   - rejects newline/control injection and overlong values
5. Generates a new opaque `file-...` ID.
6. Generates the private locator itself. The browser never supplies it. The
   locator has this shape:

   ```text
   user-files/{user_id}/{file_id}/original
   ```

7. Creates a `user_file` row with status `pending_upload`, the installation
   principal in `user_id`, generated object key, display filename, normalized extension,
   declared content type, declared size, and upload expiry timestamp.
8. Returns the owner-scoped `/v1/files/{file_id}/content` PUT route.

Response:

```json
{
  "file_id": "file-...",
  "upload_url": "/v1/files/file-.../content",
  "method": "PUT",
  "headers": {
    "Content-Type": "application/pdf"
  },
  "expires_at": "..."
}
```

What the frontend does next:

- Uppy resolves the API-relative URL against the current Hono origin and uses
  `method` plus the returned content headers to upload the original bytes. It
  does not attach Authorization.
- FastAPI bounds the declared and received size, spools to disk, and atomically
  promotes the file to `data/user-files/<user>/<file>/original`.
- The returned `file_id` is stored in Uppy file metadata so upload success can
  finalize the correct row.

### Finalize: `POST /v1/files/{file_id}:finalize`

Frontend caller:

- `useFinalizeUserFileUpload`
- invoked from `useUserFileUpload` when Uppy emits `upload-success`

Request body:

```json
{}
```

What the backend does:

1. Resolves the gateway-authenticated installation principal.
2. Loads the installation owner's file row by `file_id`.
3. Rejects missing rows with `404`.
4. Rejects rows that are not `pending_upload` with `409`.
5. Rejects expired pending uploads with `410` and marks the row failed.
6. Revalidates that the stored private locator is still under the current
   user's generated prefix.
7. Stats the promoted local file through the private storage adapter.
8. Rejects missing file metadata with `409`.
9. Validates the stored file size:
    - size metadata must exist
    - size must be positive
    - size must be at or below `ANIMAMA_USER_FILE_MAX_UPLOAD_BYTES`
    - size must match the originally declared `size_bytes`
10. Sets the file status to `uploaded`, records `stored_size_bytes`, clears
    `last_error`, and commits.

Response:

- `200 OK`
- a `PyUserFileResponse` for the finalized file

Important behavior:

- Finalize proves that the browser actually uploaded the object to the generated
  location.
- Finalize is the point where a pending metadata row becomes a durable uploaded
  file.
- If validation fails after object upload, the file remains visible with failure
  state/error metadata for debugging or cleanup.

### Process Endpoint: `POST /v1/files/{file_id}:process`

Frontend callers:

- `useProcessUserFile`
- invoked automatically by `useUserFileUpload` after finalize when
  `autoProcess` is true and fresh runtime capabilities enable processing
- invoked manually by Library's Chat Uploads management panel for Process and
  Reprocess actions

Request body:

```json
{
  "force": false
}
```

What the backend endpoint does:

1. Resolves the gateway-authenticated installation principal.
2. Rejects disabled processing with `409` and
   `detail.code: file_processing_unavailable`, before file lookup or queue writes.
3. Loads the installation owner's file row.
4. Rejects missing rows with `404`.
5. Rejects `pending_upload` rows with `409` because they were not finalized.
6. Rejects statuses that are not processable.
7. If `force=false`, checks for an existing queued or running processing job for
   the file.
8. If an active job exists, returns that job instead of creating a duplicate.
9. If the file is already `ready` or `ready_keyword_only` and has chunks,
   returns the current ready state without creating a duplicate job.
10. Otherwise creates a `user_file_processing_job` row:
   - status `queued`
   - job type `process_file`
   - current user ID and file ID
   - configured max attempts
   - immediate `run_after`
   - metadata recording whether the request was forced
11. Marks the file `processing`.
12. Commits and returns `202 Accepted`.

Response:

```json
{
  "file_id": "file-...",
  "job_id": "job-...",
  "file_status": "processing",
  "job_status": "queued",
  "reused_existing_job": false
}
```

Important behavior:

- The FastAPI request does not download, parse, chunk, or embed the file.
- The endpoint is a queueing boundary so large document work stays out of the
  API process.
- Library's Chat Uploads management panel uses `force=true` for reprocessing
  files that are already `ready` or `ready_keyword_only`.

### Processing Worker: `animama.workers.user_file_processing`

Local run command:

```bash
uv run --extra file-worker python -m animama.workers.user_file_processing
```

Compose service:

- `animama-file-worker`
- currently commented out in `docker-compose.yml`; `./reset.sh` does not start it
- built from a dedicated worker image that installs full `docling` with
  CPU-only PyTorch wheels; the server image intentionally omits
  Docling/parser dependencies
- no browser route talks directly to this worker

Enabling processing in source/self-host configuration permits durable queueing;
it does not launch this process. Until an instance reports a heartbeat, the
capability endpoint reports `starting`. The embedded desktop supervisor instead
starts the separately signed worker only after its pack passes verification.

What the worker does:

1. Starts with its own SQLAlchemy async engine and session factory.
2. Creates one worker ID from `ANIMAMA_USER_FILE_WORKER_ID` or
   `{hostname}-{pid}`.
3. Initializes the Docling parser with configured timeout, OCR, table-structure,
   and accelerator settings.
4. Tries to initialize the embedding provider. If unavailable, processing still
   creates keyword-searchable chunks.
5. Polls Postgres every `ANIMAMA_USER_FILE_PROCESSING_POLL_SECONDS`.
6. Claims up to `ANIMAMA_USER_FILE_PROCESSING_BATCH_SIZE` jobs per poll.
7. Claims one job by leasing a queued or stale-running row:
   - sets job status to `running`
   - records `locked_by` and `locked_at`
   - increments attempts
   - uses the configured lease duration so another worker can recover stale work
8. Opens the exact local private file through the containment-safe storage port
   using the backend-owned locator and expected size from the file row.
9. Validates the payload:
   - object must exist
   - object must not be empty
   - payload must fit within `ANIMAMA_USER_FILE_MAX_PROCESS_BYTES`
10. Computes SHA-256 from the downloaded bytes. For a normal, non-forced job,
    the worker looks for a different current-user file with the same digest,
    normalized extension, searchable status, and stored chunks. On a match it
    clones the chunks, embeddings, overview, and processing result into the new
    file and skips parsing and embedding. A forced job always continues through
    fresh processing.
11. Parses the file:
    - `.txt`, `.rst`, `.org`, `.json`, `.tsv`, and `.xml` use lightweight
      stdlib parsing
    - `.md`, `.csv`, `.html`, `.htm`, `.pdf`, `.docx`, `.pptx`, and `.xlsx` use
      Docling
    - PDF and Office formats receive lightweight header validation before
      conversion
12. Splits parsed text into deterministic chunks:
    - prose targets about 2,500 characters with about 250 characters overlap
    - table-only content is chunked by Markdown table row groups
13. Embeds chunks when an embedder is available.
14. Replaces existing chunks for the file and writes the new chunk set.
15. Persists the verified SHA-256 digest on the file and marks the job
    `succeeded`.
16. Marks the file:
    - `ready` when chunks include embeddings
    - `ready_keyword_only` when chunks exist but embedding was unavailable or
      failed
17. Stores processing metadata such as parser name, source extension,
    embedding status, warnings, and parser metadata.

Content reuse creates independent chunk rows for the duplicate file ID, so
deleting or reprocessing one upload does not affect the other. Only the source
overview and processing metadata are copied; unrelated metadata from the new
file is preserved. Existing rows with no stored digest become reusable after a
new successful processing run or a forced reprocess. Two identical files that
are processed concurrently may both perform full work if neither is ready when
the other checks.

Failure behavior:

- Any download, parse, empty-text, size, or storage error is recorded on the job.
- The worker calculates retry backoff and requeues until max attempts are
  exhausted.
- On final failure, the job becomes `failed` and the file becomes `failed`.
- Library's Chat Uploads management panel displays the latest file/job status
  and `last_error`.

## File statuses:

Backend:

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

Frontend tracks transient Uppy metadata stages: `preparing`, `initializing`,
`uploading`, `finalizing`, `uploaded`, `queued`, `processing`, `failed`. These
fill UI gaps before backend polling returns an authoritative file status.

The card resolver (`upload-card-status.ts`, `chat-input-file-tray.tsx`) can display all frontend transient stages:

- `preparing`: very brief, after Uppy accepts the file before init starts.
- `initializing`: while calling POST /v1/files/uploads.
- `uploading`: while Uppy PUTs bytes through the bounded FastAPI route.
- `finalizing`: while calling POST /v1/files/
  {file_id}:finalize.
- `uploaded`: the original is saved and no processing job was enqueued.
- `queued`: after process enqueue returns a queued job.
- `processing`: while waiting for/reflecting processing.
- `failed`: local hook/Uppy failure before backend status wins.

## Important Boundaries

- Uploading from chat does not modify the current message text.
- Chat composer cards contribute stable backend file IDs to the next
  `chat:sse` request when available. The backend validates those IDs and equips
  `search_uploaded_files` only for current-user processed uploads with chunks.
- Removing a chat composer card is local UI cleanup, not a delete request.
- The frontend never receives or sends private filesystem paths or storage
  locators.
- The SDK exported by `@animama/runtime-contracts/sdk` is the API source for
  file requests; generated sources live in `packages/runtime-contracts/src/generated`.
  Do not hand-edit generated files.
- `useUserFiles({ pollActive: true })` polls while files are upload/processing
  active or while the latest processing job is queued/running. An idle saved
  original does not keep polling active.
- Debug search is only a retrieval validation tool. It does not change runtime
  memory.

## Key Files

- `src/frontend/web/src/hooks/useUserFileUpload.ts`: shared Uppy lifecycle hook.
- `src/frontend/web/src/lib/user-files/upload-card-status.ts`: pure resolver
  that combines Uppy/transient state with optional backend status for composer
  cards.
- `src/frontend/web/src/lib/user-files/uploads.ts`: allowed extensions, size
  limit, status helpers, and display helpers.
- `src/frontend/web/src/query/hooks/useUserFiles.ts`: file listing and active
  polling.
- `src/frontend/web/src/query/mutations/useInitUserFileUpload.ts`: upload init.
- `src/frontend/web/src/query/mutations/useFinalizeUserFileUpload.ts`:
  finalize.
- `src/frontend/web/src/query/mutations/useProcessUserFile.ts`: process and
  reprocess.
- `src/frontend/web/src/query/mutations/useDeleteUserFile.ts`: delete.
- `src/frontend/web/src/query/mutations/useDebugUserFileSearch.ts`: debug
  search.
- `src/frontend/web/src/query/mutations/useDebugSearchMemoryFiles.ts`: debug
  panel search for the `search_memory_files` tool path.
- `src/frontend/web/src/ui/components/chat-input.tsx`: composer upload button.
- `src/frontend/web/src/ui/components/chat-input-file-tray.tsx`: compact chat
  composer upload cards.
- `src/frontend/web/src/ui/library/LibraryChatUploads.tsx`: Chat Uploads
  inventory and management composition.
- `src/frontend/web/src/ui/library/LibraryChatUploadsDebugPanel.tsx`: upload
  management and retrieval-debug tools.
- `src/frontend/web/src/ui/memory/MemoryLibraryPage.tsx`: `/a/memories`
  workspace.
- `src/frontend/web/src/routes/a/memories.tsx`: protected route.

## Supported Files

The frontend mirrors the backend MVP allowlist:

- `.txt`, `.md`, `.rst`, `.org`, `.json`, `.csv`, `.tsv`
- `.html`, `.htm`, `.xml`
- `.pdf`, `.docx`, `.pptx`, `.xlsx`

The browser max upload size is `25 MiB`, matching the backend default. Backend
validation remains authoritative; frontend restrictions are only an early user
feedback layer.

## Library Chat Uploads Management

The management area under Library's Chat Uploads section is intentionally
operational rather than a chat feature. It shows:

- an `uploads/` file list
- file status and latest job status
- chunk count
- last processed/updated timestamp
- visible last error text
- process/reprocess controls
- selected-file deletion
- `search_memory_files` debug search for markdown memory
- advanced chunk search with `hybrid`, `keyword`, and `semantic` modes

The memory debug search has one query input and returns compact markdown-memory
hits from the normal `search_memory_files` path. Advanced chunk search keeps the
uploaded-file diagnostics: when files are selected, search is scoped to those
file IDs; with no selection, search runs across all current-user processed
uploads.

## Validation

Frontend validation commands:

```bash
pnpm check
pnpm web:lint
pnpm web:test
pnpm build
```

Manual end-to-end validation requires only the normal local stack and writable
`data/` mount; no R2-compatible service or credentials are required. The
checked-in worker service is currently commented out, so `./reset.sh` alone
does not start parsing. Enable/configure the private worker before testing
processing and confirm a fresh heartbeat through the capability endpoint.
Embedded tests require the real signed document pack; mocked UI controls are
not evidence of native conversion.

# User File Uploads

The web app exposes the backend user-file lifecycle through a shared Uppy upload flow
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
- `/library?section=chat-uploads`: lists uploaded files, shows file and
  processing status, supports upload, selected deletion, process/reprocess
  actions, and debug search.

The chat composer offers the attach button, drop overlay and upload tray, and
the Library its Chat Uploads section, only when the admitted runtime
capabilities report `chat_file_uploads: true` (`useRuntimeFeatureEnabled` in
`ui/app/RuntimeFeatureGate.tsx`). Local runtimes always do, and admission
supplies the capabilities before the composer mounts. When they report `false`,
as hosted runtimes do, the attach button and the Chat Uploads tab stay visible but
disabled with the shared hosted exclusion reason, and a direct
`/library?section=chat-uploads` link explains that chat uploads and, when
withheld, document processing are unavailable. The disabled attach button opens
no picker, and no drop target or tray is rendered. The backend still rejects
uploads it does not mount.

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
backend file row is known.

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

## Backend lifecycle and frontend status

[User Files](../../backend/features/user-files.md) owns endpoint validation,
worker configuration, processing statuses, chunking and deletion recovery.
The frontend uses three mutations: init returns the PUT target, finalize confirms
stored bytes, and process enqueues work. `force=true` requests reprocessing.

Composer cards combine backend state with transient Uppy stages: `preparing`,
`initializing`, `uploading`, `finalizing`, `uploaded`, `queued`, `processing` and
`failed`. Transient stages fill the gap before an authoritative row is available.
A saved original without processing stays `uploaded` and does not poll forever.

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
- `src/frontend/web/src/ui/memory/MemoryLibraryPage.tsx`: `/memories`
  workspace.
- `src/frontend/web/src/routes/_app/memories.tsx`: protected route.

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

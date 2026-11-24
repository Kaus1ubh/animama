# Send images to the Anima in chat

Source agreement: [#904](https://github.com/raymond-van/animama/issues/904),
published from the agreed [spec](chat-image-input-spec.md) at
2026-11-24T16:51:31Z (accepted by the owner on 2026-11-24 with the recommended
defaults).
Authorized scope: planning only. Implementation starts after the owner reviews
this plan (G0).
Planning baseline and implementation base: `origin/main` at `f612be08d`.
Workspace: worktree `chat-image-input`, branch `feat/chat-image-input`. No
stack yet; Phase 5 starts a task stack and records its URL here.

## Purpose and context

After this plan, a person using the desktop app or a self-hosted stack can
pick, paste or drag up to four images into the chat composer. A model that
accepts images receives them with the message through any of the three model
adapters, earlier images stay available for follow-up questions, and the chat
shows thumbnails live and after a reload. With a model that cannot take images
the composer says so and the API refuses the turn. Hosted, image output and
OCR are out of scope. The database schema does not change.

Orientation, from read-only surveys on 2026-11-24 (paths under
`src/backend/animama` unless they start with `src/frontend`, `tests` or
`docs`; line numbers at `f612be08d`):

- **Uploads.** `server/routers/user_files.py` owns the lifecycle:
  `POST /v1/files/uploads` (L170) validates the name and size through
  `app/services/user_file_service.py` (`ALLOWED_USER_FILE_EXTENSIONS` L25,
  validation L120) and creates a `pending_upload` row with the locator
  `user-files/{user}/{file}/original`; `PUT /v1/files/{id}/content` (L223)
  spools the body into private storage; `:finalize` (L265) checks the stored
  size and sets `uploaded`. Finalize neither inspects the bytes nor computes a
  digest. The client then calls `:process` (L343), and the processing runner
  sets `ready` or `ready_keyword_only` with chunks. Statuses are string
  constants in `domain/user_file.py` L7-15. `orm/user_file.py` has no kind
  column; its `metadata` JSON is the extension point.
- **Storage.** `app/ports/private_file_storage.py` (`put_stream`,
  `open_bounded`, `head`, `delete`) with the filesystem adapter
  `adapters/content_store/private_file_store.py` L66. `put_stream` replaces
  atomically. Delete removes the one locator of a file.
- **Images.** `app/services/content_image.py` decodes with Pillow under global
  limits (40 megapixels, 16,384 px a side, decompression-bomb warnings raised
  as errors). `canonicalize_image_stream` (L139) applies EXIF orientation,
  scales down, copies pixels into a fresh image (which drops metadata) and
  encodes WebP. It accepts PNG, JPEG and WebP only, and rejects animated PNG
  and WebP (`_require_supported_frame_policy` L373). Callers run it through
  `asyncio.to_thread`. `app/services/content_thumbnails.py` `thumbnail_file`
  (L83) derives a cached 128 px WebP thumbnail from PNG, JPEG or WebP bytes.
- **Serving bytes.** `product_http/delivery.py` `verified_file_response` (L70)
  streams with an `ETag`, `X-Content-Type-Options: nosniff` and a sandbox
  CSP. `product_http/routes/content.py` L195 is the model: it depends on
  `get_current_principal`. No route returns user-file bytes.
  `product_http/inventory.py` L284-292 lists the user-file routes as
  `_excluded("chat_file_uploads", ...)`, and
  `tests/test_product_http_inventory.py` requires every local route there in
  mount order.
- **Turn setup.** `product_http/chat/turn_setup.py` `prepare_direct_chat_turn`
  (L141) calls `validate_searchable_attached_files`
  (`app/chat/memory_search.py` L112), which keeps files that are `ready` or
  `ready_keyword_only` with chunks and drops the rest with a log line. It
  builds `DirectChatTurnRequest` (`app/chat/direct_turn/types.py` L48) with a
  string `user_message`. `DirectChatTurnSetupError` maps to HTTP 400 (L279).
- **Prompt and history.** `app/chat/openai_prompt.py`
  `DirectChatPromptAssembler.assemble` (L123) builds the current user message
  from a string (L201-207); models without a developer role get a
  `<turn_context>` text prefix (L242). Prompt messages are plain dicts in Chat
  Completions shape (`app/model_clients/prompt.py` L34). The user row is saved
  in `app/chat/direct_executor.py` (L928-947) with `content`, `data`
  (`attached_file_ids`) and `raw_provider_message`. Later turns replay
  `raw_provider_message` verbatim (`_history_message`, `openai_prompt.py`
  L635), so its shape is sent on every later turn through every adapter.
- **Adapters.** OpenAI Responses (`adapters/model_clients/openai_responses/request.py`
  `_input_items_from_message` L212) silently drops a message whose content is
  not a string. Chat Completions (`openai_chat_completions/request.py`
  `_messages_for_spec` L72) passes a parts list through unchanged. Anthropic
  (`anthropic_messages/request.py` `_content_blocks` L447) passes parts
  through as blocks. With an OpenAI Responses cursor
  (`previous_response_id`) no history is loaded; a stale cursor reloads it.
- **Budgets and logs.** `app/model_clients/context_budget.py`
  `estimate_value_tokens` (L105) estimates from the JSON text of a message, so
  inline base64 would count as hundreds of thousands of tokens.
  `app/model_clients/logging_context.py` `_prompt_preview` (L95) logs a JSON
  preview of prompt messages when previews are enabled.
- **Capabilities.** The executor reads `model_provider.capabilities.accepts`
  (`domain/model_provider.py` L17). Catalog models declare it
  (`app/model_catalog.py`); for an owner-configured model it comes from the
  owner's "accepts images" setting
  (`app/services/model_configuration_service.py` L646). Probes do not detect
  it. The chat page sees `accepts` on `PyModelProviderCatalogItem`.
- **Text readers.** Compaction, Memory Manager reflection, the search vector
  and title generation read `chat_messages.content` or the request text.
- **Composer.** `src/frontend/web/src/lib/user-files/uploads.ts` holds the
  accepted extensions and Uppy restrictions. `useUserFileUpload`
  (`web/src/hooks/useUserFileUpload.ts`) runs init, PUT, finalize, then
  process. `chat-attachments.ts` and `chat-attachment-hold.ts` let a file be
  attached or sent only when it is `ready` with chunks.
  `web/src/ui/main/chat/ChatInterface.tsx` wires the tray, the popover and
  the model note (`composer.files.noToolsNote`, L313-319).
  `ChatFileDropOverlay.tsx` handles drops. Nothing handles paste, and the tray
  is never cleared after a send.
- **Messages.** `packages/product-ui` owns `ChatConversation` and
  `ChatDisplayMessage` (`src/lib/chat/display-message-mapping.ts`), which
  carries text only. The history API already returns `data.attached_file_ids`.
  Private images elsewhere load through fetch and a blob URL
  (`web/src/query/hooks/useRuntimeContentMediaUrl.ts`). The app's CSP allows
  `blob:` images. `web/src/ui/components/dialog.tsx` is the only dialog.
- **Packages.** A structural change to the local OpenAPI contract needs a new
  `local-http` major in `contracts/versions.json` (now `23.0.0`). A changed
  product-ui or runtime-contracts declaration needs a package version bump
  (now `0.20.0` and `0.23.0`). `scripts/package-sets` `compare` enforces both.
- **Records.** `licenses/source-review.json` lists every tracked file; each
  phase adds entries for its new files.

Provider facts, read from the official documentation on 2026-11-24:

| | Anthropic Messages | OpenAI Responses and Chat Completions |
| --- | --- | --- |
| Formats | JPEG, PNG, GIF, WebP; first frame of an animation | PNG, JPEG, WebP, non-animated GIF |
| Wire shape | `{"type": "image", "source": {"type": "base64", "media_type", "data"}}` | Responses `{"type": "input_image", "image_url": "data:…"}`; Chat Completions `{"type": "image_url", "image_url": {"url": "data:…"}}` |
| Per image | 10 MB base64, 8000 × 8000 px | Rejected above 30,000 patches of 32 px after resizing |
| Per request | 100 images (200k-context models) or 600; 128 MB. Above 20 images every image must fit 3,000 px a side | 1,500 images; 512 MB |
| Tokens | `ceil(w/28) × ceil(h/28)`, capped at 1,568 or 4,784 by model tier | `ceil(w/32) × ceil(h/32) × 1.2` for current models |

The agreed limits fit: a 2000 px long edge, 20 images in a request and a
canonical copy of at most 3.5 MiB (under 5 MB as base64). One estimate,
`min(ceil(w/28) × ceil(h/28), 4784)`, is an upper bound for every adapter.

## Progress

- [x] Phase 0: issue #904 published, spec snapshot and plan tracked.
- [ ] G0: owner review of this plan.
- [ ] Phase 1: image uploads are validated and stored as canonical copies.
- [ ] Phase 2: the owner can fetch image bytes.
- [ ] Phase 3: a turn with images is checked, saved and assembled without bytes.
- [ ] Phase 4: each adapter sends images.
- [ ] Phase 5: the composer accepts images.
- [ ] Phase 6: chat and the Library show images.
- [ ] Phase 7: documentation and decision record.
- [ ] Final integration review, G1 to G3, pull request.

## Surprises & Discoveries

- 2026-11-24 (planning): provider limits differ from older published figures
  (Anthropic allows 10 MB an image and 600 images; OpenAI allows 512 MB and
  1,500 images). The binding limits are Anthropic's rule above 20 images and
  the safe 5 MB base64 size, which the agreed defaults already meet.
- 2026-11-24 (planning): replaying `raw_provider_message` verbatim means
  inline image bytes would be stored in every user row, resent each turn and
  counted as text tokens. The plan stores references instead (D1).
- 2026-11-24 (planning): OpenAI Responses requests carry the existing inline
  moderation field, which scores the whole request input. Images in a
  Responses turn are therefore covered by that existing check. No moderation
  call is added (R4.2); the operator check on Anthropic turns stays text-only.
- 2026-11-24 (planning): the composer keeps attachments after a send. That
  suits documents, which the Anima searches on every turn, but would attach
  the same image again each turn (D5).

## Decision Log

- 2026-11-24, owner: scope is local compositions only; the recommended
  defaults for formats, limits, replay, storage, moderation and originals are
  accepted (recorded in #904).
- 2026-11-03, owner (standing instruction, recorded during #823): phases run
  the checks their changes affect, not the full pre-push suite. The full suite
  runs once on the final candidate after the owner agrees to the run (G3).
- 2026-11-24, agent proposals for owner review at G0. Each is an
  implementation choice inside the agreed behavior:
  - **D1. References, not bytes.** A user message with images is saved as
    text plus image reference parts (`file_id`, name, width, height). The
    executor loads bytes from private storage just before a request and hands
    them to the adapter beside the prompt. Rows, logs, previews, estimates and
    prompt copies never hold bytes (R2.3).
  - **D2. One stored copy.** At finalize the canonical copy replaces the
    uploaded bytes at the same locator, so delete and storage accounting stay
    as they are (R1.3, R3.3).
  - **D3. Canonical format.** PNG when the source is PNG or GIF and the result
    is at most 3.5 MiB, otherwise JPEG at quality 90 with transparency
    flattened onto white. WebP is not sent because support varies among
    OpenAI-compatible local servers.
  - **D4. Text stays required.** A turn still needs a message; an image alone
    cannot be sent. Title generation, reflection and search keep a text
    anchor, and the request contract is unchanged.
  - **D5. Images are attached for one turn.** After a successful send the
    composer drops its image attachments and keeps its documents. Earlier
    images reach the model through history replay.
  - **D6. A missing image stops the turn.** If an attached image no longer
    exists or is not ready, the API refuses the turn with a clear error.
    Documents keep today's drop-and-log behavior.
  - **D7. Placeholders in saved text.** `content` holds the person's text
    followed by one `[Image: name]` line per image, so every text reader sees
    it (R4.1). `data` keeps the person's text and the image list so the
    bubble shows text and thumbnails without placeholder lines.

## Phased implementation

Each phase starts from the previous phase's commit and writes its tests first.
Phases 1 and 2 need nothing else. Phase 3 needs Phase 1's image facts. Phase 4
needs Phase 3. Phase 5 needs Phases 1 and 3. Phase 6 needs Phases 2 and 5.
Phase 7 follows Phase 6.

### Workspace setup

After G0, in worktree `chat-image-input`:

1. Merge `origin/main` if it moved. Run `uv sync --python 3.12.13 --extra
   voice --extra viz --extra realtime --extra encrypt --all-packages --group
   dev`, `pnpm install` in `src/frontend`, and `git lfs pull`.
2. Set #904's triage label to `triage:ready-for-agent`.

### Phase 1: Image uploads are validated and stored as canonical copies

Review tier: high risk (decoding untrusted files, removing private metadata,
stored private data).

Requirements: R1.1 (server limits), R1.2, R1.3, R1.4 (server), R1.5 (errors).

Steps, tests first in `tests/test_content_image.py` and
`tests/test_user_file_uploads.py`:

1. `content_image.py`: add `canonicalize_chat_image_stream`. It reuses
   `_open_bounded_image`, accepts PNG, JPEG, WebP and GIF by decoded format
   whatever the extension, takes the first frame of an animation, applies
   EXIF orientation, scales the long edge to at most 2000 px, copies pixels
   into a fresh image and encodes per D3. It returns the bytes, media type,
   width, height and digest. Tests: each format; an animated GIF and WebP; a
   JPEG with GPS EXIF whose output has no EXIF; a rotated JPEG; an oversized
   and a corrupt file; a PNG that exceeds the byte cap and becomes JPEG.
2. `user_file_service.py`: add the image extensions (`.png`, `.jpg`, `.jpeg`,
   `.webp`, `.gif`) with a 20 MiB limit, and a specific rejection for `.heic`
   and `.heif` that names the format.
3. Finalize: for an image extension, read the stored bytes with
   `open_bounded`, canonicalize through `asyncio.to_thread`, write the result
   to the same locator, and set `ready`, `stored_size_bytes`, `sha256`,
   `detected_content_type`, `processed_at` and `metadata.image` (width,
   height, media type). A file that is not a supported image becomes `failed`
   with a reason the composer can show, and its bytes are deleted.
4. `:process` on an image returns its current state without a job.
5. One predicate, `is_image_user_file`, reads `metadata.image`; nothing else
   infers the kind.

Checks: `uv run pytest -q tests/test_content_image.py
tests/test_user_file_uploads.py tests/test_user_file_storage.py`;
`uv run ruff check`. Not run in this phase: the full pre-push suite.

Completion: an uploaded image ends `ready` with a canonical copy and image
facts; the original bytes are gone; documents behave as before.

Recovery: a finalize that fails midway leaves the row `uploaded` or `failed`
with the original bytes; finalize can be retried, and delete removes the file.

Check record, results and commits: to be recorded.

#### Code Review #1 Findings

To be recorded.

#### Code Review #1 Revisions

To be recorded.

### Phase 2: The owner can fetch image bytes

Review tier: high risk (ownership boundary, API contract, generated client).

Requirements: R3.2, R3.3 (server).

Steps, tests first in `tests/test_user_file_uploads.py` and
`tests/test_product_http_inventory.py`:

1. Add `GET /v1/files/{file_id}/content` beside the PUT. It requires the
   installation owner, serves only `ready` image files (404 for another
   owner's, a deleted or a non-image file), and answers through
   `verified_file_response` with the digest as `ETag` and
   `Cache-Control: private, no-cache`. `?variant=thumbnail` serves
   `thumbnail_file`'s 128 px copy.
2. Add the route to `product_http/inventory.py` as
   `_excluded("chat_file_uploads", ...)` in mount order.
3. Raise `local-http` to `24.0.0` in `contracts/versions.json`, run
   `pnpm openapi-ts`, raise the runtime-contracts package version, and run
   `pnpm packages:build`.

Checks: the two test files; `uv run ruff check`; from `src/frontend`
`pnpm openapi-ts:check` and `pnpm check`; the package-set `compare` against a
`main` baseline.

Completion: the owner receives image bytes and thumbnails with revalidation;
every other request is refused; the inventory and contract checks pass.

Check record, results and commits: to be recorded.

#### Code Review #1 Findings

To be recorded.

#### Code Review #1 Revisions

To be recorded.

### Phase 3: A turn with images is checked, saved and assembled without bytes

Review tier: high risk (the saved message shape is replayed on every later
turn; private bytes must stay out of rows and logs).

Requirements: R2.2 (server), R2.3, R2.4, R2.5, R2.6, R4.1.

Steps, tests first in `tests/test_direct_chat_turn_executor.py`,
`tests/test_direct_chat_context_window.py`, `tests/test_context_budget.py`,
`tests/test_turn_instruction_layout.py` and `tests/test_anima_chat_sse.py`:

1. New module `app/model_clients/image_parts.py`: the neutral part
   `{"type": "model_client_image", "file_id", "name", "width", "height"}`,
   `ModelClientImage` (media type and bytes, excluded from `repr`), the token
   estimate above, the placeholder text and helpers to walk a prompt's parts.
   `ModelClientRequest` gains `images: Mapping[str, ModelClientImage]`.
2. Turn setup: split `attached_file_ids` into documents and images. Documents
   keep `validate_searchable_attached_files`. Images go through a new
   `validate_attached_images`, which refuses the turn (HTTP 400 with a code)
   when there are more than four, when one is missing or not ready (D6), or
   when the model does not accept images. `DirectChatTurnRequest` gains
   `attached_images`; upload tools are offered for documents only.
3. Prompt assembly: with images, the user message content is the image parts
   followed by one text part. The `<turn_context>` prefix and the tag escaping
   apply to the text part. `prompt_last_user_message` and
   `_message_content_text` join text parts.
4. Saving: `raw_provider_message` holds the parts; `content` and `data` follow
   D7.
5. Selection: before context fitting, keep the newest 20 image parts in the
   prompt (the current turn's first) and turn every other image part into
   placeholder text; when the model does not accept images, turn all of them
   into placeholders. After fitting, load the bytes of the parts that remain
   through `open_bounded`, checking the owner. A file that has since been
   deleted becomes a placeholder.
6. Estimates: `history_item_tokens` and `estimate_prompt_tokens` count an
   image part with the estimate instead of its JSON text.
7. `adapters/model_clients/mock.py` answers a parts message from its text.

Tests cover: the three refusals; a saved row with no bytes and the expected
`content` and `data`; a follow-up turn that replays the earlier image; the
21st image becoming a placeholder; trimming a history with images; a model
switch to a text-only model; an image deleted between turns; a log capture
with previews enabled that holds no image data.

Checks: the listed test files; `uv run ruff check`.

Completion: a turn with images produces a prompt that holds references, a
request that holds the bytes beside it, and rows and logs with neither bytes
nor base64.

Check record, results and commits: to be recorded.

#### Code Review #1 Findings

To be recorded.

#### Code Review #1 Revisions

To be recorded.

### Phase 4: Each adapter sends images

Review tier: high risk (private data leaves the machine in provider requests).

Requirements: R2.1, R2.6 (cache markers), R4.2.

Before coding, read the current OpenAI Responses and Chat Completions
references for image parts and the Anthropic Messages image block, and record
any difference from the provider table above.

Steps, tests first in `tests/test_turn_instruction_layout.py`,
`tests/test_direct_chat_model_clients.py`,
`tests/test_anthropic_messages_client.py` and
`tests/test_anthropic_direct_chat.py`:

1. Responses: `_input_items_from_message` maps a parts list to `input_text`
   and `input_image` parts. `_history_user_breakpoint_indexes` includes user
   messages with parts and attaches the marker to the text part.
2. Chat Completions: `_messages_for_spec` maps image parts to `image_url`
   data URLs.
3. Anthropic: `_content_blocks` maps image parts to base64 `image` blocks.
4. Each adapter turns an image part without bytes into the placeholder text,
   so a request is never built with a dangling reference.
5. Confirm the operator moderation call still receives text only.

Tests assert the exact wire request for a turn with text and two images, for
a history message with an image, and for a placeholder, on each adapter.

Checks: the listed test files; `uv run ruff check`.

Completion: each adapter builds a valid image request; G1 confirms it against
real providers.

Check record, results and commits: to be recorded.

#### Code Review #1 Findings

To be recorded.

#### Code Review #1 Revisions

To be recorded.

### Phase 5: The composer accepts images

Review tier: standard (behavior change inside the web app).

Requirements: R1.1, R1.5 and R2.2 in the composer.

Start a task stack for this branch with `./reset.sh --name <name> --base-port
<free port>` and record its URL above. Follow the `animama-ui` skill and reuse
the existing tray, popover and note components.

Steps, tests first in `web/src/lib/user-files/*.test.ts`,
`web/src/ui/main/chat/chatAttachmentHold.test.tsx` and
`ChatUploadCapability.test.tsx`:

1. `uploads.ts`: add the image extensions and the 20 MiB limit; refuse HEIC
   and HEIF with a message that names the format.
2. `useUserFileUpload`: skip `:process` when finalize returns an image.
3. `chat-attachments.ts` and `chat-attachment-hold.ts`: a `ready` image is
   attachable and sendable without chunks, and still works when document
   processing is disabled. Refuse a fifth image with a reason.
4. `ChatInterface.tsx`: when the active model is known not to accept images,
   disable adding images and show a note in the tray, following
   `composer.files.noToolsNote`. Pasting an image file into the text area adds
   it to the tray. After a successful send, remove image attachments (D5).
5. Tray cards show a small preview for images.
6. Add the English strings and their Japanese, Korean and Chinese
   translations; run `pnpm i18n:extract`.

Checks from `src/frontend`: the touched Vitest files, `pnpm check`,
`pnpm web:lint`, `pnpm i18n:check`. Manual check on the task stack at desktop
width, then a narrow width: pick, paste and drag an image, send it with a
vision model and get a reply about it.

Completion: an image can be attached three ways and sent; refusals explain
themselves; documents behave as before.

Check record, results and commits: to be recorded.

#### Code Review #1 Findings

To be recorded.

#### Code Review #1 Revisions

To be recorded.

### Phase 6: Chat and the Library show images

Review tier: high risk (product-ui's public declarations and package version
change).

Requirements: R3.1, R3.3 and R1.4 in the interface.

Steps, tests first in `web/src/lib/chat/display-message-mapping.test.ts`,
`packages/product-ui/tests/chat-lifecycle.test.mjs`,
`web/src/ui/components/message.test.tsx` and
`web/src/lib/uploads/libraryUploads.test.ts`:

1. product-ui: `ChatDisplayMessage` gains an optional image list. The
   optimistic user message carries it, and history mapping reads it and the
   person's text from `data`. `ChatConversation` gains a render prop for user
   message attachments, like `renderAssistantAccessory`. Raise the product-ui
   version and its line in `contracts/hosted-web.md`.
2. web: a hook loads an image through fetch and a blob URL, following
   `useRuntimeContentMediaUrl`. A component renders the thumbnails in the
   bubble, opens the image larger in the existing dialog, and shows a
   placeholder when the file is gone.
3. Library → Chat uploads: an image row shows its thumbnail and a ready
   state without processing wording.
4. Strings in all five locales.

Checks from `src/frontend`: the touched test files, `pnpm check`,
`pnpm web:lint`, `pnpm i18n:check`, `pnpm packages:build`, the package-set
`compare`. Manual check on the task stack: thumbnails after a send and after a
reload, the larger view, a deleted image, the Library row, at desktop and
narrow widths.

Completion: images are visible wherever the message is; a deleted image
leaves a placeholder; the package checks pass.

Check record, results and commits: to be recorded.

#### Code Review #1 Findings

To be recorded.

#### Code Review #1 Revisions

To be recorded.

### Phase 7: Documentation and decision record

Review tier: light; the final integration review covers it.

1. `docs/backend/features/user-files.md`: image formats and limits, the
   canonical copy, the byte route, and what images do not get (processing,
   search).
2. `docs/frontend/runtime/chat.md`: attaching images, the per-turn limit, the
   model note and thumbnails.
3. `docs/frontend/features/model-settings.md`: the Vision chip and the "accepts
   images" setting now decide whether chat sends images.
4. `docs/backend/runtime/chat.md` (image parts, replay and placeholders),
   `model-client-providers.md` (each adapter's image format) and
   `prompt-caching.md` (cache markers on messages with images). Note that an
   OpenAI Responses conversation stored by OpenAI now includes its images.
5. A new ADR recording D1 and D2 with the alternatives considered (inline
   bytes in saved messages, provider file uploads, a separate image store).
6. Source-review entries for every new file.

Check: the documentation links resolve.

## Final integration review

One review of the combined change against #904's acceptance criteria, covering
Phase 7 and reusing phase evidence. After its repairs and the owner's
agreement (G3), the full pre-push suite runs once on the final candidate
through the heavy slot: `python3 scripts/heavy-slot.py -- make check-test`;
from `src/frontend`, `python3 ../../scripts/heavy-slot.py -- pnpm verify` and
`pnpm web:test:browser`; and `pnpm e2e:test:fast` against a disposable built
stack. Results go in the pull request.

Gates:

- **G0.** Owner review of this plan, including D1 to D7.
- **G1.** Provider check. With the owner's agreement to a bounded paid run
  (three calls, well under US$1), send one image through a vision model on
  each adapter family from the task stack and confirm the reply describes it.
- **G2.** Desktop check. Pasting and dragging in the Electron app need the
  owner's go-ahead before the agent drives the app, or the owner checks them.
- **G3.** Owner agreement to the full pre-push run.

Hosted validation stays off unless the owner starts a run; the pull request
states which evidence is local.

## Validation and acceptance

Each #904 acceptance criterion and the evidence planned for it:

| Criterion | Evidence |
| --- | --- |
| Each adapter builds and sends an image request | Phase 4 request tests; G1 |
| A model without image input is refused | Phase 3 API test; Phase 5 composer test |
| Pick, paste and drag in web and desktop | Phase 5 manual check; G2 |
| Thumbnails after reload; placeholder after delete | Phase 6 tests and manual check |
| No EXIF or GPS; no bytes in rows, events, logs or memory files | Phase 1 and Phase 3 tests |
| Replay, the 21st image, context fitting | Phase 3 tests |
| Library lists images | Phase 6 test and manual check |
| Suites and documentation | Final suite (G3); Phase 7 |

## Idempotence and recovery

- No schema or data migration. Existing rows, uploads and chats are untouched.
- Every phase is a commit on the task branch and can be reverted alone in
  reverse order. Reverting Phase 3 after images were sent leaves user rows
  whose `raw_provider_message` has a parts list: Chat Completions and
  Anthropic would then receive an unknown part type. Before such a revert,
  keep Phase 3's placeholder conversion or delete the test chats.
- An interrupted image finalize can be retried; a failed image can be deleted.
- The task stack holds only test chats and can be removed with its volumes.

## Outcomes & Retrospective

To be recorded.

# Send images to the Anima in chat

Source agreement: [#904](https://github.com/raymond-van/animama/issues/904),
published from the agreed [spec](chat-image-input-spec.md) at
2026-11-24T16:51:31Z (accepted by the owner on 2026-11-24 with the recommended
defaults).
Authorized scope: the whole plan. The owner approved this plan, including D1
to D7, and Phase 1 on 2026-11-24 (G0), then authorized Phases 2 to 7 the same
day. G1 to G3 still need the owner.
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
- [x] G0: the owner approved the plan and Phase 1 (2026-11-24).
- [x] Phase 1: image uploads are validated and stored as canonical copies.
  Three reviews; all blocking findings repaired. P1-A13 moves to Phase 2.
- [x] Phase 2: the owner can fetch image bytes. Two reviews; should-fix
  items repaired; chat deletion moves to Phase 3 (D12).
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

- 2026-11-24 (Phase 1): the backend guide says upload bytes are never parsed
  in the server process. That rule was written for document parsers. Chat
  images are decoded in the server with Pillow, as content images already are
  (D8); the guide now says so.
- 2026-11-24 (Phase 1): Pillow refuses `formats=["MPO"]` because the JPEG
  decoder opens multi-picture files, so the decoder list leaves MPO out.
- 2026-11-24 (Phase 1): saving a JPEG with `optimize=True` at full colour
  resolution fails on a noisy image ("broken data stream"), because Pillow
  sizes one buffer from the pixel count. The encoder runs without it.
- 2026-11-24 (Phase 1, review): Pillow's decoders raise `SyntaxError`,
  `IndexError`, `TypeError` and `struct.error` on damaged input, beyond the
  error types the existing image code catches. `ImageOps.exif_transpose`
  fails on a photo with one malformed EXIF tag because it rewrites the EXIF
  block. The chat path reads the orientation itself and treats every decoder
  error as an unreadable image. The older content-image functions keep their
  narrower handling; changing them is outside this plan.
- 2026-11-24 (Phase 1, review): Pillow scales palette and 1-bit images with
  nearest-neighbour and clips 16-bit greyscale when converting. The chat path
  converts to 8-bit RGB first.
- 2026-11-24 (Phase 1, review): storage `delete` succeeds for a missing file.
  An earlier draft kept a refused upload's bytes on the opposite assumption.

## Decision Log

- 2026-11-24, owner: scope is local compositions only; the recommended
  defaults for formats, limits, replay, storage, moderation and originals are
  accepted (recorded in #904).
- 2026-11-03, owner (standing instruction, recorded during #823): phases run
  the checks their changes affect, not the full pre-push suite. The full suite
  runs once on the final candidate after the owner agrees to the run (G3).
- 2026-11-24, owner: plan approved with D1 to D7 as proposed; Phase 1
  authorized (G0).
- 2026-11-24, owner: Phases 2 to 7 authorized ("the rest of the execplan once
  phase 1 is complete").
- 2026-11-24, agent proposals, approved by the owner at G0. Each is an
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

- 2026-11-24, agent (Phase 1), within the approved behavior:
  - **D3, extended.** When quality 90 does not fit 3.5 MiB the JPEG encoder
    steps down (82, 74, 66, 58, 50) and then refuses. Random noise at
    2000 × 2000 fits at quality 50, so a refusal is practically unreachable.
  - **D8. Chat images are decoded in the server.** Finalize decodes on a worker
    thread through the bounded opener content images use, restricted to the
    PNG, JPEG, WebP and GIF decoders, at most two images at a time. The parse
    child stays for documents: it returns text over a pipe and serves a
    durable job, and R1.4 gives images no job. The owner can redirect this
    without changing the stored format.
  - **D9. The kind is recorded when the upload starts.** `metadata.kind` is
    `"image"` from init, and `metadata.image` (width, height, media type) is
    added when the canonical copy is stored. One predicate reads the kind.
  - **D10. Storage changes run under the row lock.** Decoding takes no lock.
    The service re-reads the row for update and checks it is still an
    uploaded image before the canonical copy is written or a refused upload
    is deleted, so a delete or a second request during decoding cannot be
    followed by a write.
  - **D11. `:process` completes an interrupted image.** A finalize that stops
    after marking the file uploaded cannot be retried (the upload is no longer
    pending). `:process` stores the canonical copy for such an image and
    otherwise returns an image's state without a job. Phase 5 makes the
    composer call it when a finalize fails.

- 2026-11-24, agent (Phase 2 review), within R3.3:
  - **D12. Deleting a chat deletes its images when nothing else uses them.**
    When a chat is deleted, each image its user messages reference is deleted
    like a file the person removed, unless a message in another chat
    references it too (an image can be attached again from the Library).

## Phased implementation

Each phase starts from the previous phase's commit and writes its tests first.
Phases 1 and 2 need nothing else. Phase 3 needs Phase 1's image facts. Phase 4
needs Phase 3. Phase 5 needs Phases 1 and 3. Phase 6 needs Phases 2 and 5.
Phase 7 follows Phase 6.

### Workspace setup

After G0, in worktree `chat-image-input`:

1. Merge `origin/main` if it moved. Run `uv sync --python 3.12.13 --extra
   voice --extra viz --extra realtime --extra encrypt --extra documents
   --all-packages --group dev` (the `make sync` set, pinned to Python
   3.12.13). Before the frontend phases run `pnpm install` in `src/frontend`,
   and run `git lfs pull` before backend content tests.
2. Set #904's triage label to `triage:ready-for-agent`.

### Phase 1: Image uploads are validated and stored as canonical copies

Review tier: high risk (decoding untrusted files, removing private metadata,
stored private data).

Requirements: R1.1 (server limits), R1.2, R1.3, R1.4 (server), R1.5 (errors).

Starting revision: `bdc7ea710`. Built as follows, tests first in
`tests/test_content_image.py` and `tests/test_user_file_uploads.py`:

1. `content_image.py`: `canonicalize_chat_image_stream` takes only the bytes.
   It opens them with the PNG, JPEG, WebP and GIF decoders through
   `_open_bounded_formats` (split out of `_open_bounded_image`, which now also
   restricts Pillow to the decoders its extension allows), takes the first
   frame, converts to 8-bit RGB or RGBA, scales the long edge to 2000 px,
   applies the EXIF orientation, copies the pixels into a fresh image and
   encodes per D3. A pixel-budget refusal now has that reason for a
   decompression bomb too, for every caller of the opener.
2. `user_file_service.py`: image extensions with a 20 MiB limit, a refusal
   that names HEIC and HEIF, the kind recorded at init (D9), and
   `complete_image_upload` and `fail_image_upload` (D10).
3. Finalize: for an image, the router decodes the stored upload on a worker
   thread, then the service stores the canonical copy at the same locator and
   sets `ready`, the stored size, digest, media type, `processed_at` and
   `metadata.image`. A file that cannot be stored as an image becomes `failed`
   with a reason for the composer, and its uploaded bytes are deleted.
4. `:process` on an image returns its state without a job, first completing an
   image left at `uploaded` (D11).
5. `src/backend/AGENTS.md` and one sentence of
   `docs/backend/features/user-files.md` describe the in-server decode. The
   rest of the documentation is Phase 7.

Completion: an uploaded image ends `ready` with a canonical copy and image
facts; the original bytes are gone; a refused upload is `failed` with a reason
and no bytes; documents behave as before.

Recovery: a read failure, a write failure or a server fault leaves the row
`uploaded` with the original bytes; `:process` completes it, and delete
removes it. Only a refusal of the image itself fails the file and deletes its
bytes.

Check record (working directory: the checkout root; all on the working tree
recorded under Code Review #2 Revisions):

| Command | Result |
| --- | --- |
| `uv run --no-sync ruff format --check src/backend/animama tests` | exit 0 |
| `uv run --no-sync ruff check` | exit 0 |
| `uv run --no-sync mypy src/backend/animama tests` | exit 0, 907 files |
| `uv run --no-sync python scripts/repository-boundary/check-python-imports.py` | exit 0 |
| `timeout 900 uv run --no-sync pytest -q -n 2` on the 16 files below | exit 0, 367 passed |
| `timeout 900 uv run --no-sync pytest -q -n 2` on the 27 wider files below | exit 0, 310 passed |
| `uv run --no-sync python -m animama.server.export_openapi --output <file>` | byte-identical to the export from `main` |

The 16 files: `test_content_image`, `test_content_gltf`,
`test_content_thumbnails`, `test_user_file_processing`,
`test_user_file_processing_runner`, `test_user_file_parsers`,
`test_user_file_uploads`, `test_user_file_storage`,
`test_runtime_capabilities`, `test_product_http_inventory`,
`test_content_package_import_resources`, `test_typed_content_apis`,
`test_anima_creation_batching`, `test_accountless_repository_boundaries`,
`test_openapi_export`, `test_product_http_runtime_capabilities`.

The 27 wider files are the other tests that reach the shared image opener:
`test_anima_chat_profile`, `test_anima_creation`, `test_anima_creation_voice`,
`test_anima_reaction_pools`, `test_anima_starters`, `test_avatar_face_parts`,
`test_avatar_settings`, `test_content_evidence`,
`test_content_package_cross_installation`,
`test_content_package_export_review`, `test_content_package_import_anima`,
`test_content_package_import_avatar`, `test_content_package_voice_export`,
`test_content_portrait_mutation_replay`, `test_creation_content_admission`,
`test_included_content_catalog`, `test_included_content_digest_urls`,
`test_included_derivative_packaging`, `test_included_derivatives`,
`test_local_content_catalog`, `test_non_portable_packages`,
`test_optional_sound_dependencies`, `test_product_http_typed_content`,
`test_runtime_content_catalog_completeness`, `test_starter_content_closure`,
`test_typed_content_preview_batch`, `test_generate_synthetic_docs`.

Not run: the full pre-push suite (owner's standing instruction; G3), and
`pnpm openapi-ts:check`, because the worktree has no frontend dependencies
yet. The identical schema export shows the generated client is not stale.

#### Code Review #1 Findings

Reviewed source: uncommitted working tree `74319f4248e7` on `bdc7ea710`, high
risk, initial review, by an analysis reviewer and a checks reviewer. The
checks reviewer reproduced all four recorded checks (329 passed) and ran 30
more test files that reach the changed code (327 passed).

Blocking:

- **P1-A1.** Decoder errors outside the caught types (`SyntaxError`,
  `IndexError`, `TypeError`, `struct.error`) escaped as HTTP 500 and left the
  row `uploaded` with its original bytes. Found by mutating 52,000 inputs; a
  rotated JPEG with one mistyped EXIF tag reproduces it.
- **P1-A2.** The canonical copy was written before the row was locked or
  re-checked. A delete during decoding was followed by a write that no API
  could remove, and a concurrent `:process` could overwrite the copy after its
  size and digest were recorded.
- **P1-A3.** A refused upload kept its original bytes, against R1.3. The
  reason given for keeping them was wrong: deleting a missing file succeeds.
- **P1-C1.** The longer `process_user_file` docstring changed the operation's
  OpenAPI description, so the generated client was stale.

Should fix:

- **P1-A4.** A decompression bomb was reported as an unsupported format.
- **P1-A5.** `PrivateFileReadError` was not caught, so a read failure was an
  unlogged 500 instead of a 503.
- **P1-A6.** 16-bit greyscale PNGs were stored nearly white.
- **P1-A7.** Palette and 1-bit sources were scaled with nearest-neighbour.
- **P1-A9, P1-C4.** No tests for the read, write and conflict failures, the
  other refusal messages, a pixel-area refusal, a multi-picture source, or the
  real storage adapter.
- **P1-A10, P1-C6.** Inexact guide wording, unrecorded plan deviations and a
  misleading sentence in `user-files.md`.
- **P1-C2.** `test_accountless_repository_boundaries` was missing from the
  record.

Optional, not taken: sharing the decode steps with `canonicalize_image_stream`
(the chat path now differs on purpose, and changing content images is outside
this plan); a reduced-size JPEG decode to lower peak memory. Noted, existing
behavior: a `PUT` racing a finalize can rewrite same-size bytes.

Sound as built, per the reviewers: decoder restriction and bounds (a
1,000,000-frame GIF took 0.7 s; no mutated input over 1 s), metadata removal
(output holds only image data chunks), ownership checks, no change for the
existing callers of the opener across 61,335 comparisons, the document paths.

#### Code Review #1 Revisions

Repair round 1 of 2. Every finding was verified before the change.

| Finding | Disposition | Change |
| --- | --- | --- |
| P1-A1 | Accepted | The chat path treats any decoder error as `invalid_image`, the opener treats any open error as an unsupported format, and the orientation is read without rewriting EXIF, so a photo with a malformed tag is accepted. Tests: a mistyped-tag JPEG, a PNG with a damaged chunk. |
| P1-A2 | Accepted | D10: the service checks the row under its lock and then runs the write or delete. A conflict returns the file's current state. Tests: delete during decoding (nothing written, 404), another request finishing first (nothing written). |
| P1-A3 | Accepted | A refused upload's bytes are deleted under the same lock, as the plan said. Test covers four refusals. |
| P1-C1 | Accepted | The explanation moved to a comment; the schema export is byte-identical to `main`. |
| P1-A4 | Accepted | A bomb is a pixel-budget refusal for every caller; the thumbnail test that pinned the old reason is updated. |
| P1-A5 | Accepted | Caught with the other read failures; test for the 503. |
| P1-A6 | Accepted | 16-bit greyscale is scaled to 8 bits; gradient test. |
| P1-A7 | Accepted | Conversion happens before scaling; striped palette test for GIF and PNG. |
| P1-A9, P1-C4 | Accepted | Added the tests above plus write failure (507), missing bytes on `:process`, a multi-picture JPEG, both pixel refusals, and finalize against the real filesystem storage. |
| P1-A10, P1-C6 | Accepted | Guide paragraph rewritten; D8 to D11 and this section record the deviations; the `user-files.md` sentence is corrected. |
| P1-C2 | Accepted | Added to the record with two more route and schema tests. |

Verification: the check record above, on working tree `37a7e9b49c39` (taken before this line was filled in). Remaining
repair budget: one round.

#### Code Review #2 Findings

Reviewed source: working tree `774e40e02534` (the repaired tree `37a7e9b49c39`
plus one plan line), high risk, targeted recheck after repair round 1.

The checks reviewer reran all seven checks clean (363 and 310 passed, schema
byte-identical to `main`, no flakiness in three runs) and found P1-C1, P1-C2
and P1-C4 fixed. The analysis reviewer found every accepted finding fixed:
52,000 mutated inputs with nothing escaping, both lock interleavings correct
on PostgreSQL with the real repository and storage, all eight orientations
matching `ImageOps.exif_transpose`, and peak memory unchanged at 634 MiB for a
40-megapixel RGBA source.

Blocking:

- **P1-A11 (new, from the repair).** The catch-all added for P1-A1 also
  covered the server's own encoding and `MemoryError`. With the P1-A3 delete,
  a server fault on a valid photo failed the file, deleted the upload and
  logged nothing.
- **P1-A9 (partly fixed).** The damaged-PNG test used an input the first tree
  already refused, so nothing pinned the wider error handling.

Non-blocking: **P1-A12**, the locked read (an existing repository method) does
not refresh a row already loaded in the session, so D10 depended on no earlier
reference being alive. Also noted and accepted as built: a failed delete of a
refused upload keeps the bytes until the person deletes the file; a damaged
animated GIF is reported as an unsupported file; scaled palette images fall
back to JPEG more often. Coverage gaps left: the 404 after a conflict, a
storage stat error, an invalid locator, the failed-delete warning and the
damaged-EXIF fallback.

#### Code Review #2 Revisions

Repair round 2 of 2.

| Finding | Disposition | Change |
| --- | --- | --- |
| P1-A11 | Accepted | Only the decode steps sit in the catch-all, and `MemoryError` propagates from it and from the opener. Encoding runs outside it, so a server fault raises, the row stays `uploaded` and the bytes stay. A refusal is now logged with its reason. Tests: a failing encoder at function level and through finalize. |
| P1-A9 | Accepted | The test uses a non-letter chunk name and first asserts that Pillow raises `SyntaxError` for it. |
| P1-A12 | Accepted | The locked read uses `populate_existing`. A PostgreSQL test holds a loaded row, changes it from a second session and reads it under the lock; it fails without the option. |
| Refusal message | Accepted | The "too detailed to store" message is asserted through finalize. |
| Remaining coverage gaps | Not taken | Each is a defensive branch with no behavior of its own beyond a status code or a log line. |

Verification: the check record above, on working tree `df7d9f2534bd` (taken before this line was filled in). The repair
budget is used; the next review is the final targeted recheck.

#### Code Review #3 Findings

Reviewed source: working tree `81eb22f7545b` (the repaired tree
`df7d9f2534bd` plus one plan line), high risk, final targeted recheck.

Both reviewers pass the phase. The checks reviewer reran every check from the
record (367 and 310 passed, schema byte-identical to `main`), ran 13 more
files that touch user-file rows or mount the router (405 passed, 1 skipped on
macOS), and showed the locked-read test fails without `populate_existing`. The
analysis reviewer confirmed P1-A11, P1-A9 and P1-A12 fixed: a server fault
(runtime, attribute, memory or decode-step `MemoryError`) leaves the row
`uploaded` with its bytes and `:process` completes it afterwards; the
52,000-input fuzz gives the same refusals as before with nothing escaping;
every new test fails under the mutation it targets; and `populate_existing`
cannot discard unflushed changes in any caller.

Non-blocking, not repaired in this phase because the repair budget is used:

- **P1-A13 / P1-C8.** An `OSError` from the server's own encoder is reported
  as a read failure (logged "User image read failed", answered 503), because
  the storage adapter wraps errors inside its `with` block. The upload is
  kept and `:process` completes it. Phase 2 edits the same router and fixes
  it under its own review.
- The `MemoryError` clauses and the opener's catch-all are verified by probes
  but not pinned by tests. Phase 2 adds a GIF frame-count test for the opener.
- **P1-C7.** The service's locked paths run against PostgreSQL in one test;
  the reviewers covered the rest with scratch probes.
- The Recovery sentence does not cover a commit that fails after the
  canonical write: the row stays `uploaded` with the canonical copy stored,
  and `:process` completes it.

Phase commit: `feat(chat)[p1]: store chat images as canonical copies`.

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

Starting revision: `4f5205edc`, the Phase 1 commit `0c150a155` merged with
`origin/main` at `c7b98f73a`. Built as planned, plus:

- **P1-A13 / P1-C8 (from Phase 1).** The router reads an image's bytes
  (`_read_private_file`) before decoding them, so a storage error is the only
  thing reported as a read failure. An encoder `OSError` now surfaces as
  itself and the upload is kept; the encoder-fault test covers `RuntimeError`
  and `OSError`.
- A GIF whose frame count raises `IndexError` pins the opener's catch-all.
- The route reads the stored copy into memory (at most 3.5 MiB) and checks its
  digest against the record: missing or changed bytes are `409`
  `user_file_content_changed`, a read error `503`. It answers with
  `local_file_response`, the policy content files use.
- `docs/backend/architecture/http-api.md` and the route list in
  `docs/backend/features/user-files.md` describe the route and the image
  behavior of `:finalize` and `:process`.

Check record (working directory: the checkout root unless noted; working tree
recorded under Code Review #1 Revisions; the frontend commands ran on tree
`dc7c88d731b3` and the repair touched no frontend file):

| Command | Result |
| --- | --- |
| `uv run --no-sync ruff format --check src/backend/animama tests` | exit 0 |
| `uv run --no-sync ruff check` | exit 0 |
| `uv run --no-sync mypy src/backend/animama tests` | exit 0, 907 files |
| `uv run --no-sync python scripts/repository-boundary/check-python-imports.py` | exit 0 |
| `timeout 900 uv run --no-sync pytest -q -n 2` on the 16 Phase 1 files | exit 0, 387 passed |
| `pnpm openapi-ts` then `pnpm openapi-ts:check` (in `src/frontend`) | regenerated; "Generated SDK is current (17 files)" |
| `pnpm packages:build` (in `src/frontend`) | exit 0 |
| `pnpm check` (in `src/frontend`) | exit 0 |

Not run: the package-set `compare`, which builds sets from an exact commit and
runs once on the final candidate before the pull request, and the full
pre-push suite (G3).

#### Code Review #1 Findings

Reviewed source: working tree `dc7c88d731b3` on `4f5205edc`, high risk,
initial review. Both reviewers pass the phase with no blocking findings.

The checks reviewer reran every recorded check (379 passed, SDK current,
`pnpm check` clean), added `pnpm packages:check` and `pnpm packages:test`
(61 tests), 17 more backend files on routing, admission and composition (600
passed, 1 skipped on macOS) and the package-set, repository-boundary and CI
script tests. An HTTP probe through the real local app showed the new route
gets exactly the status `GET /v1/files/{file_id}` gets for every request
shape: same-origin `fetch` and `<img>` 200; cross-site, same-site, foreign or
`null` Origin 403; wrong Host 421; desktop without the renderer cookie 401.

The analysis reviewer confirmed ownership (every non-servable case is the same
404, with no existence oracle), headers, the 3.5 MiB memory bound, thumbnails,
the P1-A13 fix, the contract bump and that no stale version remains.

Should fix:

- **P2-A1 / P2-C1.** A parent directory that became unreadable, or was
  replaced by a link, fails in the storage adapter before its own error
  handling, so the route answered a bare 500.
- **P2-A2.** Spec R3.3 also says deleting a chat removes its images' bytes;
  no phase did that, and one image can be attached in several chats.

Optional: describe the byte responses in OpenAPI (P2-A3; the content route
does not either); more tests (P2-A4); documentation details (P2-A5); the
upload now waits for a decode slot in memory rather than spooled (P2-A6).

#### Code Review #1 Revisions

Repair round 1 of 2.

| Finding | Disposition | Change |
| --- | --- | --- |
| P2-A1 / P2-C1 | Accepted | Reads from private storage map `OSError` and `PrivateFilePathError` to the 503 path, in the new route and in finalize; this is safe now that reading and decoding are separate. Test: read error, parent permission error and parent link, each 503. |
| P2-A2 | Accepted | D12: Phase 3 deletes a chat's images that no remaining chat message references. |
| P2-A4 | Accepted in part | Tests for missing bytes (409), the sandbox CSP header, aborted and delete-pending files, and a small image returned as its own thumbnail. |
| P2-A5 | Accepted in part | The `http-api.md` entry names the 503 and the thumbnail format; `auth-server.md` moves to Phase 7. |
| P2-A3, P2-A6 | Not taken | Undeclared byte responses follow the content route; P2-A6 is bounded by the thread pool and is small beside a decode. |

Verification: the check record above, on working tree `aa70448df83d` (taken before this line was filled in).

#### Code Review #2 Findings

Reviewed source: working tree `1c7205fceedb`, high risk, targeted recheck.
Pass, with no blocking findings. Probes through the real storage adapter gave
503 with the "User image read failed" log for an unreadable or linked parent
directory, on the new route, finalize and `:process`, and all three escaped as
500 with the old error tuple. Missing bytes stay 409. Mutations confirmed each
new test fails under the change it targets, and the encoder-fault test fails
if decoding moves inside the read's error handling. `ruff check`, `mypy`, the
16 files (385 passed) and `pnpm openapi-ts:check` reran clean.

Non-blocking: **P2-A7**, the finalize half of the repair had no test.

#### Code Review #2 Revisions

| Finding | Disposition | Change |
| --- | --- | --- |
| P2-A7 | Accepted | The finalize read-failure test covers a read error, a parent permission error and a parent link. Test-only, verified by running the file (65 passed) and the 16-file set (387 passed). |

Phase commit: `feat(chat)[p2]: serve chat images to their owner`.

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
   D7. Deleting a chat deletes the images only it references (D12), through
   the same storage delete and row status as `DELETE /v1/files/{file_id}`.
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

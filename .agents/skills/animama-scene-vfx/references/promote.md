# Promote to Included

Included content ships with the app. Promote a Scene Effect only when the
owner explicitly approves that item for Included content, on a task branch
whose PR they will review. Approval to save, preview or render is not
approval to promote.

## Before promoting

- The owner reviewed the saved Local item in the live preview on both
  Included Avatars, and it has not changed since.
- `pnpm -s effects check library:scene-effect/local/<name>` passes.
- Its images are PNGs (a promoted Scene keeps only PNG art) and it has no
  sound.
- Decide each item's mode with the owner: `add` (a new stem), `replace` (a new
  definition and images for an existing Included Scene of the same kind,
  keeping its folder, content ID, version and name) or `delete` (refused
  while any Included content depends on it).

## Promote

With the stack record sourced (Local items come from its
`ANIMAMA_LOCAL_CONTENT_HOST_PATH`), from `src/frontend/web`:

```bash
pnpm -s effects promote promote.json --dry-run
pnpm -s effects promote promote.json
```

```json
[
  { "kind": "scene_effect", "source": "library:local/Proud Radiance", "stem": "proud-radiance", "mode": "add" },
  { "kind": "scene_effect", "source": "library:local/Joy v2", "stem": "scene-vfx-emotion-joy", "mode": "replace" },
  { "kind": "scene_effect", "stem": "old-scene", "mode": "delete" }
]
```

It writes `content/included/vfx/scene/<stem>/` (descriptor and images) with
content ID `builtin:scene-effect:background:<stem>` or
`builtin:scene-effect:focus:<stem>` after its kind, after validating the
definition (runtime parse and shared limits) and re-checking each image
against its budget. A replace must keep the Scene's kind, which its ID names.
`name` and `description` may override the source's for an add; `description`
for a replace.

Licence records: an owner-authored Scene's PNGs fall under the rule
`vfx/scene/**/*.png`, and each written file gets the owner's
`licenses/source-review.json` record. Work the owner did not author carries
the owner-approved `licence` and `sourceReview` entries on its item (see the
Avatar Effect skill's promote reference; the `vfx/scene/awkward-silence/**`
rule shows the agent-authored wording): its own `vfx/scene/<stem>/**` rule and
its files' records. An image whose bytes repeat other Included art, such as a
built-in sticker, keeps that file's record, and its rule's terms in an
exact-path rule when the Scene's own rule grants other terms. A removed or
replaced third-party record (such as a Twemoji copy an old Scene carried) is
reported so its evidence files can be updated.

Reactions and Gestures that use the Scene are replaced in the same run from
creator project files, as in the Avatar Effect skill's promote reference;
dependencies on Local Scenes promoted in the run are re-pointed at their
Included IDs. Show the owner the dry-run list before writing.

## Afterwards

1. `git add` the new files: backend Included-content tests read tracked files
   only.
2. Update pinned expectations deliberately (Scene counts, presets and
   mappings in frontend tests).
   Ship new items in desktop core: add each content ID to `CORE_LIBRARY_ROOTS`
   in `src/backend/animama/runtime/starter_content.py` and its folder (plus the
   entry/file counts) to `CORE_LIBRARY_LOCATORS` in
   `tests/test_starter_content_closure.py`; that test fails while any valid
   Included item is left out of core.
3. Run `uv run pytest -q tests/test_included_content_integrity.py
   tests/test_included_content_catalog.py tests/test_starter_content_closure.py
   scripts/public-release/test_prepare_source.py`, then from `src/frontend`
   `pnpm check`, `pnpm web:lint`, `pnpm web:test` and `pnpm build`.
4. Do not change the starter loadout or equip anything unless asked.

A Local Reaction or Gesture that still names a deleted Included Scene keeps
playing without it and asks for repair in its creator; it is not migrated.

# Promote to Included

Included content ships with the app. Promote an effect only when the owner
explicitly approves that item for Included content, on a task branch whose
PR they will review. Approval to save, preview or render is not approval to
promote.

## Before promoting

- The owner reviewed the saved Local item in the live preview on both
  Included Avatars, and that item has not changed since.
- `pnpm -s effects check library:local/<name>` passes (for art on a hand or
  foot, with `--with-clip <gesture> --times …` in the pose it is used in).
- Decide each item's mode with the owner:
  - `add`: a new Included effect at a new stem;
  - `replace`: new art and settings for an existing Included effect (it
    keeps its folder, content ID, version and name, so Reactions and
    Gestures that use it pick up the change);
  - `delete`: remove an Included effect; refused while any Included content
    depends on it, so re-point those first.

## Promote

With the stack record sourced (Local items come from its
`ANIMAMA_LOCAL_CONTENT_HOST_PATH`):

```bash
pnpm -s effects promote promote.json --dry-run
pnpm -s effects promote promote.json
```

```json
[
  { "source": "library:local/Sweat Drop", "stem": "sweat_drop", "mode": "add" },
  { "source": "library:local/Eye O v2", "stem": "eye_o", "mode": "replace" },
  { "stem": "old_effect", "mode": "delete" }
]
```

`name` and `description` may override the source's for an add;
`description` for a replace. Effects with a sound cannot be promoted yet.

Reactions and Gestures that use the effects are replaced in the same run,
from creator project files (`animamaActionProject/1.0`) made from the
Included item: its clip (keeping the Included clip `id`) and its meta's
dependencies, with only effect events and dependencies changed. Each
dependency needs a `ref` (an Included content ID or a Local effect's `id`).
A project exported from the Action creator does not qualify as is: it
renames the clip and leaves out `ref`.

```json
{ "kind": "reaction", "stem": "anger-3", "source": "anger-3.json", "mode": "replace" }
```

Their dependencies may point at the Local effects the owner reviewed; each
one promoted in the run is re-pointed at its Included ID. The Included meta
(ID, version, name, placement hint) and the clip's id, role and lifetime are
kept, and Reactions stay expression-only. Deleting an effect is allowed once
the same run re-points every Reaction or Gesture that used it.

A **new** Gesture that uses a new effect is not added here: promote the
effect with `mode: "add"` first, then add the Gesture with
`pnpm -s animation promote` (`mode: "add"` with `dependencies` naming the
effect's `builtin:avatar-effect:<stem>` ID; see the `animama-animation`
skill's promote reference).

The tool validates each definition, its image names and its art, writes
`content/included/vfx/avatar/<stem>/`, removes files a replacement no longer
uses, and keeps `licenses/source-review.json` in step (the existing
`vfx/avatar/**/*` licence rule covers the files). Show the owner the dry-run
list before writing.

## Afterwards

1. `git add` the new files: backend Included-content tests read tracked
   files only.
2. Templates: a new effect becomes an Effects picker template only if the
   owner asks (`src/frontend/web/src/lib/effects/effectTemplates.ts`, then
   `pnpm -s effects:thumbnails <id>` and a source-review record for the
   thumbnail in the existing thumbnail form). Give chest or side art
   `thumbnail: { framing: "wide" }` and looping art that fades out at 1 s a
   `time`, and check every image. Regenerate thumbnails of replaced
   templates; remove a deleted effect's template, thumbnail and the
   thumbnail's source-review record (`effects promote` drops records only
   for effect files).
3. Update pinned expectations deliberately (effect counts and mappings in
   frontend tests such as `tests/avatar/reactionClips.test.ts`).
4. Run `uv run pytest -q tests/test_included_content_integrity.py
   tests/test_included_content_catalog.py tests/test_starter_content_closure.py
   scripts/public-release/test_prepare_source.py`, then from `src/frontend`
   `pnpm check`, `pnpm web:lint`, `pnpm web:test` and `pnpm build`.
5. Do not change the starter loadout or equip anything unless asked.

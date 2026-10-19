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
`description` for a replace.

The source effect must have no sound. A built-in effect plays licensed sounds
from the private comedy pack, as optional dependencies
([ADR 0022](../../../../docs/adr/0022-optional-licensed-effect-sounds.md)); a
merged effect declares several, and each Gesture or Reaction picks one with
its event override
([ADR 0025](../../../../docs/adr/0025-per-use-avatar-effect-overrides.md)). An
add names its sound with `"sound": "<key>"`, a key in the tracked pack manifest
(`src/backend/animama/resources/wow-comedy-sfx-manifest.json`), or sets
`"sound": null` for an effect the owner wants silent; a replace keeps the
effect's current sounds unless it names one (which replaces them) or `null`. A sound not yet in
the pack needs a new pack version first
([comedy sound pack](../../../../docs/backend/operations/comedy-sound-pack.md)).
Where several effects start together in a Reaction, keep one sound and set
`playAccompanyingSound: false` on the others.

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

A **new** Reaction is added in the same run with `mode: "add"` and its
placement hint (the project's clip id must be the stem; the name defaults to
the project's):

```json
{ "kind": "reaction", "stem": "joy-4-b", "source": "joy-4-b.project.json", "mode": "add",
  "placement_hint": { "emotion": "joy", "intensity": 4 } }
```

A **new** Gesture that uses a new effect is not added here: promote the
effect with `mode: "add"` first, then add the Gesture with
`pnpm -s animation promote` (`mode: "add"` with `dependencies` naming the
effect's `builtin:avatar-effect:<stem>` ID; see the `animama-animation`
skill's promote reference).

The tool validates each definition, its image names and its art, writes
`content/included/vfx/avatar/<stem>/`, removes files a replacement no longer
uses, and keeps the licence records in step. Show the owner the dry-run list
before writing.

Licence records: an item the owner authored falls under the existing
`vfx/avatar/**/*` rule, and each file it writes gets the owner's
`licenses/source-review.json` record. Work the owner did not author, such as
an effect or Reaction an agent made under the owner's direction, carries the
owner-approved licence entries on its item, in the form `animation promote`
takes them:

```json
{ "source": "library:local/Ink Mark", "stem": "ink_mark", "mode": "add", "sound": null,
  "licence": { "creator": "…", "provenance": "…", "license_id": "…", "redistribution_review": "pending" },
  "sourceReview": { "candidate_license": "…", "copyright": "…", "review": "…",
    "basis": { "ink_mark.json": "…", "ink_mark-sheet.png": "…" } } }
```

`licence` becomes the item's own rule (`vfx/avatar/<stem>/**`, ahead of the
general rule; a delete removes it) and `sourceReview` its files' records;
`basis` is one text or an object giving each file's. Word them like the
existing agent-authored entries (such as the `vfx/avatar/broken-heart/**` rule
and its files' records) and show the owner the exact wording. Items can share
one rule with `"glob"` in `licence`, such as `reactions/**/*` when every
Included Reaction has the same terms. A file that repeats other Included art
keeps that file's record, and its rule's terms when the item's rule differs.

## Afterwards

1. `git add` the new files: backend Included-content tests read tracked
   files only.
2. Templates: every Included Avatar Effect needs an Effects picker template
   (`effectTemplates.test.ts` checks): add it to
   `src/frontend/web/src/lib/effects/effectTemplates.ts` under the effect's
   promoted name, run `pnpm -s effects:thumbnails <id>`, and add a
   source-review record for the thumbnail in the existing thumbnail form.
   Give chest or side art `thumbnail: { framing: "wide" }`, art at the belly,
   hips or a lowered hand `framing: "body"`, art placed for a Gesture's pose
   that Gesture as `clip`, and looping art that fades out at 1 s a `time`
   (also the clip time). Check every image. Regenerate thumbnails of replaced
   templates; remove a deleted effect's template, thumbnail and the
   thumbnail's source-review record (`effects promote` drops records only
   for effect files).
3. Update pinned expectations deliberately: the Included Avatar Effect count
   in `scripts/animation-preview-media.test.mjs` and
   `scripts/effect-render-sources.test.mjs`, and effect mappings in frontend
   tests such as `tests/avatar/reactionClips.test.ts`.
   Ship new items in desktop core: add each content ID to `CORE_LIBRARY_ROOTS`
   in `src/backend/animama/runtime/starter_content.py` and its folder (plus the
   entry/file counts) to `CORE_LIBRARY_LOCATORS` in
   `tests/test_starter_content_closure.py`; that test fails while any valid
   Included item is left out of core.
4. Run `uv run pytest -q tests/test_included_content_integrity.py
   tests/test_included_content_catalog.py tests/test_starter_content_closure.py
   scripts/public-release/test_prepare_source.py`, then from `src/frontend`
   `pnpm verify` and `pnpm web:test:browser`.
5. Do not change the starter loadout or equip anything unless asked.

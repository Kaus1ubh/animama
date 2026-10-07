# Promote to Included

Promotion turns reviewed Local Gestures into Included content that ships with
the app. It changes distributed content and its licence record, so it is
never part of the normal workflow.

## Approval gate

Promote only when all of these hold:

- the owner has explicitly approved **each item** by name, including whether
  a replacement takes over the original's slug, content ID and Selector ID;
- the owner has approved **the licence entries**: the inventory rule's
  creator, provenance, `license_id` and `redistribution_review`, and the
  source-review record. Show the exact wording before writing anything;
- the work is on a task branch that goes through a PR.

Do not change the starter loadout (`starter-loadout.v1.json` and the backend
`EXPECTED_STARTER_GESTURE_IDS` together) unless the owner asks.

## Items

`items.json` reuses `animation:save`'s items and adds the promotion fields.
It is a working file: keep it in `.animama-drafts/` and record the approved
items and licence wording in the PR instead of committing it.

`clip` is the saved Local item the owner reviewed, as a Library source
(`library:local/<selector>`, resolved like `animation:preview` sources from
the sourced stack's `ANIMAMA_LOCAL_CONTENT_HOST_PATH`), or a clip file path
relative to the items file.

```json
[
  {
    "clip": "library:local/blow_kiss",
    "mode": "add",
    "name": "Blow a Kiss",
    "selectorId": "blow_kiss",
    "aiDescription": "Kisses the fingertips and sends the kiss forward ...",
    "description": "Optional Library description",
    "licence": {
      "creator": "...",
      "provenance": "...",
      "license_id": "LicenseRef-Animama-agent-authored",
      "redistribution_review": "pending"
    },
    "sourceReview": {
      "candidate_license": "AGPL-3.0-only",
      "basis": "...",
      "copyright": "...",
      "review": "prepared-not-release-approved"
    }
  }
]
```

- `mode: "add"` creates `content/included/gestures/<slug>/` with content ID
  `builtin:gesture:<slug>`. The slug defaults to the clip file name without
  `.clip.json` (a Local item's folder name); set `slug` to override it.
- `mode: "replace"` gives an existing Included Gesture new bytes. It keeps the
  folder, content ID, Selector ID, name and loop/one-shot kind, and refuses
  anything else. Use the original Selector ID and set `slug` to the Included
  folder: a Local copy's folder and Selector ID differ (such as `<original>-v2`).

The clip is validated like `animation validate` and stored as the compact
file the creator saves, pretty-printed, with `id` set to the slug and `name`
to the item's name.

## Run

From `src/frontend/web`, with the stack record sourced:

```bash
source ../../../.animama-stack.env
pnpm -s animation promote <items.json> --dry-run
pnpm -s animation promote <items.json>
```

The dry run lists every file it would create or update. The write:

- writes the Included clip and `<slug>.meta.json`. The frontend's built-in
  catalog bundles `content/included/gestures` directly, so there is no other
  copy to update;
- adds a `gestures/<slug>/*.json` rule to
  `content/included/licenses/inventory.json` ahead of `gestures/**/*.json`,
  whose owner-authorship attestation does not cover agent-made clips;
- adds or updates `licenses/source-review.json` records for the clip and
  metadata files;
- for a replacement, drops the replaced 1.0 clip's pinned samples from
  `poses/fixtures/starter-clip-samples-before-reduction.json`.

A second run of the same items as `replace` changes nothing.

## After promoting

1. `git add` the new files: the backend Included-content tests and desktop
   staging read tracked files only.
2. Update the pinned counts deliberately: `catalog.content.test.ts` (Gesture
   count, 2.0 count, pinned sample count, retained internal poses) and
   `includedGestures.test.ts` (2.0 Gesture count).
3. Run the backend Included-content tests (full `uv run pytest -q`
   preferred), `pnpm check`, `pnpm web:lint`, `pnpm web:test`, `pnpm build`,
   and the desktop runtime stage and audit.
4. In the PR, record the owner's approvals and the licence wording. Installed
   apps rehash a replaced item at startup (same logical ID, new revision);
   Local copies stay independent, and the owner may delete them once the
   Included version is confirmed.

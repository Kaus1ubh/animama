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
Clip paths are relative to the items file. Keep the file next to the clips
(for example `motion-authoring/examples/included-promotion.items.json`) so the
PR shows exactly what was approved.

```json
[
  {
    "clip": "./blow-a-kiss.clip.json",
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
  `.clip.json`; set `slug` to override it.
- `mode: "replace"` gives an existing Included Gesture new bytes. It keeps the
  folder, content ID, Selector ID, name and loop/one-shot kind, and refuses
  anything else. Use the original Selector ID, not a Local copy's provisional
  one (such as `<original>-v2`).

The clip is validated like `animation validate` and stored as the compact
file the creator saves, pretty-printed, with `id` set to the slug and `name`
to the item's name.

## Run

From `src/frontend/web`:

```bash
pnpm -s animation promote <items.json> --dry-run
pnpm -s animation promote <items.json>
```

The dry run lists every file it would create or update. The write:

- writes the Included clip and `<slug>.meta.json`;
- writes a byte-identical mirror in `src/lib/avatar/poses/json/clips/` and
  registers it in `pose_catalog.json` (the built-in fallback catalog);
- adds a `gestures/<slug>/*.json` rule to
  `content/included/licenses/inventory.json` ahead of `gestures/**/*.json`,
  whose owner-authorship attestation does not cover agent-made clips;
- adds or updates `licenses/source-review.json` records for the Included,
  metadata and mirror files;
- for a replacement, drops the replaced 1.0 clip's pinned samples from
  `poses/fixtures/starter-clip-samples-before-reduction.json`.

A second run of the same items as `replace` changes nothing.

## After promoting

1. `git add` the new files: the backend Included-content tests and desktop
   staging read tracked files only.
2. Update the pinned counts deliberately (`catalog.content.test.ts`: Gesture
   count, 2.0 count, pinned sample count, retained internal poses).
3. Run the backend Included-content tests (full `uv run pytest -q`
   preferred), `pnpm check`, `pnpm web:lint`, `pnpm web:test`, `pnpm build`,
   and the desktop runtime stage and audit.
4. In the PR, record the owner's approvals and the licence wording. Installed
   apps rehash a replaced item at startup (same logical ID, new revision);
   Local copies stay independent.

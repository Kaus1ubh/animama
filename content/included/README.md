# Included Content

This is the readable, application-shipped content library. It is mounted
read-only by the self-hosted stack and uses the same typed layout as `local/`.

Simple leaf content stays simple: a `.vrm`, supported image/audio file, or
self-describing JSON file can be an entry by itself. Shipped Gestures and
Reactions always use a product folder. Their `<stem>.meta.json` file describes
the Action, while `<stem>.vrma` or `<stem>.json` is the playable payload.
Action-owned Pose Clips are colocated; the retired `pose-clips/` folder is not
used.

The library ships 111 Gestures, 168 Reactions and 85 Avatar Effects; frontend
and backend tests pin these counts, so update them with any promotion. Twelve
of the Gestures are idle motions that seed every new Anima's Idle pool by
emotion and intensity (the `idle` section of
`src/backend/animama/resources/starter-loadout.v1.json`).
Idle plays while the Anima is quiet, so every Avatar Effect event in a seeded
idle Gesture sets `playAccompanyingSound: false`.

## Reactions

Reactions are chosen by the turn's emotion and one of four intensities. The
model's 1–10 intensity maps to them as 1–2 none, 3–4 Mild (1), 5–6 Moderate
(2), 7–8 Strong (3) and 9–10 Intense (4). Each step adds to the one below:

| Intensity | Included Reactions add |
| --- | --- |
| 1 | A full-strength facial expression only (one subtle Avatar Effect where two emotions' faces would look alike) |
| 2 | One or two Avatar Effects |
| 3 | A Particle Effect |
| 4 | A Scene Effect |

The ladder is guidance, not validation. Every Reaction's main expression
plays at full strength; the effects carry the escalation. Each emotion has
one Included Reaction at intensity 1 and two at intensities 2–4 (`<emotion>-<n>`
and `<emotion>-<n>-b`), and the second differs from the first in expression
and in at least one effect. Every starter cell holds all of its Included
Reactions, and chat plays one at random. Avatar Effects applied within 0.3 s of
each other play at most one accompanying sound, and an intensity-1 Reaction's
Avatar Effect plays without its sound.

`licenses/inventory.json` supplies the current provenance and redistribution
review state. Rules are ordered, with the first matching rule applied to each
file. The fallback project-owner assumption is historical development metadata,
not clearance. Excluded downloaded media stay private; each admitted asset
still needs the applicable terms and notices reviewed before public redistribution.

On 2026-09-02 the owner confirmed Annie's model is a VRoid free preset with no
external assets. On 2026-10-16 its grey hair-underside texture was recoloured to
match the outer hair. Its official pixiv preset terms are linked in the
inventory. Those terms are not CC0; review the planned product use, including
the restrictions on paid redistribution and character-creation services.
Andrew's starter uses `Andrew.vrm`, the owner's own VRoid Studio model, revised
on 2026-10-22 (new outfit, hair and proportions). On 2026-10-22 the owner set
both models' embedded VRM 1.0 metadata: the owner is author, everyone may use
them, personal commercial use is allowed, and so are redistribution and
modification. pixiv's VRoid terms still apply to their VRoid components.

Both files are produced with `pnpm -s vrm:optimize` (see
[VRM optimization](../../docs/frontend/runtime/vrm-optimization.md)), which
re-encodes textures as WebP and stores morph targets sparsely without changing
geometry, expressions or names. The owner metadata it applies is in
`src/frontend/web/scripts/vrm-optimize/included-meta/`. Andrew replaced Caitlyn's
`AvatarSample_Y_0` on 2026-10-19, which now survives only as
the test-only VRM 0 fixture `tests/fixtures/vrm/AvatarSample_Y_0.vrm`. R2's
earlier owner-created attribution remains withdrawn. Existing starter receipts
preserve their previous content and edits.

Rules with `"distribution": "excluded"` exclude the whole typed entry from
**both** desktop partitions; an excluded required starter dependency fails the
build. The former `AvatarChibi_2` and mistaken `AvatarSample_R2`, with their
generated portraits/metadata, are excluded this way. The owner's 2026-09-02
omission decision also excludes `voices/*`, `music/*` (including metadata), and
the four `appearances/tokyo-*` backgrounds with their matching thumbnails.
Generated starter portraits and the separately inventoried PocketTTS/model
assets remain available; excluding sample recordings does not disable speech.
Files remain available in the private development checkout. The exclusion is
not a deletion or an approval for other distribution paths, including a future
public source repository. User-imported local media remains supported.

`"distribution": "non-portable"` marks content that plays in the product but
never leaves it as files. It is also omitted from both desktop partitions: such
content ships only as its own private Included source, like the
[Mixamo-motion pack](../../docs/backend/operations/mixamo-motion-pack.md) and the
[comedy sound pack](../../docs/backend/operations/comedy-sound-pack.md), each
with its own tracked licence inventory under `scripts/<pack>/`. This library
holds no non-portable content. See
[ADR 0018](../../docs/adr/0018-non-portable-included-content.md).

A built-in Avatar Effect names at most one licensed sound from the comedy sound
pack through an optional dependency; some have none by design. Builds without
that pack, including this source tree, drop the edge when scanning and play the
effect silently
([ADR 0022](../../docs/adr/0022-optional-licensed-effect-sounds.md)). Never put
licensed or vendor preview sounds under `sfx/` here: the folder is ignored by
Git and Docker, and the preview files are restricted by hash.
Owner-provided typed Sound Effects remain supported.

Browser-engine dependencies such as ONNX runtimes, Basis decoders, workers,
fonts, and UI images remain frontend application assets.

## Retained avatar and effect artwork

The source library contains only the Annie (`AvatarSample_A_1_New.vrm`) and
Andrew (`Andrew.vrm`) models and their generated portrait pairs.

A portrait pair is `appearances/avatar-portraits/app-avatar-model-<stem>-v1.webp`
and `.meta.json`, linked to its model by `avatar_model` (the model's file stem).
To regenerate one after a model or renderer change:

1. In Chromium with a real GPU, load the production `Avatar` from the model's
   bytes with enhanced rendering on, hold the rest pose for one second, and
   call `captureAvatarPortrait` from `src/frontend/web/src/lib/avatar/portrait`
   at its defaults (1024 px, happy expression) with a front-facing camera
   (`new PerspectiveCamera()`). No committed command does this yet.
2. Reduce the capture with the backend's own canonicalizer, from the repository
   root:

   ```bash
   uv run python -c "import sys; from animama.app.services.content_image import canonicalize_avatar_portrait as c; sys.stdout.buffer.write(c(content=open(sys.argv[1], 'rb')).content)" capture.webp > portrait.webp
   ```

3. Replace the `.webp`, keep the file name, `content_id` and `name`, and set the
   `.meta.json` `width`/`height` (512) and `renderer_version` and
   `capture_preset_version` (the `AVATAR_PORTRAIT_*_VERSION` constants).
4. Update the portrait's provenance in `licenses/inventory.json` and its
   `portrait_sha256` in `../../licenses/third-party/art-vroid-review.json`.
Other sample models, portraits and the combined contact sheet have been retired.
Existing installations are not rewritten by this source cleanup; a saved
reference to retired Included content needs an explicit replacement.

The exclamation hover sprite and four dark/uneasy face overlays retain nine
original PNG assets authored for Animama under Raymond Van's ownership. They
contain no pixels from the retired textures. Canvas sizes and face-region
placement are retained, while the artwork is new. The earlier SVG masters and
one-off rendering command have been retired; edit the retained PNG assets and
keep each registered effect consistent with its matching authoring copy.
Rendered acceptance on both avatars is still required before release.

Effect art stays PNG here; edit the PNG. Packaged desktop and hosted builds ship
each descriptor-owned effect PNG as a WebP derivative where that is smaller (see
`src/backend/packaging/desktop/README.md`). Run rendered checks against a
packaged build when the WebP copy matters.

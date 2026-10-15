# Included Content

This is the readable, application-shipped content library. It is mounted
read-only by the self-hosted stack and uses the same typed layout as `local/`.

Simple leaf content stays simple: a `.vrm`, supported image/audio file, or
self-describing JSON file can be an entry by itself. Shipped Gestures and
Reactions always use a product folder. Their `<stem>.meta.json` file describes
the Action, while `<stem>.vrma` or `<stem>.json` is the playable payload.
Action-owned Pose Clips are colocated; the retired `pose-clips/` folder is not
used.

The library ships 111 Gestures, 72 Reactions and 73 Avatar Effects; frontend
and backend tests pin these counts, so update them with any promotion. Twelve
of the Gestures are idle motions that seed every new Anima's Idle pool by
emotion and intensity (`src/backend/animama/resources/starter-idle-pool.v1.json`).
Idle plays while the Anima is quiet, so every Avatar Effect event in a seeded
idle Gesture sets `playAccompanyingSound: false`.

`licenses/inventory.json` supplies the current provenance and redistribution
review state. Rules are ordered, with the first matching rule applied to each
file. The fallback project-owner assumption is historical development metadata,
not clearance. Excluded downloaded media stay private; each admitted asset
still needs the applicable terms and notices reviewed before public redistribution.

On 2026-09-02 the owner confirmed Annie's current model is an unmodified VRoid
free preset with no external assets. Its official pixiv preset terms are linked
in the inventory. Those terms are not CC0; review the planned product use,
including the restrictions on paid redistribution and character-creation
services. Do not edit embedded permission flags to manufacture clearance.
Caitlyn's version-6 starter uses `AvatarSample_Y_0`, an unmodified pixiv VRoid
sample whose embedded VRM 0 metadata declares CC BY with commercial use allowed;
credit pixiv VRoid Project. The owner approved it on 2026-10-01 and removed the
previous `AvatarSample_R1` model and portrait; R2's earlier owner-created
attribution remains withdrawn. Existing starter receipts preserve their previous
content and edits.

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
Caitlyn (`AvatarSample_Y_0.vrm`) models and their generated portrait pairs.
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

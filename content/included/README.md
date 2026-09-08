# Included Content

This is the readable, application-shipped content library. It is mounted
read-only by the self-hosted stack and uses the same typed layout as `local/`.

Simple leaf content stays simple: a `.vrm`, supported image/audio file, or
self-describing JSON file can be an entry by itself. Shipped Gestures and
Reactions always use a product folder. Their `<stem>.meta.json` file describes
the Action, while `<stem>.vrma` or `<stem>.json` is the playable payload.
Action-owned Pose Clips are colocated instead of being registered again under
`pose-clips/`; only deliberately reusable clips belong there. Idle-only VRMAs
belong inside their Idle Style.

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
Caitlyn's version-3 starter uses `AvatarSample_R1`, the model associated with
Janna, and its generated portrait. The owner corrected the earlier R2 selection;
R2's owner-created attribution is withdrawn. The owner confirmed Janna/R1 has
no external components and reports it rendered correctly. Existing starter
receipts preserve their previous content and edits.

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

The private comedy sound pack under ignored `sfx/comedy/1/` has no distribution
license. Shipped effects and the shy-finger-poke gesture intentionally omit its
decorative audio cues while retaining their visuals and motion. Desktop staging
admits tracked inputs only, so neither those sounds nor their metadata enter the
core or expanded-content pack. Existing private development files are not
deleted. Owner-provided typed Sound Effects remain supported.

Browser-engine dependencies such as ONNX runtimes, Basis decoders, workers,
fonts, and UI images remain frontend application assets.

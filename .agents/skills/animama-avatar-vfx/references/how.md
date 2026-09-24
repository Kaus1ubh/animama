# How to use the Avatar Effect creator

Use this reference to author content through Animama's UI. For why a mode behaves
as it does, read [What an Avatar Effect is](what.md).

Contents: [Open and prepare](#open-and-prepare) · [Choose placement](#choose-placement) ·
[Fit the art](#fit-the-art) · [Motion and sound](#motion-and-sound) ·
[Verify the region](#verify-the-region) · [Save and use](#save-and-use) ·
[Recipes](#recipes) · [Troubleshooting](#troubleshooting)

## Open and prepare

Use the available browser automation tool's documented interaction and file-upload
facilities. Inspect the current page and locate controls by their visible labels
or accessible names rather than assuming screen coordinates. Read screenshots for
visual judgment; a DOM snapshot alone cannot verify a rendered effect.

1. Find the existing app origin. `/a/avatar-effects/` redirects to
   `/a/avatar-effects/new`. Saved items reopen at
   `/a/avatar-effects/{avatarEffectId}/edit`. Do not hardcode a worktree's port or
   start/reset services merely to author content in an already running app.
2. Check whether the creator contains an unsaved or recovered draft. Continue it
   only if it belongs to this task. Preserve unrelated work before opening a new
   document; do not accept a discard prompt blindly.
3. Select the intended avatar with **Model**. Use **View → Face** for fitting and
   **Portrait** for normal-size readability. Preview selection is not an assignment
   of the effect to that Anima.
4. Choose **Hover**, **Face decal**, or **Texture** in **Effect Setup**. Use an
   explicit name in the header so the eventual Library item is easy to identify.
5. Use **Effect image → Browse** or drop one image. Accepted MIME types are PNG,
   JPEG, and WebP; the creator's size limit is 16 MiB. PNG or alpha-bearing WebP
   suits isolated symbols; JPEG cannot preserve transparency.

Wait for the image and avatar to finish loading before evaluating placement.
The upload preserves image bytes and framing. It does not crop transparent borders,
resize a sprite, remove its background, or split an atlas. If asset preparation is
needed, preserve the original and prepare a separate derivative within the task's
scope. Use the provided image-generation workflow when generating or editing art.

The fresh document defaults to Eye hover, mirroring and Skin backdrop enabled,
unit scale, zero offsets/rotation, no motion, and no sound. Set the requested subtype
explicitly; a symbol above the head should not inherit eye-hover behavior.

## Choose placement

### Hover

**Hover type → Face box hover** exposes **Placement**:

- Forehead left / middle / right.
- Top left / middle / right.
- Top edge left corner / left / middle / right / right corner.

Choose the nearest semantic position, then adjust offsets. Forehead placement is
useful for anger marks; top/edge placement is useful for floating punctuation,
hearts, sweat drops, and steam. These are placements around the face bounds, not
arbitrary body anchors.

**Hover type → Eye hover** exposes **Side**, **Skin backdrop**, and **Mirror right
eye**. The mirror label is shorthand: the runtime creates the selected primary
side and a reflected copy on its opposite side.

| Intended artwork | Side | Mirroring |
| --- | --- | --- |
| One-eye sprite shown on both eyes | Select the side the drawing was authored for | On |
| One-eye sprite on one eye only | Left or Right | Off |
| One image already containing both eyes | Both | Off; runtime places one plane between the eyes |

With Side = Both and mirroring off, the runtime does **not** duplicate a single-eye
sprite. With mirroring on, selecting one side does **not** limit rendering to that
side. Inspect both eyes before saving.

**Hover type → Mouth hover** uses one central mouth placement and exposes **Skin
backdrop**. Compare backdrop on/off if the underlying mouth competes with the art.
Automatic mouth flattening remains separate from this toggle.

### Face decal

Select **Anchor → Under eye**, **Blush**, or **Mouth**.

For Under eye and Blush, use **Layout → Single side** for a one-side drawing.
Choose **Side → Left/Right** and enable **Mirror opposite side** if a bilateral
result is wanted. Use **Span face** only for artwork intentionally drawn as one
wide image spanning both anchors. Mouth has no bilateral layout control.

**Image pivot** offers the nine combinations of top/center/bottom and
left/center/right. Use Center for ordinary cheek stamps; try Top center for a tear
that hangs below an eye. Pivots refer to the whole file rectangle, so transparent
padding may require an offset even with the correct pivot.

### Texture

Choose **Target material role**: Face skin, Eye iris, Eye highlight, Eyeline, or
Eyelash. Choose **Asset shape**: Single eye, Double eye, or Full face. Then choose
**Apply mode → Overlay/Replace**.

For iris art, start with Eye iris + Single eye. An explicit Left/Right side with
mirroring off affects that side; mirroring adds the reflected opposite side.
Side = Both uses the profile's two iris rectangles and its mirroring convention.
Combined eye artwork maps once across the combined eye layout. Do not treat these
controls as independent landmarks on every material role.

Use UV preview to verify what the selected material's texture actually contains.
Start with Overlay when the original appearance should remain. Use Replace when
the image is intended to supply the replacement texture; inspect transparent
areas and every affected part of the material.

Some runtime definitions contain additional fields such as `disableTargetRoles`.
The current creator does not expose or serialize every runtime option. Do not
invent a corresponding control or promise that opening and saving a template
preserves fields outside the editor document; inspect the exported definition
when that behavior matters.

## Fit the art

1. Keep animation off while fitting. In **Inspector → Transform**, adjust **Scale**
   to get the overall size, **Position Offset** to align it, and rotation to orient
   it. Hover offers XYZ **Rotation (degrees)**; texture modes offer **Angle
   (degrees)**. JSON rotations are radians.
2. Enable **Guides**. Open circles and faint lines mark the placement basis; solid
   pink outlines show the current artwork rectangle, including transparent margins.
   Dashed/reference bounds are not clipping masks. Treat estimated anchors as
   estimates, not proof of exact skin placement.
3. For decals and texture art, open **UV preview**. Select the relevant material
   and texture slot when several are available. Compare Reference, Artwork, and
   Pivot markings. **Skin coverage**, when available, shows flattening regions and
   the sampled patch. Face-box hover has no skin-texture footprint to inspect.
4. Inspect the face from the front and an oblique view using the preview's camera
   controls. Check hair occlusion and unwanted intersections for Hover, and seams
   or deformation for decals. Verify the avatar's left/right, not the screen's.
5. Return to Portrait to judge the actual silhouette and line weight. A good
   close-up can still become unreadable at normal size.

Make small changes and compare the result. Hover offsets are head-local 3D units;
decal/texture offsets are normalized texture coordinates. Do not copy numerical
offsets between those modes. Keep unused Z values neutral in texture modes.
For a mirrored decal, the runtime also reflects horizontal placement/pivot on the
opposite side; inspect that side after an asymmetric adjustment.

Play applies the current effect. Stop, and the current play toggle's inactive
state, clear it rather than preserving a frozen visible frame. Restart reapplies
from the initial animation state. Inactive guides may show placement references
without a live artwork outline. Camera and guide settings are preview-only.

## Motion and sound

In **Inspector → Animation**, enable only the motions the effect needs. Toggles
are independent, so combinations are supported.

| Motion | Controls | Practical use |
| --- | --- | --- |
| Pulse | Minimum/Maximum scale; Pulse speed (cycles/s) | A restrained emphasis or rhythmic anger mark |
| Spin | Spin speed (turns/s); Rotation range (turns); direction | Continuous spiral rotation, or rocking when range is below one turn |
| Drift | Drift X/Y per second | A slowly rising symbol or falling mark over a bounded Action event |

Pulse multiplies the authored scale. Drift accumulates continuously: test the
whole intended event duration, not just its first moment. Texture drift scales
with the full texture dimensions, while Hover drift scales with the plane's size.
Start texture drift conservatively. Restart between comparisons.

**Sound when applied** in Effect Setup selects a Sound Effect from the catalog;
the adjacent upload control can add sound when requested. The saved effect refers
to exact sound content. An Action event can disable the accompanying sound for
one occurrence. Do not add audio merely because the control is available.

## Verify the region

This is distinct from choosing where the art appears. Use the semantic region
that should govern replacement: `eyes`, `undereye`, `blush`, `mouth`, `emote`, or
`full_face`. Floating symbols normally use `emote`.

At source baseline `f09d5d7`, choosing a top-level kind sets a default region
(`eyes` for Hover, `undereye` for Face decal, `full_face` for Texture). Changing
the Hover subtype, decal anchor, or texture target does not synchronize it, and
there is no visible Region selector. Thus a new blush can retain `undereye`, and
a face-box symbol can retain `eyes`.

If that behavior still exists in the running version, use the supported JSON UI:

1. Finish type/subtype selection and open **Portable Avatar Effect JSON** through
   the toolbar's JSON action. Preserve the full exported editor document.
2. Change only the exported object's `document.region` to the intended value.
   For example, a floating anger mark needs `"region": "emote"` inside
   `document`. Retain the outer `schema: "animama/avatar-effect-editor/1"` wrapper
   and every unrelated authoring field.
3. Choose **Import**, paste the complete edited export, and apply it. Its replace
   prompt concerns the current unsaved document; proceed only with this task's
   draft and the full export preserved.
4. Reselect the original image in **Effect image**. Import deliberately drops
   browser-owned file bytes even though image metadata remains.
5. Preview again and re-export to confirm the region before saving. Switching
   top-level kind afterward can reset it again.

This is an existing authoring path, not a requirement to patch the application.
If a newer UI provides a correct Region control or automatic assignment, use it
and omit the workaround. Source check: `avatarEffectEditorReducer` and
`avatarEffectDefinition` in `src/frontend/web/src/lib/avatar/vfx/editor/document.ts`.

## Save and use

Save writes a Local catalog item with the image, definition, authoring data, and
optional sound dependency. An owned item updates at its expected revision;
editing an Included source creates a Local copy. It does not overwrite shipped
Included files. Choose a distinct name for a new variant.

Wait for a successful save and the stable `/edit` route. Then reopen the saved
item and check its image, placement, motion, region, and sound selection. Recovery
of an unsaved draft is not proof of persistence. Browser recovery can preserve
work across interruptions, but missing image bytes require reselection. On a save
failure, use the reported error and existing retry path; avoid repeatedly creating
new items or discarding preserved work. An uncertain result should be checked in
Library before retrying as a new effect.

Malformed definitions and missing image bytes block Save. A missing model binding
or anchor is a compatibility warning and may not block it. Treat that warning as
unfinished visual verification for that avatar. The frontend enforces its image
and runtime-definition checks; do not describe a successful server response as
proof of every renderer constraint. At the verified baseline, the backend content
handler is more generic than the documentation's strict-definition wording.

When the task includes playback integration, use **Use in… → Use in a Gesture**
or **Use in a Reaction** after saving. The handoff supplies the saved catalog item
ID and `avatar_effect` component type. In the Action creator, set the event's
Start and End, preview it with the other components, and save the Action. An end
may follow the Action or a specified duration; this is where timing belongs.
Use the app's Anima content selection workflow when equipping is requested.

An isolated creator preview shows one effect at a time. To verify combinations,
preview them together in a Gesture/Reaction. Test that the expected regions
coexist and that stopping or ending the Action clears its effects. Check the live
Anima separately if the requested outcome includes chat-triggered playback.

## Recipes

These are starting configurations, not universal scale/offset values. Fit them
to the chosen avatar and the image's actual framing.

| Intended result | Setup | Region and useful checks |
| --- | --- | --- |
| Angry forehead vein | Hover → Face box hover → a forehead placement | `emote`; static fit, then restrained pulse; check hair occlusion |
| Surprise/question mark, heart, steam puff | Hover → Face box hover → top/edge placement | `emote`; preserve silhouette; use Particle Effects for repeated emissions |
| Nervous sweat drop | Hover → Face box hover near a temple, adjusted with offsets | `emote`; a short downward drift needs a bounded event |
| Spiral eyes | Hover → Eye hover; explicit primary side + mirror | `eyes`; compare Skin backdrop, check both eyes and oblique view, then spin |
| One image containing a complete eye pair | Hover → Eye hover → Side Both, mirror off | `eyes`; one centered plane, so fit the pair as a whole |
| Cheek blush | Face decal → Blush → Single side + mirror; Center pivot | `blush`; verify fade/alpha against the actual skin and alongside tears |
| Crying stream | Face decal → Under eye → Single side + mirror; Top center pivot | `undereye`; account for top padding; check the stream follows the cheek |
| Cartoon mouth | Mouth hover, or Face decal → Mouth if it should follow skin | `mouth`; inspect flattening and mouth motion; backdrop applies only to Hover |
| Star iris | Texture → Eye iris → Single eye → Overlay initially | `eyes`; inspect the model's iris UV layout and original highlights |
| Sick/gloom face shading | Texture → Face skin → Full face → Overlay | `full_face`; use UV-matched art, check lips/eyes/seams and existing coloration |

## Troubleshooting

| Symptom | Check and response |
| --- | --- |
| Blank preview | Confirm avatar and image loaded, Play is active, and diagnostics show a binding. Check scale, placement, depth, and transparency before changing the model. |
| One centered spiral instead of two eyes | Eye hover with Side Both and mirror off is one centered plane. Enable mirroring for a one-eye sprite on both sides. |
| Unexpected second eye | Mirroring creates the opposite eye even with an explicit primary side. Disable it for a one-sided effect. |
| Tears/blush disappear when another effect starts | Inspect both effects' exported regions and the Action timing. Placement alone does not determine coexistence. |
| Large image outline but tiny visible art | Transparent margins count toward sizing. Adjust scale or prepare a tighter derivative; do not mistake padding for an anchor error. |
| Visible skin patch | Compare backdrop on/off, inspect Skin coverage and the sampled color, then examine the model/anchor assumptions. |
| Decal looks correct in UV view but wrong on the head | Inspect seams, projection estimates, selected binding, and mesh deformation in 3D. |
| Texture affects unexpected facial areas | Verify the target material and UV layout; consider an anchored decal for localized art. |
| Drift rapidly leaves the face | Texture drift is measured relative to the whole texture. Reduce it and retest over the intended duration. |
| JSON imported but Save needs an image | Reselect the actual image; the editor export contains no bytes. |
| Saved effect never appears during chat | Verify it is referenced by a saved, selected Gesture/Reaction, available in the mounted catalog, triggered at the intended time, and not suppressed by Disable VFX. |

## Source navigation

- Route/UI, upload, type-specific controls, preview and JSON dialogs:
  `src/frontend/web/src/ui/avatar-effect-creator/AvatarEffectCreatorPage.tsx`.
- Initial values, region handling, export wrapper and validation:
  `src/frontend/web/src/lib/avatar/vfx/editor/{defaults,document,types}.ts`.
- Save, reopen/recovery ownership: `useAvatarEffectSave.ts` in the creator folder;
  `createAvatarEffectDocumentFromDefinition` in the editor document module.
- Motion labels and conversions: `AvatarEffectAnimationControls.tsx` in the
  creator folder.
- UV controls: `AvatarEffectUvPreview.tsx` in the creator folder.
- Post-save navigation: `src/frontend/web/src/ui/content-creator/CreatorEffectHandoffActions.tsx`.

Finish with a compact handoff: saved item names and edit URLs, preview model,
chosen modes/regions, which of visual preview, reopen, combined Action playback,
and live Anima playback were verified, and any unresolved warnings.

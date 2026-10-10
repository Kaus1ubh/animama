# Batch mode

Use batch mode when the owner asks for several Scene Effects at once (up to
ten per batch; split larger requests), for example one background per emotion
of a family. It follows the Avatar Effect skill's batch reference
(`.agents/skills/animama-avatar-vfx/references/batch.md`): briefs confirmed
together, items in parallel, a consistency pass, one review preview and one
save run. Scene specifics:

## 1. Briefs together

| Name | Stem | Expresses / trope | Kind | Reactions (tiers) | Layers | Duration | Art |
| --- | --- | --- | --- | --- | --- | --- | --- |

Emotions of one family share its layers and motion and differ in palette and
details; families differ from each other. Stems are unique, lowercase with
`-`, and not an Included stem unless the item replaces that Scene.

## 2. Items in parallel

Each subagent receives its confirmed brief, this skill,
`animama-effect-assets`, its folder (`.animama-drafts/effects/<stem>/` at the
repository root) and these instructions:

- make the images (with the batch's shared style guide and style reference
  image), write the effect folder, run `effects check` (fix every FAIL) and
  render sheets to its work folder;
- read its own sheets and revise until the Scene reads as the brief with the
  face clear;
- do not save, start a preview for the owner, or touch other items;
- return the folder, the check summary, the sheet paths and what it could not
  judge.

Never run two `effects save` runs at once (they share one app).

## 3. Consistency pass

Compare the items side by side: one art style, palettes that separate the
emotions, matching motion speeds within a family, and the calm zone behind
the face. Render a Scene with the Reactions it will play in
(`effects:render <folder> --with-clip library:reaction/<name>`).

## 4. One review session

Keep the folders side by side in `.animama-drafts/effects/` and start one
preview with the first (`pnpm -s animation:preview
../../../.animama-drafts/effects/<first stem>`). Its **Effect sources** list
every effect folder beside it. Show each brief while the owner looks; apply
and resolve each note.

## 5. Save the batch

One items file listing every approved folder, then `pnpm -s effects save
<items.json>` once. Report each saved name and URL.

# Batch mode

Use batch mode when the owner asks for several Particle Effects at once (up
to ten per batch; split larger requests). It follows the Avatar Effect
skill's batch reference (`.agents/skills/animama-avatar-vfx/references/batch.md`):
briefs confirmed together, items in parallel, a consistency pass, one review
preview and one save run. Particle specifics:

## 1. Briefs together

One table to confirm:

| Name | Stem | Expresses / beat | Mechanic | Reactions (tiers) | Anchor | Duration | Budget | Art |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

Stems are unique, lowercase with `-`, and not an Included stem unless the item
replaces that effect.

## 2. Items in parallel

Each subagent receives its confirmed brief, this skill,
`animama-effect-assets`, its folder (`.animama-drafts/effects/<stem>/` at the
repository root) and these instructions:

- make the textures (with the batch's shared style guide and style reference
  image), write the effect folder from the closest Included effect, run
  `effects check` (fix every FAIL) and render sheets to its work folder;
- read its own sheets and revise until the effect reads as the brief;
- do not save, start a preview for the owner, or touch other items;
- return the folder, the check summary (estimate against budget, accepted
  WARNs), the sheet paths and what it could not judge.

Renders and image generation are slow; never run two `effects save` runs at
once (they share one app).

## 3. Consistency pass

Compare the items side by side: one texture style (glow softness, outline,
palette), matching scale at the same anchor, loudness that matches the tiers,
and budgets that are honest. Render effects that will share a Reaction
together (`effects:render a b --together`), and for a Reaction already using
other effects measure it with `effects:bench --reaction`.

## 4. One review session

Keep the folders side by side in `.animama-drafts/effects/` and start one
preview with the first (`pnpm -s animation:preview
../../../.animama-drafts/effects/<first stem>`). Its **Effect sources** list
every effect folder beside it. Show each brief while the owner looks; apply
and resolve each note.

## 5. Save the batch

One items file listing every approved folder, then `pnpm -s effects save
<items.json>` once. Report each saved name and URL.

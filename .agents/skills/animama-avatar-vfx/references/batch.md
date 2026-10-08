# Batch mode

Use batch mode when the owner asks for several effects at once (up to ten
per batch; split larger requests). Each item follows the normal workflow;
the batch confirms every brief at once, works on items in parallel, and
ends with one review preview and one save run.

## 1. Briefs together

Send any interview questions for all items in one message, then show one
table of briefs to confirm:

| Name | Stem | Expresses / beat | Attachment | Reactions (tiers) | Motion, duration | Art |
| --- | --- | --- | --- | --- | --- | --- |

Check the stems: unique, lowercase with `_`, and not an Included stem unless
the item is meant to replace that effect.

## 2. Items in parallel

When the host can run subagents, give each item its own, about five at a
time. Each receives its confirmed brief, this skill, `animama-effect-assets`,
its folder (`.animama-drafts/effects/<stem>/` at the repository root) and
these instructions:

- make the art, write the effect folder, run `effects check` (fix every
  FAIL) and render sheets to a scratch directory;
- read its own sheets and revise until the effect reads as the brief;
- do not save, start a preview for the owner, or touch other items;
- return the folder, the check summary with accepted WARNs, the sheet paths
  and what it could not judge.

Image generation and renders are slow; never run two `effects save` runs at
once (they share one app).

## 3. Consistency pass

Compare the items side by side before the owner sees them: one art style
(outline weight, palette, shading), matching scale for the same attachment,
and loudness that matches the intended tiers. Render effects that will share
a Reaction together (`effects:render a b --together`). Fix outliers and
re-run `effects check` on changed items.

## 4. One review session

Keep every item's effect folder side by side in `.animama-drafts/effects/`
and start one preview with the first (`pnpm -s animation:preview
../../../.animama-drafts/effects/<first stem>`). Its picker lists every
effect folder beside it under **Effect sources**; tell the owner to pick each
item there and show its brief alongside. Apply each note, resolve it with
`animation resolve`, and ask the owner to look again.

## 5. Save the batch

Write one items file listing every approved folder and run
`pnpm -s effects save <items.json>` once. Report each saved name and URL.

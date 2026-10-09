---
name: animama-effect-assets
description: Turn an art brief into clean, budgeted PNGs for Animama effects — single images and flipbook sheets with real transparency, fully opaque art, trimmed margins and sizes within budget — by generating images (optionally with the global image-gen skill) or taking supplied art, then checking, fixing and previewing them with `pnpm -s effects:assets`. Use when an Avatar Effect (or a Particle or Scene Effect texture, sprite sheet or tile) needs new or repaired artwork; placing art in an effect and saving it belong to the effect skills.
---

# Animama Effect Assets

Produce the image files an effect uses. The output is one or more PNGs that
pass `effects:assets check` and look right on dark and light backdrops; the
effect skill (`animama-avatar-vfx`, or the particle and scene skills) then
places them. The app and its tests never depend on how the art was made: an
image generator, a hand-drawn file and an edited Included image all go through
the same checks.

Commands run from `src/frontend/web`, and relative paths resolve from the
directory you run `pnpm` in. Work in the repository root's `.animama-drafts/`
(ignored by Git; `../../../.animama-drafts/` from `src/frontend/web`):
sources and previews in `.animama-drafts/effects/<stem>-work/`, final images
in the effect folder `.animama-drafts/effects/<stem>/`. Never write
`content/included/` (promotion is a separate, owner-approved step of the
effect skill).

## Pipeline

1. **Read the brief.** It states the gag (the comedic or emotional beat and
   the anime trope it borrows), what the art shows, the attachment (which
   sets the budget), whether it is a flipbook, colours, and how it should
   read at a glance. Animama's Avatar and Scene Effects exist to make an
   interaction funny the way anime is: they are the symbols (manpu) an anime
   or manga artist draws on a character for a gag — the anger vein, the
   sweat drop, swirl eyes, "> <" squeezed eyes, the deadpan bar eyes of a
   Frieren reaction face — not decorative illustrations. Name the trope and
   a well-known example in every prompt; the art should read as that joke
   instantly at chat size. Keep shapes iconic and exaggerated (like the
   symbol itself, or its emoji), with bold silhouettes, flat colour and few
   details; fine detail and text disappear at chat size.
2. **Get source images.** Use supplied art when there is any (owner art
   wins over generated art). Otherwise, if
   the global `image-gen` skill is available, generate one image per asset
   with the prompt template below (`gen.sh --out <draft folder>/<name>-src.png`,
   a Bash timeout of at least 300000 ms). For variants of one design use
   `--n`; for a revision of an image use `--edit`; to keep a set consistent
   (flipbook frames, a left and right eye) pass the first image as `--ref`.
   Without a generator, ask for art rather than drawing placeholder shapes in
   code, unless the brief asks for simple geometric art.
   **Several images at once:** generation is the slow step (30–90 s each),
   so start independent images together, a few at a time (two to four): put
   the `gen.sh` calls in one shell command joined with `&` and ending in
   `wait` (a job left running when its shell exits dies silently). On a
   rate-limit or busy error, wait and retry once. The Read tool shows
   transparency as black; judge alpha with `effects:assets preview`. Flipbook frames that
   `--ref` the first frame start after the first frame exists. Give every
   image of a library the same style reference with `--ref` (edits too:
   `--edit <file> --ref <style>`) and say in the prompt that it sets the line
   weight and shading, not the subject.
3. **Look at every image** with the Read tool before anything else. Reject
   and regenerate (once, with one targeted prompt change) art with the wrong
   subject, extra objects, text, cropped edges or a style that does not match
   the set.
4. **Check:** `pnpm -s effects:assets check <png...> --budget <name>`. FAIL
   lines must be fixed; WARN lines need a look.
5. **Fix:** `pnpm -s effects:assets fix <src.png> --out <effect
   folder>/<name>.png --budget <name> [options]`. `--budget` also shrinks the
   art to the budget (check's "fix --max N" hint is the same thing). Choose
   options from the check:
   - `checkerboard` or `solid_background` → `--remove-background`;
   - `near_opaque` or `faint_alpha` → nothing to add (fix raises alpha ≥ 250
     to 255 and clears alpha below 4 by default);
   - `interior_translucency` → `--solid-interior`, unless the brief wants
     see-through art (glows, tears, shades); `--budget surface` never reports
     it, since painted tints are see-through by design;
   - `padding` → `--trim --pad 8 --square` for floating, body and sticker
     art (`--pad` is in output pixels, after shrinking to the budget).
   - Painted art placed by its framing (an iris pattern, a decal): `--canvas
     <px> --art-size <px>` trims the art, scales it to `art-size` and centres
     it on a `canvas` square, so redone art keeps the same framing (match the
     effect it replaces, e.g. a 168 px star on a 512 canvas). That is the
     only reframing for **face-surface** art: never trim, pad or square art
     laid over the face texture's UV layout (`area: full`, spans; `--budget
     surface` refuses those options), and never use `--canvas` on it.
   `fix` never overwrites its input and checks its output; it also bleeds edge
   colour into transparent pixels so filtering shows no fringe. An unreadable
   file is reported as `unreadable` and the rest of a batch is still checked.
6. **Preview:** `pnpm -s effects:assets preview <name>.png --out
   <name>-preview.png`, then Read the preview. It shows the art on a dark, a
   light and a checkered backdrop. Halos, grey edges, dark smudges and holes
   show here. `--solid-interior` fixes only alpha: a smudge painted into the
   colour means regenerate or edit the source.
7. **Flipbooks:** make each frame as its own image (same canvas and framing;
   `--ref` the first frame), fix each frame with the same options, then
   `pnpm -s effects:assets flipbook <frame...> --out <name>.png [--trim]
   [--cell 256] [--columns N] --fps <n> [--loop loop|once|pingpong]`. Leave
   frames untrimmed in `fix` and pass `--trim` here: it crops every frame to
   one shared box, so the frames keep their positions relative to each
   other. Frames read left to
   right, top to bottom. It prints the `art.flipbook` fragment for the
   definition. Frames fitted into `--cell` are resampled, then their alpha is
   settled again (faint cleared, near-opaque raised) and their edges bled.
   Preview the sheet and check frame-to-frame consistency.
8. **Hand off** the final PNG paths, their sizes and check results, the
   preview images, and what you rejected or could not fix. Delete rejected
   source images you created unless asked to keep them.

## Budgets

`--budget` sets the longest side and file size and checks them:

| Budget | Use | Longest side | File size |
| --- | --- | --- | --- |
| `landmark` | Floating face art: eyes, marks, emotes above the head | 512 px | 256 KiB |
| `surface` | Painted on the face (keeps its layout) | 1024 px | 512 KiB |
| `body` | Art on a body point | 512 px | 256 KiB |
| `sticker` | Sticker beside the Avatar | 512 px | 256 KiB |
| `silhouette` | Silhouette overlay art | 1024 px | 512 KiB |
| `flipbook` | A whole flipbook sheet; frames near 256 px | 2048 px | 1024 KiB |
| `particle-texture` | One Particle sprite | 512 px | 256 KiB |
| `particle-sheet` | A Particle sprite sheet; tiles near 256 px | 2048 px | 1024 KiB |
| `scene-sticker` | A Scene marquee item | 512 px | 256 KiB |
| `scene-tile` | A repeating Scene pattern tile (may be opaque; keeps its margins) | 512 px | 256 KiB |
| `scene-background` | A full Scene background (may be opaque; keeps its framing) | 2048 px | 1024 KiB |

Exceed a budget only when the brief justifies it; the app's hard limits still
apply: 4096 px and 16 MiB for Avatar Effect images, 2048 px and 4 MiB for
Particle textures (sheets up to 16 × 16 tiles), 4096 px and 8 MiB for Scene
images. `check` reports the hard limit of the budget's kind. Particle sheets
are assembled with `flipbook` like Avatar Effect flipbooks; its grid becomes
the emitter's tile counts. `scene-tile` and `scene-background` art may be
fully opaque (a painted checkerboard still fails), and like face-surface art
it keeps its size and margins (no `--trim`, `--square` or `--pad`).

Face-surface art for a whole part (face skin, irises, lashes) must match that
part's UV layout; generate it over the creator's UV guide or edit an existing
Included image. Decal areas (under-eye, cheeks, mouth) take centred art like
floating effects. See the `animama-avatar-vfx` references.

## Prompt template

Keep one subject per image. Use only the lines that help:

```text
Use case: anime comedy symbol (manpu) drawn over a 3D anime avatar (<attachment, e.g. floating beside the head>)
Gag: <the beat it lands and the trope it borrows, e.g. "caught out and embarrassed: the classic anime sweat drop on the temple">
Reference: <a well-known example of the trope, e.g. "the deadpan bar eyes of Frieren's reaction face", or the matching emoji>
Subject: <one symbol, e.g. a single big sweat drop>
Style/medium: the symbol as an anime artist draws it for a gag: iconic, exaggerated, flat colour (cel shading only where the trope has it), bold clean shape, 2–3 colours, no gradients unless asked
Colour palette: <colours from the brief>
Composition: the subject centred and filling most of a square canvas, nothing cropped
Background: fully transparent (real alpha channel), no checkerboard, no backdrop, no shadow
Text (verbatim): <exact text, or none>
Avoid: faces, extra objects, frames, borders, watermarks
```

For a flipbook frame add "frame N of M: <what changes>", keep the canvas and
framing identical, and pass the first frame as `--ref`. For an edit, state
what changes and what stays the same.

## Failures

- The generator returns an image with no alpha: check reports `no_alpha`;
  regenerate once with the transparency line, then try
  `--remove-background` if the backdrop is flat or checkered. Never fake
  transparency by hand.
- Codex is not logged in, times out or refuses: follow the `image-gen` skill's
  failure guidance and report it. The effect waits; do not substitute
  code-drawn art for a brief that needs illustration.
- `budget_bytes` after fixing: the art is too noisy (gradients, texture
  grain). Regenerate with "flat colours, no texture" rather than raising the
  budget.

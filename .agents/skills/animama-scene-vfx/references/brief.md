# Brief and interview

Every Scene Effect starts as a short written brief. The art, the layers, any
Reaction assignment and the owner's review are judged against it.

## Interview

Ask only what would change the effect, a few questions at most, each with
your recommended answer first. Typical ones:

- **What it expresses and when:** "A warm glow with slowly turning rays for
  pride and confidence Reactions, tier 2?"
- **Background or focus lines:** a full background behind the Avatar
  (`background_layers`) or comic speed lines aimed at the face
  (`focus_lines`)?
- **How loud:** a quiet mood wash (intensity 1–2) or a big comic beat (3,
  perhaps with an entry flash)?
- **How long:** held while the Reaction plays (cleared by the clip), or a
  timed beat?

Skip the interview when the request already answers these or the owner says
to use your judgement; state the choices you made in the brief. An emotion
background follows its approved family design (layers, palette, motion) when
one exists; ask before departing from it.

## Brief template

```markdown
### <Name> (`<stem>`)

- **Expresses:** <emotion or situation, one line>
- **Trope:** <the anime background or screen effect it borrows, with a
  well-known example>
- **Reactions:** <emotions and intensities 1–4 it suits, or "preview only">
  Avatar Effects first appear at intensity 2, Particle Effects at 3 and Scene
  Effects at 4 (the Reaction ladder in `content/included/README.md`); an
  effect proposed for a lower intensity records why.
- **Kind:** background_layers | focus_lines
- **Layers (back to front):** <each layer, its job and motion, e.g.
  "Glow: radial gradient #fff4d1 → #f2b86a centred behind the head, static.
  Rays: 18 soft rays from the same centre, 35 % opacity, one turn a minute.
  Glints: 10 twinkling glint stickers, still, kept off the face">
- **Face:** <how the calm zone behind the head is kept>
- **Duration:** <held (null) or milliseconds; dismissed by input?>
- **Art direction:** <what each image shows, palette, outline; reused
  Animama stickers>
- **Budget:** <`scene-sticker` per item image, `scene-tile` for a tile;
  counts against the scatter limits (96 items in all)>
```

## Good briefs

- One mood per Scene. Each layer has one job; three to four layers usually
  suffice.
- Comedy and drama come from the trope: gloom lines for dejection, rays for
  pride, shock lines and a flash for alarm, spirals for nausea.
- Keep it behind the joke: the Avatar's face and any Avatar or Particle
  Effect on it must stay readable.
- Match intensity: tier 1 is a light tint or nothing; tier 3 can fill the
  screen.
- Name stems in lowercase with `-` (`proud-radiance`).

# Brief and interview

Every Particle Effect starts as a short written brief. The art, the emitter
settings, any Reaction assignment and the owner's review are judged against
it.

## Interview

Ask only what would change the effect, a few questions at most, each with
your recommended answer first. Typical ones:

- **What it expresses and when:** "A few glossy glints twinkling among soft
  bokeh around the head when the Anima is admiring something — for
  admiration and gratitude Reactions?"
- **How loud:** a small accent (intensity 1–2) or a big comic beat (3)?
- **Mechanic:** one long-lived particle, a burst, a stream, an orbit, rain or
  layered pops (see below)?
- **How long:** a quick pop (under 1 s), a few seconds, or held while the
  Reaction plays?

Skip the interview when the request already answers these or the owner says
to use your judgement; state the choices you made in the brief.

## Brief template

```markdown
### <Name> (`<stem>`)

- **Expresses:** <emotion or situation, one line>
- **Beat:** <the moment it lands; the anime trope or selfie-filter polish it
  borrows, with a well-known example>
- **Reactions:** <emotions and intensity tiers 1–3 it suits, or "preview only">
- **Mechanic:** <one long-lived particle | burst | stream | orbit | rain |
  layered pops> — <one line on how it moves>
- **Layers:** <each emitter, front to back, and how they fit: e.g. "five
  glossy glints that scale in and out at their own pace, over a dozen soft
  bokeh discs drifting slowly, behind a faint warm glow">
- **Anchor and placement:** <head | chest | … ; offset; follows the anchor or
  stays in world space>
- **Duration:** <whole-effect playback seconds; each emitter's cycle and
  particle lifetime if it matters>
- **Art direction:** <what each texture shows, colours, glow; single sprites
  or a sprite sheet with its tile grid; built-in textures reused>
- **Budget:** <declared maximum particles (at most 512) and the expected
  estimate of particles alive at once; texture budgets `particle-texture` /
  `particle-sheet`>
```

## Mechanics

The mechanic is how the particles are emitted; most effects are one of these
or a stack of them (one emitter each, up to 16):

| Mechanic | Emitter settings | Included example |
| --- | --- | --- |
| One long-lived particle | a single burst of 1, long `startLife`, motion from Size/Color/Rotation Over Life | the exclamation-mark emitter of `surprise-shock-pop` |
| Burst | `emissionOverTime` 0, one burst at time 0 with `count` N, short cycle, not looping | `sparkles`, `surprise-shock-pop` |
| Stream | steady `emissionOverTime`, looping emitter, a cone or sphere shape | `hearts-v1` |
| Orbit | OrbitOverLife (and Noise for wobble) around the anchor | `confusion-orbit-marks` |
| Rain | particles born above the head falling under ForceOverLife, often below a puff emitter | `rain-cloud` |
| Layered pops | several short emitters (ring, symbol, flares, streaks) with staggered bursts | `magic-sparkle-burst` |

## Good briefs

- One idea per effect. "Glints twinkling among bokeh" reads instantly; a
  shimmer plus a heart burst plus confetti is three effects that can play
  together.
- Particle art is glossy polish (glows, glints, bokeh, soft streaks), built
  as hero, halo, sparkles and extras (see the skill's decision rules); Scene
  art is flat background motifs. A gag symbol drawn on the character is an
  Avatar Effect, not a particle effect. An effect's layers share one style.
- Match intensity: tier 1 is a subtle accent or nothing; tier 3 can be loud.
  Not every Reaction needs a particle effect.
- Keep the budget honest: declare the smallest maximum that covers the
  estimate (`effects check` prints both).
- Name stems in lowercase with `-` (`twinkle-shimmer`), like Included Particle
  Effects.

# 0025: Per-use Avatar Effect overrides

- Status: accepted (owner, 2026-10-14)
- Recorded: 2026-10-14
- Retrospective: no
- Original decision date: 2026-10-14 (owner decisions Q1–Q5 and the plan
  review in [issue #543](https://github.com/raymond-van/animama/issues/543))
- Decision basis: [issue #543](https://github.com/raymond-van/animama/issues/543)
  and the [execution plan](../plans/avatar-effect-overrides-flipbooks/avatar-effect-overrides-flipbooks-execplan.md)
- Amends: [ADR 0022](0022-optional-licensed-effect-sounds.md) (a built-in
  effect's number of sounds)

## Context

An Avatar Effect bundled its art with its placement, look, motion and sound.
The `avatar_vfx` clip event that plays it chose only the effect, its timing and
fades, and whether its sound plays. Every Gesture that needed the same art in
another place therefore needed another Library item. Of 75 Included effects, 34
shared 11 images, most used by a single Gesture, and `_left` copies existed only
to mirror a hand. Particle events already carried their own anchor and
transform. The variants of one image often played different sounds, which
[ADR 0022](0022-optional-licensed-effect-sounds.md) limited to one per effect.

## Decision

1. **The event may override the effect for one use.** An `avatar_vfx` event's
   optional `override` holds any of `attachment`, `appearance`, `motion` and
   `soundAlias`. Each part present replaces the effect's part whole. The
   attachment keeps the effect's kind. Art, region, face options and the set of
   sounds stay with the effect.
2. **One definition source.** The existing `animama/avatar-effect/2` models
   validate each part (`AvatarEffectEventOverride`), and
   `AvatarEffectDefinitionV2` validates the merged definition. Clip validation
   checks the shape. Save and package import/export also check the merged
   definition against the effect the event names, when that effect is
   available, naming the failing field. Playback skips an event whose merged
   definition is invalid.
3. **Several sounds per built-in effect.** A built-in effect may declare several
   optional pack sounds; `definition.soundAlias` names the default, and an
   override's `soundAlias` picks another. An unknown or unmounted alias plays
   silently, as an effect without its pack does today.
4. **Merging duplicates.** The Included library merges effects that share art
   into one family effect wherever an override can reproduce each of them (an
   effect whose face options cannot apply to the family's placement stays
   separate). One tracked mapping rewrites
   both Included Actions and, through the content transition, Local Actions
   that name a removed effect.

## Alternatives considered

- **Field-by-field merging.** It would need partial models for every part and a
  way to remove a value; replacing whole parts reuses the existing models.
- **Placement-only overrides.** Variants that differ in motion or sound would
  remain separate Library items.
- **Merging only variants with the same sound** (17 effects instead of 9). It
  keeps ADR 0022 unchanged but leaves visibly duplicate items.
- **Sounds as Action `sfx` events.** Licensed pack sounds are reachable only
  through effect edges and cannot be used by Local content.

## Consequences

- One effect serves many Gestures and Reactions, and the Action creator edits
  per-use placement, look, motion and sound.
- Effects keep a meaningful default; an event without an override plays it
  unchanged, so existing content needs no migration for overrides alone.
- The glossary's division of ownership changes: the effect owns its art and
  defaults, and the event may adjust them for its use.
- Removing a merged variant leaves Local Actions working through the content
  transition; an Action whose rewrite fails plays without the effect, as any
  Action naming a removed effect does.

## Evidence

- [`app/contracts/avatar_effect.py`](../../src/backend/animama/app/contracts/avatar_effect.py):
  `AvatarEffectEventOverride` and `merge_avatar_effect_override`.
- [`app/services/avatar_effect_overrides.py`](../../src/backend/animama/app/services/avatar_effect_overrides.py):
  the checks Save, package import/export and clip validation share.
- [`tests/fixtures/idle-playback-cases.json`](../../tests/fixtures/idle-playback-cases.json):
  override cases shared by the backend and frontend clip parsers.

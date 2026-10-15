# 0022: Optional licensed sounds for built-in effects

- Status: proposed (for owner acceptance with the PR)
- Recorded: 2026-10-10
- Retrospective: no
- Original decision date: 2026-10-09 (owner decisions Q1 and Q3, and the plan
  review, in [issue #399](https://github.com/raymond-van/animama/issues/399))
- Decision basis: [issue #399](https://github.com/raymond-van/animama/issues/399)
  and the [execution plan](../plans/licensed-comedy-sfx/licensed-comedy-sfx-execplan.md)
- Amended: 2026-10-14, a built-in effect may declare several sounds and each
  use picks one ([ADR 0025](0025-per-use-avatar-effect-overrides.md))

## Context

The owner bought a commercial pack of anime comedy sound effects, and wants every
built-in Avatar Effect to play one of them. The vendor's terms allow the sounds
inside a product. They forbid handing them out as files, a sound library,
soundboards, media authoring tools and "independent reuse by third parties".
[ADR 0018](0018-non-portable-included-content.md) already ships licensed motion
as a private, non-portable Included source in desktop and hosted builds only. The
built-in effects, however, live in the public core source. Self-host, public
source builds and desktop builds without the pack must keep working. In the
catalog, a dependency that doesn't resolve makes an item invalid, and so does
every Reaction and Gesture that uses it.

## Decision

1. **Optional accompanying sounds.** A built-in Avatar or Scene Effect's
   `sound_effect` dependency may declare `"optional": true`. The Included scan
   resolves optional edges against everything Included the installation mounts.
   An edge whose sound isn't installed is dropped from the effect's effective
   metadata, with the `soundAlias` that names it, so the effect is an ordinary,
   valid effect without a sound. Its revision records the omission. The
   descriptor in Git still names the sound.
2. **The sounds are a second private pack.** They ship as the non-portable
   Included source `wow-comedy-sfx`, built, verified, staged, mounted and
   leak-scanned like the Mixamo-motion pack. Only sounds that built-in effects
   use are included.
3. **Licensed sounds stay with built-in content.** Local content may not declare
   optional edges, and may not depend on a non-portable Sound Effect: catalog
   reconciliation marks such items invalid, so save and import fail. The UI
   never lists licensed sounds in the Library or any creator, and copying a
   built-in effect leaves its sound behind with a note. Users can still use the
   built-in effects, sound included, in their own Gestures and Reactions.
4. **Export leaves the sound out.** A package never carries a licensed sound. An
   exported effect loses the optional edge and its `soundAlias`, and the export
   review says how many built-in effect sounds stay with this app. No bytes-free
   reference is recorded: import installs every entry as a fresh Local copy,
   and Local content never carries a licensed sound, so an imported copy of a
   built-in effect plays without its sound even where the receiving
   installation has the pack. This diverges from issue #399's R3 ("rebinds to
   the receiver's matching sound") and awaits the owner's confirmation.
5. **Watermarked previews are denied by hash.** The vendor's preview files may
   ship nowhere. Their hashes are a tracked backend resource that joins the
   restricted set and the release scan.

## Rationale and consequences

Resolving optional edges once, at scan time, keeps the catalog invariant that
every declared dependency has a resolved item, which a dozen consumers rely on
(admission, runtime closures, previews, export, staging). The alternatives were
worse:

- Putting sound-carrying copies of the effects in the private pack would give
  self-host and desktop different effect identities.
- A private overlay mapping effects to sounds would hide the pairing from the
  public descriptors and force a pack republish for every new built-in effect.

Consequences:

- A built-in effect's sound is part of its effective content, so mounting or
  unmounting the pack changes its revision.
- Optional edges are a built-in packaging mechanism, not a user feature.
- Hiding licensed sounds from the Library is a conservative reading of the
  vendor's soundboard and sound-library restrictions.
- Release remains gated on the vendor's written confirmation of the
  distribution model.
- A built-in effect has at most one sound (amended by
  [ADR 0025](0025-per-use-avatar-effect-overrides.md): several, one per use).
  Some are silent by owner choice
  (2026-10-11, [issue #409](https://github.com/raymond-van/animama/issues/409)):
  effects used only by idles, and gags the owner preferred quiet.

## Evidence

- [Issue #399](https://github.com/raymond-van/animama/issues/399): owner
  decisions and the licence summary.
- [Execution plan](../plans/licensed-comedy-sfx/licensed-comedy-sfx-execplan.md):
  design survey, implementation and review record.

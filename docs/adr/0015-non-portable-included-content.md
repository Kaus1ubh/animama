# 0015: Non-portable Included content for licensed built-in motion

- Status: proposed (owner acceptance pending with the implementation PR)
- Recorded: 2026-10-07
- Retrospective: no
- Original decision date: 2026-10-07 (owner intent discovery, decisions D1–D7
  in [issue #242](https://github.com/raymond-van/animama/issues/242))
- Decision basis: [issue #242](https://github.com/raymond-van/animama/issues/242)
  and the [execution plan](../plans/mixamo-built-in-motion/mixamo-built-in-motion-execplan.md)

## Context

The owner wants the desktop app and the hosted service to ship Mixamo-derived
Gestures and idle loops (35 owner-selected clips in the first pack). Adobe's terms allow Mixamo animation inside a product
but forbid handing the files out as reusable assets, standalone or in packs.
Until now every Included item could be customized into a Local copy and exported
in a portable package, and Mixamo-derived files were excluded from Git, Docker
contexts and desktop packages entirely ([ADR 0004](0004-filesystem-content-and-recoverable-mutations.md)
separates source partitions from ownership, but no record defined Included
content that is usable but not portable).

## Decision

1. **A `non-portable` distribution class.** An Included source's licence
   inventory may mark entries `"distribution": "non-portable"`. Such entries play,
   preview and can be equipped, but never enter a portable package, a Local copy
   or an import. The scanner derives the class from the source's own inventory
   after merging descriptor metadata, so a descriptor can neither claim nor
   remove it. Unrecognised distribution values fail closed.
2. **Byte-level enforcement everywhere.** A tracked, public-safe manifest of the
   pack's file hashes ships as a backend resource. Typed save and package import
   reject matching bytes in every build, self-host included. Matching Local
   files are scanned as non-portable.
3. **Export omits and references.** Content export refuses non-portable roots by
   name. A portable Idle Style that pools non-portable Gestures exports without
   them. An Anima export omits non-portable Gesture and Idle Style bindings and
   records bytes-free references, which import rebinds to the receiver's own
   matching item or drops with a review notice.
4. **A separate private Included source.** The Mixamo motion is its own
   read-only Included source (`mixamo-motion`), assembled only from a verified
   private build input fetched from an owner-only prefix in a private bucket. It
   is bundled in the desktop runtime and mounted by hosted deploy, and is never a
   downloadable feature pack. Source trees, Docker contexts, self-host images
   and public packages must not contain its bytes; the release scan and the
   pack tool check this by hash.
5. **No technical protection and no visible badge.** Loose files are acceptable
   inside the product, as Mixamo requires no protection. The UI explains
   unavailable actions in text.

## Consequences

- Included content is no longer uniformly portable; the catalog exposes
  `portability`, and creators, Library and sharing honour it.
- Release builds depend on owner-held inputs and credentials. A desktop build
  without the input runs without the pack; release candidates require it.
- An earlier installation cannot read a package that carries non-portable
  references; packages without references are unchanged.
- Byte matching stops exact copies only. Modified derivatives are covered by the
  UI and by policy, not by similarity detection.
- Release remains gated on the owner's review of the current Adobe terms
  (spec R10).

## Alternatives considered

- **Keep the Local-only installer.** Each user downloads and converts the clips
  themselves. Lawful but leaves desktop and hosted users with less expressive
  companions, which the owner rejected.
- **Author replacement motion** (as in [ADR 0014](0014-track-based-anima-pose-clips.md)).
  The owner chose to ship the Mixamo clips as well (D1); authored Gestures
  continue independently.
- **Block export of any Anima using these items.** Rejected: plain omission or
  blocking would break ordinary sharing for every such Anima.
- **Merge the clips into `content/included`.** Rejected: it would weaken the
  tracked-only staging gate and the self-host exclusion.

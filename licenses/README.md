# Source licensing review

The working repository remains proprietary. Raymond Van is the recorded owner
of original Animama code, documentation and original artwork. The separately
prepared source candidate proposes AGPL-3.0-only for that work; access to this
checkout grants no new rights. Third-party code and assets retain their own terms.

[source-review.json](source-review.json) maps every classified source input to
the candidate license treatment, evidence and review state. Its original-work
entries rely on the owner's authorship attestation and bounded source review;
they are not forensic certification that no external influence exists. Known
third-party sources override that default. Exact third-party bytes, revisions,
modifications and full notices are in [third-party](third-party/):

- [Code, speech models and dashboards](third-party/code-and-models.md).
- [Artwork and particle sources](third-party/art-NOTICES.md).
- [VRoid owner confirmation and metadata](third-party/art-vroid-review.json).

All recorded dispositions are preparation evidence. Public-source acceptance
and signed binary distribution are separately gated. Raymond confirmed the
retained model identities, authorized correcting Annie's use/redistribution
metadata, and on 2026-10-19 approved Andrew, his own edit of a VRoid preset
with owner-set restrictive metadata; their derived portraits retain the
corresponding model terms. Caitlyn's former unmodified CC BY sample remains
only as a test fixture. Retained
PocketTTS assets, including all 38 voice states (3 core, 35 downloaded on demand), are CC BY 4.0, which permits commercial use with attribution;
Kyutai's model-card prohibited-use terms still apply. They are not relicensed
as AGPL. The desktop release policy separately records a noncommercial
distribution basis; changing it is a separate owner decision.

Imported skills, removed artwork, Mixamo clips and licensed sound effects are
excluded from the source candidate. Desktop and hosted builds may carry Mixamo
clips and WOW Sound's comedy sound effects only as the private, non-portable
packs described in [ADR 0018](../docs/adr/0018-non-portable-included-content.md)
and [ADR 0022](../docs/adr/0022-optional-licensed-effect-sounds.md). Private ignored files and old Git/LFS history are not publication
inputs. Retained replacement artwork uses PNG authoring assets; see
[Included artwork](../content/included/README.md#retained-avatar-and-effect-artwork).
Runtime/native appearance acceptance remains separate. Regenerate the candidate
after source changes using the [source preparation tools](../scripts/public-release/README.md).

Keep upstream notices intact. The complete AGPL template and third-party legal
texts are preserved documents, not claims that Raymond authored their wording.
Installed dependencies and binary build inputs require the existing runtime
notice generation and final artifact review; a source inventory does not replace
that dependency or redistribution audit.

# Desktop redistribution review

This guide identifies the source mappings and exact-artifact checks required
before desktop distribution. Source preparation is not permission to publish.
Current source and notice changes require a fresh runtime inventory and matching
human review; stored receipts apply only to their exact inputs.

## Source mappings

- [Code and model notices](../../../licenses/third-party/code-and-models.md)
  identify retained ONNX, Basis, SentencePiece, Pocket, VAD, Smart Turn, Parakeet,
  Transformers.js and fft.js inputs, license texts and local modifications.
- [Artwork notices](../../../licenses/third-party/art-NOTICES.md) identify
  retained textures, the Twemoji images of the emotion backgrounds, particle
  derivatives, models and portraits.
- `content/included/licenses/inventory.json` records Included-content provenance
  and distribution rules. Required excluded or untracked inputs fail staging.
- [Source review inventory](../../../licenses/README.md) describes the broader
  source-publication review, which is distinct from packaged redistribution.

Pocket ONNX weights, tokenizer and the two core voice states are CC BY 4.0, which
permits commercial use with attribution. Kyutai's model-card prohibited-use
terms still apply. The 36 downloadable voices, four of which derive from CC0
recordings, are installed at runtime, outside the packaged core. `runtime/release-policy.json`
separately records a noncommercial distribution basis, which release validation
requires; changing it is a separate owner decision. Per-file terms are documented
in the code/model notices; source-code licensing does not replace model terms.

Annie's model uses VRoid preset terms. Caitlyn is authored by Raymond Van using
VRoid Studio; component terms remain applicable. Their embedded metadata and
renderer-captured portraits do not make all underlying material AGPL or CC0.
Keep notices and exact file mappings with each candidate.

Mixamo-derived VRMA files are ignored and excluded from source tracking and
Docker contexts. Desktop and hosted builds may include them only as the
non-portable [Mixamo-motion pack](../../backend/operations/mixamo-motion-pack.md),
staged from a verified private build input that exactly matches the tracked
manifest; its own licence inventory joins the redistribution inventory. The
[optional Local installer](../runtime/mixamo-acquisition.md) can install
manually converted motions as ordinary Local content. The shipped starter does
not require any of them. Ignored copies elsewhere cannot become release inputs.

## Pack and native dependencies

`desktop/runtime/feature-pack-releases.json` has no active pack. Expanded
Included content and Docling document processing are deferred: they produce no
initial-release archive or catalog entry. Both Parakeet sets are published as
shared model objects and downloaded at runtime, outside the packaged core; their
attribution and the onnx-asr MIT notice stay in the packaged notice bundle, and
each installed set carries its own README and attribution. Settings retains recovery/removal controls for
installed files even when a pack has no compatible catalog entry.

The first-party global input addon exposes only the configured binding's down/up
transitions to JavaScript. Its native binary requires platform/signing acceptance.
The LGPL dependencies `num2words`, `psycopg` and `psycopg-binary` retain their
source coordinates and bundled terms in the runtime inventory. Review linkage,
notices and distribution obligations for the exact build. A generated inventory
or a successful Apple notarization does not grant redistribution permission.

Before activating document processing, review its models/native libraries and
exact signed worker inventory. Rebuilding or changing signed worker bytes
requires fresh signatures, notarization, inventory and review.

## Exact artifact review

Run a fresh [stage and audit](runtime-staging.md) after changing source, build
inputs or notices. Inspect `runtime/licenses/inventory.json`,
`runtime/licenses/THIRD_PARTY_NOTICES.txt` and active-pack reports. Notice hashes
and source metadata are bound into the inventory, so changing either invalidates
an approval for different bytes. Resolve unclassified or unclear records; do not
fill approval fields automatically from a passing scan.

The approved core inventory in `release-policy.json` predates the removal of
the `google-genai` and `litellm` runtime dependencies, so the next stage needs a
fresh inventory review. Allowlist entries in `release-scan.gitleaks.toml` that
only covered those packages can be dropped once that scan passes without them.

The generated `desktop/release/review/redistribution-review.md` packet links the
current local artifacts for the target last staged. Keep the reviewer's
decision with exact inventory and artifact hashes. `release-policy.json` and
`feature-pack-releases.json` supply machine-checked receipts; they are valid
only when the produced inventory matches. Each target has its own native
components and lock, so `release-policy.json` keeps one receipt per target under
`redistribution_reviews` (`darwin-arm64`, `win32-x64`); a receipt for one never
admits the other.

Fresh native notice bundles, complete starter behavior and signed/native
acceptance remain release gates. Follow [Releases](releases.md) and the
[manual release process](release-process.md) for separate build, acceptance and
publication actions.

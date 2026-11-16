# Desktop redistribution review

This guide identifies the source mappings and exact-artifact checks required
before desktop distribution. Source preparation is not permission to publish.
Current source and notice changes require a fresh runtime inventory and matching
human review; stored receipts apply only to their exact inputs.

## Source mappings

- [Code and model notices](../../../licenses/third-party/code-and-models.md)
  identify retained ONNX, Basis, SentencePiece, Pocket, VAD, Smart Turn, Parakeet,
  SenseVoice, Transformers.js and fft.js inputs, license texts and local
  modifications.
- [Artwork notices](../../../licenses/third-party/art-NOTICES.md) identify
  retained textures, particle derivatives, models and portraits.
- [Adapted code](../../../licenses/third-party/adapted-code.md) names UI and
  backend files adapted from MIT, Apache-2.0 and ISC projects, and the
  generated client's Hey API runtime. The `adapted-code` license-source group
  copies it and the upstream texts for the code that ships into
  `THIRD_PARTY_NOTICES.txt`.
- `content/included/licenses/inventory.json` records Included-content provenance
  and distribution rules. Required excluded or untracked inputs fail staging.
- [Source review inventory](../../../licenses/README.md) describes the broader
  source-publication review, which is distinct from packaged redistribution.

Pocket ONNX weights, tokenizer and the three core voice states are CC BY 4.0, which
permits commercial use with attribution. Kyutai's model-card prohibited-use
terms still apply. The 35 downloadable voices, four of which derive from CC0
recordings, are installed at runtime, outside the packaged core. `runtime/release-policy.json`
separately records a noncommercial distribution basis, which release validation
requires; changing it is a separate owner decision. Per-file terms are documented
in the code/model notices; source-code licensing does not replace model terms.

Annie's model uses VRoid preset terms. Andrew is Raymond Van's own VRoid Studio
model, so pixiv's VRoid terms still apply to its VRoid components. Their embedded metadata and
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

WOW Sound's licensed comedy sound effects follow the same rules as the
non-portable [comedy sound pack](../../backend/operations/comedy-sound-pack.md),
with its own licence inventory (Media license) and a hash deny list for the
vendor's watermarked previews, which may ship nowhere. Built-in effects name
their sounds through optional dependencies, so a build without the pack is
complete and silent.

## Pack and native dependencies

`desktop/runtime/feature-pack-releases.json` has no active pack. Expanded
Included content is deferred: it produces no initial-release archive or
catalog entry. Both Parakeet sets and both
SenseVoice sets are published as shared model objects and downloaded at runtime,
outside the packaged core; their attributions, the onnx-asr MIT notice and the
full FunASR Model License text stay in the packaged notice bundle, and each
installed set carries its own README and attribution. Settings retains recovery/removal controls for
installed files even when a pack has no compatible catalog entry.

The first-party global input addon exposes only the configured binding's down/up
transitions to JavaScript. Its native binary requires platform/signing acceptance.
The LGPL dependencies `psycopg` and `psycopg-binary` retain their
source coordinates and bundled terms in the runtime inventory. Review linkage,
notices and distribution obligations for the exact build. A generated inventory
or a successful Apple notarization does not grant redistribution permission.

The core runtime of both targets freezes the upload parsers of the `documents`
extra: python-docx, python-pptx, openpyxl and et_xmlfile (MIT), XlsxWriter
(BSD-2-Clause), defusedxml (PSF), lxml (BSD-3-Clause) and pypdfium2
(BSD-3-Clause or Apache-2.0). Both targets' receipts cover them. When either
package changes, check two items in particular:

- lxml's binary wheels statically link zlib, libxml2, libxslt, libexslt and GNU
  libiconv. libiconv is LGPL-2.1: as for `psycopg`, review its linkage,
  notices and distribution obligations for the exact build.
- pypdfium2 bundles a PDFium build whose own components, such as FreeType,
  ICU, libjpeg-turbo, OpenJPEG, libpng, Little CMS, Abseil and zlib, each carry
  a notice. `src/backend/packaging/desktop/python_licenses.py` copies every
  licence file a distribution declares, so these notices and lxml's
  bundled-library terms should reach `THIRD_PARTY_NOTICES.txt`; confirm them in
  the exact artifact.

## Exact artifact review

Run a fresh [stage and audit](runtime-staging.md) after changing source, build
inputs or notices. Inspect `runtime/licenses/inventory.json`,
`runtime/licenses/THIRD_PARTY_NOTICES.txt` and active-pack reports. Notice hashes
and source metadata are bound into the inventory, so changing either invalidates
an approval for different bytes. Resolve unclassified or unclear records; do not
fill approval fields automatically from a passing scan.

Allowlist entries in `release-scan.gitleaks.toml` that only covered `litellm`
can be dropped once a release scan passes without them; keep any that the
`google-genai` package still needs.

`httpx2`, which `anthropic`, `openai` 3 and `openai-agents` 0.24 use, verifies
TLS through the operating system's trust store (`truststore`) rather than
certifi, and the Gemini SDK imports some modules lazily. Release acceptance on
each target therefore includes an Anthropic, an OpenAI and a Gemini voice
request from the frozen runtime, confirming that TLS succeeds and that the
lazily imported modules were bundled.

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

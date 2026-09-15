# Desktop redistribution review

This page records source evidence, not legal advice or permission to publish.
On 2026-09-03 the owner approved the exact Parakeet inventory, then approved the
regenerated core inventory after the gesture/portrait provenance update changed
its earlier hash. Both current receipts match their inputs. The release
repository remains private, and no publication is authorized.

## Scope decided on 2026-09-03

The desktop stage excludes `korone-pfp.png`, `marine-pfp.png`, and
`gojo-pfp.png`. They are unused legacy portraits; their private source files
remain in `web/public`, but staging removes their copied output and the separate
audit rejects reintroduction. The typed Annie and Caitlyn starter portraits are
unaffected.

Expanded Included content and document processing are deferred from the first
release. Their code and development inputs remain, but their release status is
`deferred`: no pack archive, catalog entry, release-size gate, or inventory
approval is required for either one.
General Settings lists available catalog entries and retained installed files,
so a deferred pack is hidden on a fresh installation without hiding recovery or
removal controls on an older profile. Parakeet is the only active release pack,
and its exact inventory is approved.

## Speech sources traced

The following comparisons were made on 2026-09-03. A matching hash identifies
bytes; it does not by itself establish that every redistribution obligation has
been met.

| Asset                                                         | Evidence                                                                                                                                                                                                                                                                                                                                                             | Declared terms / remaining review                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Silero VAD v5                                                 | The local model and worklet match `@ricky0123/vad-web` **0.0.30** byte for byte.                                                                                                                                                                                                                                                                                     | The [upstream combined license](https://github.com/ricky0123/vad/blob/8941bbf9116234748934d6b563c1751ce4d43c35/LICENSE) distinguishes ISC worklet code from the MIT Silero model. Both notices are now included.                                                                                                                                                                                                                                                                           |
| Smart Turn v3.2 CPU                                           | Exact model SHA-256 matches [Pipecat revision `f766f81`](https://huggingface.co/pipecat-ai/smart-turn-v3/tree/f766f81d3cfdf7737ac64aad813d91bbfd56bf93).                                                                                                                                                                                                             | The model card declares BSD-2-Clause; the [Daily copyright and license](https://github.com/pipecat-ai/smart-turn/blob/4786657e242dfe77dd138699ac564ee074a2a543/LICENSE) are now included.                                                                                                                                                                                                                                                                                                  |
| PocketTTS tokenizer, stock voices, SentencePiece browser file | Exact hashes match [KevinAHM's initial web snapshot](https://huggingface.co/spaces/KevinAHM/pocket-tts-web/tree/3cf6daa623e2b09992c972cab32568ee8679a154). The tokenizer also matches Kyutai's model metadata.                                                                                                                                                       | The snapshot declares CC BY 4.0 for model/voice assets and Apache 2.0 for code. Attribution and its code license are included. Check any additional tokenizer/native notices and applicable upstream model terms.                                                                                                                                                                                                                                                                          |
| Five PocketTTS ONNX files                                     | Repository history first adds these bytes in `f48b4bc6`; all five hashes exactly match the [codexxx web snapshot](https://huggingface.co/spaces/codexxx/pocket-tts-web/tree/6fbae64699d94f60dde9c3975984b383a6a3d950/onnx).                                                                                                                                          | Its README declares CC BY 4.0, but [ONNX-LICENSE](https://huggingface.co/spaces/codexxx/pocket-tts-web/blob/6fbae64699d94f60dde9c3975984b383a6a3d950/onnx/ONNX-LICENSE) contains CC BY-NC 4.0. The owner elects the stricter CC BY-NC 4.0 basis for the initial completely free desktop release. Before charging for Animama, connecting it to a paid Animama service, using it as product lead generation, or monetizing its data, replace these exports or obtain commercial permission. |
| Parakeet INT8                                                 | Encoder and decoder match [istupakov revision `0bbb45a`](https://huggingface.co/istupakov/parakeet-tdt-0.6b-v2-onnx/tree/0bbb45a3365852604aef28b538a8f066f4ccaa85). The rebuilt preprocessor, configuration and vocabulary match [ysdede revision `db4a768`](https://huggingface.co/ysdede/parakeet-tdt-0.6b-v2-onnx/tree/db4a768f5795e0f508187a34241fbeeef6ebb0d3). | Both model cards declare CC BY 4.0. The local attribution now describes the actual INT8 subset rather than claiming to ship FP16/FP32 files. Review the final archive and its notices.                                                                                                                                                                                                                                                                                                     |

Exact local hash evidence:

| File                            | SHA-256                                                            |
| ------------------------------- | ------------------------------------------------------------------ |
| `silero_vad_v5.onnx`            | `2623a2953f6ff3d2c1e61740c6cdb7168133479b267dfef114a4a3cc5bdd788f` |
| `vad.worklet.bundle.min.js`     | `8a48fdc7429948a2fde3d29a84bb1a64c1f67b4ba578ccaa7548b7f989f06a74` |
| `smart-turn-v3.2-cpu.onnx`      | `2bb026316b14a660486a75b1733cd3fbab8c2fd0314dc9af7be49f8cca967e4f` |
| `tokenizer.model`               | `d461765ae179566678c93091c5fa6f2984c31bbe990bf1aa62d92c64d91bc3f6` |
| `voices.bin`                    | `a499039e88043ff86cb39705f487cc761406d55f1e73ad19a3c055b16e86b062` |
| `sentencepiece.js`              | `fc802c6945931e685d82d0f601cda185bb43990870d712119caf5ea74e6e9c56` |
| `flow_lm_flow_int8.onnx`        | `8d627d235c44a597da908e1085ebe241cbbe358964c502c5a5063d18851a5529` |
| `flow_lm_main_int8.onnx`        | `fd5cdd7f7ab05f638af0011b9561fe95f3d86bae7be7504e921ae3d2874b5da5` |
| `mimi_decoder_int8.onnx`        | `501e16f51cf3fb91bd2928ee2a10c96d3461544eff329aafca10489e990b450c` |
| `mimi_encoder.onnx`             | `360f050cd0b1e1c9e92e25584391a2214cb7574ba16c67ac5f471f9dce8588e4` |
| `text_conditioner.onnx`         | `80ea69f46d8153a9bd42373723cedae4c88ccbde0e052c2a96e9e8f19445adf1` |
| `encoder-model.int8.onnx`       | `3e0581fda6ab843888b51e56d7ee78b6d5bc3237ec113af1f732d1d5286aa155` |
| `decoder_joint-model.int8.onnx` | `a449f49acd68979d418651dd2dcb737cc0f1bf0225e009e29ee326354edbf7d3` |
| `nemo128.onnx`                  | `bff2bc1bef1d1185da8bb69419b51c68fc50e88c923654ced2dfe4e055e4e938` |
| Parakeet `config.json`          | `562aedb0b804acbeb4e04215de190846c37e0bb239b696376df69d555785373a` |
| Parakeet `vocab.txt`            | `d5b4ca312b07f10cc89b6ff1f500201b5bd826dc3f9500c115caeb36c0b10831` |

## Included content sources

- The owner explicitly chose to ship the `.vrma` files converted from Adobe
  Mixamo FBX animations as embedded avatar-playback content. Animama does not
  offer them as a standalone animation library and does not use them to create,
  train, test, or improve machine-learning systems. Preserve the [Mixamo FAQ](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html)
  and [additional terms](https://wwwimages2.adobe.com/content/dam/cc/en/legal/servicetou/Mixamo-Addl-Terms-en_US-20210623.pdf)
  references in the release notice and re-review any separate asset distribution.
- The owner authored the JSON gesture/pose definitions, their metadata, the
  reaction JSON, and the avatar-expression assets. Referenced Mixamo-derived
  VRMA files retain their separate product-use terms. Custom scene SVGs were
  generated for Animama using an AI image generator.
- The owner confirms the shipped Annie and Janna WebP portraits are direct
  Animama renderer captures of their respective models, contain no external
  artwork, and have project-authored metadata.
- All 31 scene emoji copies match the checked-in Twemoji 14.0.2 mirrors byte for
  byte. Twemoji graphics are CC BY 4.0; the release notice includes attribution.
- The particle tree preserves the Brackeys CC0 license/credits, Kenney Particle
  Pack CC0 license, and LeLu VFX permissive readme beside their source files.
  The particle generator maps its authored symbols and normalized Kenney/
  Brackeys derivatives, so these files no longer rely on a blanket “free pack”
  assertion.

## Remaining compliance work

Animama no longer distributes `uiohook-napi` or libuiohook. Global hold-to-talk
uses a first-party N-API addon implemented in this repository for macOS and
Windows. The build and runtime audits require that single native file, while its
native matcher sends JavaScript only the configured binding's down/up transition.
This resolves the libuiohook redistribution item; the replacement still needs
normal signed macOS and native Windows acceptance.

The owner approved proceeding with the current LGPL dependencies in the exact
reviewed inventory: `num2words`, `psycopg`, and `psycopg-binary`. Their package
source coordinates and bundled license texts remain in the generated inventory
and notices. This records the release decision; it is not legal advice and must
be revisited if those dependencies, linkage, notices, or distribution method
change. The exporter reads installed license expressions, PyPI license
classifiers and bundled notice files; the fresh inventory has zero
`NOASSERTION` records. The three `UNLICENSED` records are Animama's own private
workspace packages, not third-party packages. The
separately signed Docling worker's models and native libraries require review
only before that deferred pack is activated in a later release. A successful
Apple notarization is unrelated to license approval. Preserve the signed worker
bytes unless its payload must change; changed worker bytes require a new
signature, notarization, inventory and review.

## Final receipt and recovery

Run a fresh stage after changing inputs or notices. Read its exact
`runtime/licenses/inventory.json`, `THIRD_PARTY_NOTICES.txt`, and active pack
reports. The inventory now binds notice text hashes as well as source metadata,
so a changed notice cannot silently reuse an older human receipt. The owner must
approve those exact inputs before approval fields are filled. The generated
`desktop/release/review/redistribution-review.md` packet links the current local
artifacts and must not be treated as a permanent release receipt.

The current native stage contains 5,426 files and 801 source-level review
records. Its build ID is
`f4db223fe7206ef46322abcc8d15de43a17c95e021962f551218eac0cd96c928`
and the regenerated license-inventory SHA-256 is
`2ad5d4abe684245b89b228cbe4aa0511dd906532a1105a285d3bfd78431b3c26`.
The owner approved this regenerated core hash after its source-only provenance
change. Its predecessor receipt is historical and is not reused. Parakeet's
approved active inventory remains
`455b762854e365fbd5715e7a778f4c1771962c7bd38f12280cb54b731a791588`.
Any relevant source, notice, policy, or staged-byte change invalidates the
corresponding approval; use the regenerated local packet rather than copying
this paragraph blindly.

See [runtime staging](runtime-staging.md) and [releases](releases.md) for the
build and review commands. No step in this source investigation signs a core
candidate, uses a provider key, consumes the fresh macOS test profile, or
publishes artifacts.

# Smaller starter Avatars and the new Andrew

Status: Agreed.
Owner decisions:
- 2026-10-22, the owner chose WebP q90 textures plus sparse morph targets for
  the two Included starter Avatars, including bounded sparse-accessor support in
  the backend VRM validator.
- The same day, the owner supplied full-rights metadata and a new Andrew model,
  and chose to adopt that model.
- The owner accepted this spec and its ExecPlan with defaults O2–O4, and ruled
  out Gesture retuning.

Open decisions are listed below.
Authority: https://github.com/raymond-van/animama/issues/656 (this file is a
snapshot captured at the issue's 2026-10-22T17:45:42Z revision).

## Problem and intended users

The two Included Avatars, Annie (`AvatarSample_A_1_New.vrm`) and Andrew
(`Andrew.vrm`), are unoptimized VRoid Studio exports of 18.5 MB and 15.6 MB.
Every installation ships them, every hosted visitor downloads them without
transfer compression, and every exported starter Anima package carries them. Most
of the bytes are avoidable:

- Embedded PNG textures take 11.3 MB (Annie) and 8.1 MB (Andrew), including a
  2048² VRM thumbnail that Animama never reads.
- Morph targets (expression shapes) take 5.6 MB per Avatar. Each shape stores a
  position and normal offset for every face vertex, and about 81% of those
  offsets are zero.

Measurements on 2026-10-21 and 2026-10-22 showed that WebP q90 colour textures,
sparse morph-target accessors and a smaller thumbnail bring each file to about
4.7 MB. Renders of the face, torso, full body and back scored 47–56 dB PSNR
against the originals; the owner reviewed the side-by-side comparison and chose
this variant. Today the backend VRM validator rejects every sparse accessor, so
the smaller files cannot be loaded as content until the validator accepts
well-formed sparse data.

Both files also declare restrictive licence metadata (`modification:
prohibited`, and for Annie the pixiv sample conditions) that VRoid Studio
applied as export defaults. The owner has re-exported both Avatars with
owner-authored, full-rights metadata. The new Andrew export is also a revised
character: he wears a tie with a different top, trousers and shoes, his hair is
re-rigged, and he is about 10 cm shorter, with narrower shoulders and shorter
limbs.

The change serves new installation owners and hosted visitors, who download and
store less and get the revised Andrew. It also serves content authors, whose
review renders, tuning and packages must keep working.

## Goals, scope and non-goals

In scope:

- Replace Annie's file with an optimized version of the current model.
- Replace Andrew's file with an optimized version of the owner's new export.
- Apply the owner's metadata to both.
- Give Andrew a new portrait.
- Re-verify Andrew's Gestures, Poses, Reactions, eyelids and face parts on the
  new model.
- Accept well-formed sparse accessors in the backend VRM validator, with bounds
  checks equivalent to those for dense accessors.
- Update every record keyed by the old file digests or describing the old
  licence terms.
- Check in the reproducible tool that produced and verified the new files.

Non-goals:

- Optimizing user-uploaded or Local Avatars, at upload or anywhere else.
- A general VRM optimization skill. It is a separate follow-up that may reuse
  this change's tool.
- Downscaling textures (for example to 1024 px), KTX2/Basis, meshopt or Draco
  compression, and any new loader or decoder.
- Pruning morph targets, expressions, materials, nodes or spring bones.
- Upgrading the portrait generator or regenerating Annie's portrait. That
  belongs to the separate portrait upgrade.
- Changing VRMA validation.
- VRM 0 support in the tool.

## Required behavior

- **R1. Smaller starter files.** Both Included Avatar files are re-encoded from
  their source models:
  - colour textures (base colour, shade multiply, emissive, rim, matcap) become
    WebP at quality 90 with full-quality alpha;
  - normal maps and data textures (outline width, shading shift, UV animation
    mask) become lossless WebP;
  - a texture keeps its original encoding when WebP would be larger;
  - each morph-target accessor is stored sparsely when that is smaller;
  - the embedded VRM thumbnail stays present but shrinks to at most 1024 px.

  The expected result is about 5 MB or less per file.

  The source models are:
  - **Annie:** the current repository file, including the 2026-10-16
    hair-underside recolour;
  - **Andrew:** the owner's 2026-10-22 VRoid Studio 2.14.0 export (SHA-256
    `c06314f155dcd51e144cb19d1a4474b6523893a41f47275b0a01e1d02d2a01e9`,
    16,952,868 bytes).
- **R2. Optimization changes nothing else.** Each shipped file keeps, unchanged
  from its source model:
  - every morph target and its data; values compare numerically equal, and -0
    may become 0;
  - every expression and its binds;
  - the humanoid bones, spring bones and colliders, node constraints, lookAt and
    firstPerson;
  - all VRM meta fields except the thumbnail image and the fields set by R7;
  - material names and MToon parameters;
  - the order and names of nodes, meshes, primitives and materials;
  - which image each texture slot uses.
- **R3. Sparse accessors are validated, not trusted.** The backend VRM validator
  (`validate_vrm_stream`) accepts an accessor with `sparse` only when:
  - its count is at least 1 and at most the accessor's count;
  - the indices use an unsigned byte, short or int type and are strictly
    increasing and below the accessor's count;
  - the index and value ranges fit inside their buffer views and the binary
    chunk;
  - an accessor without a base `bufferView` reads as zeros.

  Malformed sparse data is rejected with the existing invalid-structure or
  binary-range reasons. The same rules apply wherever that validator runs:
  Avatar save, the Local folder catalog, Anima creation and package import.
  VRMA validation is unchanged.
- **R4. Digest-keyed records follow the new files.** These records point at the
  new SHA-256 values:
  - Annie's verified eyelid-closure profile (`eyelidClosure.ts`);
  - the VRoid art review (`licenses/third-party/art-vroid-review.json`);
  - any licence or source-review record that states the exact file hashes.

  Historical plan records keep the hashes they recorded.
- **R5. Reproducible.**
  - A checked-in tool regenerates both shipped files from their source models
    with pinned dependencies.
  - Annie's source is in Git history. Andrew's source export is committed once,
    unoptimized, before it is replaced, so it is in history too.
  - The tool reports file sizes, runs the backend validator and confirms R2 by
    loading the source and the result headlessly through three-vrm.
  - Its documentation states how to rerun it and what it must never do: prune
    morph targets, quantize, or reorder vertices.
- **R6. Existing installations recover.** After an update, Local databases that
  reference the Included Avatars keep working; the catalog revision changes as
  it does for any Included content update. Saved face-part corrections made
  against an old Included revision are handled as decided in O2.
- **R7. Owner licence metadata.** Each file's `VRMC_vrm.meta` takes the
  owner-authored values from the owner's 2026-10-22 VRoid Studio exports, keeping
  its own `thumbnailImage` reference. Both exports carry the same values except
  the name:
  - name `Annie` or `Andrew`, authors `Raymond Van`;
  - copyright information `2026 Animama` and version `1`;
  - licence URL `https://vrm.dev/licenses/1.0/`;
  - avatar permission `everyone`;
  - commercial usage `personalProfit` and credit notation `unnecessary`;
  - redistribution allowed, and modification `allowModificationRedistribution`;
  - violent, sexual, political or religious, and antisocial or hate usage all
    `false`;
  - no `otherLicenseUrl` or `thirdPartyLicenses`.

  The licence inventory, the VRoid art review, the source review and the art
  notices describe both Avatars as owner-authored VRoid models with these
  settings.
- **R8. The new Andrew works like the old one.** The new export keeps Andrew's
  14 VRM expressions, 57 morph-target names, spring group names (`Hair`,
  `TopsUpperArm`), lookAt type and 54 humanoid bones. On the new model:
  - **Portrait:** Andrew has a new Included portrait, made with the portrait
    generator current at implementation time. Its file name, `content_id` and
    meta follow the existing portrait pair.
  - **Motion:** the motion checks over every Included Gesture, Pose and
    Reaction run on the old and the new Andrew, and the results are recorded
    for reference. Included Gestures are shared, not tuned per Avatar, so no
    Gesture retuning is in scope.
  - **Face:** automatic face-part detection finds the same face parts as on the
    old Andrew. Blinks and the happy and relaxed eyelids close correctly, either
    with the default eyelid profile or with a measured profile added for the new
    digest.
  - **Test expectations:** Andrew-specific measurements (arm, hand, face-part
    and eyelid tests) and Andrew's samples in the Included clip baseline are
    re-measured on the new model, with the reason recorded.
  - **Appearance:** the MToon retune and Avatar Effects behave as on the old
    model. The material names keep VRoid's `_SKIN`, `_CLOTH` and `_HAIR`
    suffixes.

## Constraints

- The new files may use only core glTF 2.0, `EXT_texture_webp`, the extensions
  the files already use, and the VRM extensions. Both the content package
  capability allowlist (`content_package_capabilities.py`) and the browser loader
  without extra decoders must accept them.
- The validator change is security-sensitive parsing of untrusted uploads. It
  keeps the existing size and count bounds and adds no unbounded work; at most,
  index checking reads each sparse index once.
- The files are Git LFS objects. The sources remain recoverable from history.
- Hosted deployments receive the new files only after Cloud repins to an
  Animama build that contains them. No Cloud code change is expected.
- Included Gestures are shared across the Included Avatars and were not retuned
  for the old Andrew. The new Andrew's proportions are closer to Annie's, and
  the owner judged the shared Gestures acceptable.

## Acceptance criteria

- [ ] Backend tests show the validator:
  - accepts a valid sparse accessor, with and without a base buffer view;
  - rejects each malformed case named in R3;
  - leaves the existing dense and VRMA validator tests passing.
- [ ] Both shipped files pass `validate_vrm_stream`, and each is 5 MB or less.
- [ ] A headless three-vrm load comparison reports R2's properties identical
  between each source model and its shipped file.
- [ ] Review renders of the face, torso, full body and back score at least 45 dB
  PSNR against the source model for both Avatars.
- [ ] Annie's eyelid-closure profile applies to the new file's digest, shown by a
  unit test.
- [ ] Every digest record named in R4 matches `sha256sum` of the shipped files,
  and the licence records state the R7 settings.
- [ ] Andrew's new portrait exists with matching meta and licence records.
- [ ] Motion-check results for the old and new Andrew are recorded in the plan.
  Re-measured test expectations pass, with reasons recorded.
- [ ] A starter Anima package exports and imports with the new Avatar files.
- [ ] The full `pnpm e2e:test` suite passes on a disposable built stack, as
  required for starter Anima content changes.
- [ ] Owner visual check in the running app:
  - Annie looks unchanged in chat;
  - the new Andrew looks right in chat, the Library and Create Anima;
  - a sample of Andrew's Gestures and Reactions plays correctly, including
    hand-to-face contacts and `Fcl_*` expressions;
  - an Avatar Effect painted on the face renders correctly on both Avatars.

## Open questions and decisions

- **2026-10-22, agreed:** WebP q90 for colour textures, lossless WebP for normal
  and data textures, sparse morph targets, and validator support for sparse.
  The 1024 px downscale is not included.
- **2026-10-22, decided:** licence metadata. Both Avatars use the owner's
  full-rights metadata (R7). Annie keeps her current model with the hair fix and
  takes only the new metadata.
- **2026-10-22, decided:** Andrew adopts the owner's new export, with a new
  portrait and the R8 checks.
- **O2, accepted:** saved face-part corrections for the Included Avatars. They
  are stored per owner, item and Avatar revision, and the service assumes
  Included revisions never change. Corrections saved against the old revision
  stop applying, and automatic detection takes over. Proposal: do not carry them
  forward, and document that such an owner re-saves the correction.
- **O3, accepted:** the thumbnail target. Proposal: a JPEG of at most 1024 px,
  the VRM 1.0 recommendation and the vrm-transform default.
- **O4, accepted:** the tool's dependency. vrm-transform (MIT) is not on npm.
  Proposal: vendor only its VRM extension classes with a licence notice, rather
  than a Git dependency.
- **2026-10-22, accepted:** the spec and ExecPlan, with defaults O2–O4 as
  proposed.
- **O6, decided 2026-10-22:** no Gesture retuning for the new Andrew. The motion
  checks are recorded for reference only.
- **Note:** `personalProfit` allows commercial use by individuals but not by
  corporations under the VRM 1.0 licence. `corporation` is the setting if
  corporate reuse of the starters should be allowed.

## Spec

https://github.com/raymond-van/animama/issues/656

## ExecPlan

[starter-vrm-optimization-execplan.md](starter-vrm-optimization-execplan.md).

## Delivery links

None yet.

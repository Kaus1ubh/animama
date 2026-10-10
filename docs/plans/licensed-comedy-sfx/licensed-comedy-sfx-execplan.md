# Ship licensed comedy sound effects as non-portable Included content

Source agreement: [issue #399](https://github.com/raymond-van/animama/issues/399),
Status Proposal, read back at `2026-10-10T01:26:31Z`. Owner decisions of
2026-10-09: Q1 (Included content only), Q3 (only the sounds Included content
references), "every Avatar Effect has an associated sound", and the plan review
decisions recorded in the Decision Log. The issue is the spec; this plan owns
delivery.
Authorized scope: the whole plan, authorized by the owner's `/implement` request
on 2026-10-09. Phase 4 stops at owner gates G1–G3; release gate G4 stays outside
the PR.
Starting revision: `3efefc5b` (`origin/main`, 2026-10-09); first planned at
`1470e675`.
Branch: `feat/licensed-comedy-sfx`. One branch and one PR for this plan. Phase
issues are created as sub-issues of #399 when implementation is authorized.

## Purpose and context

Desktop and hosted users hear an anime comedy sound every time an Included
Avatar Effect appears: a bell for the idea bulb, a sweat drop "plip" and so on.
The sounds come from a commercial pack (WOW Sound "Anime Comedy Sound Effects
Pack", bought by the owner under the former **Rare** SFX tier, now **Media**).
They ship like the Mixamo motion pack
([ADR 0018](../../adr/0018-non-portable-included-content.md)): a separate,
read-only, **non-portable** Included source, bundled in the desktop runtime and
mounted by hosted deploy, never in Git, Docker contexts, self-host images or
public packages. Self-host and builds without the pack keep every effect and
play it silently.

The vendor's terms allow synchronizing the audio into a product and storing it
on a hosting service. They forbid standalone distribution, a sound library or
"independent reuse by third parties", templates, soundboards and media
authoring tools. So, beyond Mixamo's rules, users can't attach these sounds to
their own content in the creators (Q1).

Commands run from the repository root unless a working directory is stated;
frontend commands run from `src/frontend`. No Cloud checkout is needed. The
licensed files, the private inventory, store credentials and the purchase
record stay outside the repository in owner-only locations and are named here
only by placeholder.

### Implementation orientation

Paths are relative to `src/backend/animama/` (backend) or `src/frontend/`
(frontend and desktop) unless stated otherwise. Line numbers are from the
starting revision; implementers re-check them.

| Area | Current entry point and significance |
| --- | --- |
| Pack ID allow-list | `server/local_runtime.py:121` `_INCLUDED_PACK_IDS = frozenset({"expanded-included-content", MIXAMO_MOTION_PACK_ID})`; non-core sources are validated at :161–165, at most 8 sources. |
| Restricted hashes | `app/services/content_portability.py:29–56`: one hard-coded `mixamo-motion-manifest.json`; `restricted_sha256()` is `@cache`d and returns a set. Every consumer (scanner `filesystem_store.py:193`, typed save `content_save_service.py:201–203, 399–404`, import `content_package_archive.py:393–395`) works on that set, so a union of manifests needs no other backend change. Do not glob `resources/*-manifest.json`: `animation-manifest.json` has another schema. |
| Distribution derivation | `filesystem_store.py:672–695` `_with_distribution` (locator and every file, case-sensitive), `content_portability.effective_provenance` (descriptor values dropped, hash match forces non-portable). Generic for every kind, including standalone `sfx/*.ogg` entries with `.meta.json` sidecars (`_standalone_entry` :493–592). |
| Sound Effect kind | `content_kind_registry.py:1669–1677` (`sfx`, `.mp3 .ogg .wav .flac`); fields `duration_seconds codec defaults config technical_source` (:174). Dependency edges `{ref, content_type, alias?, config?}` parsed by `_dependencies` (:552–582) into `ContentDependencyV1(ref, kind, alias, config)` (`domain/content_documents.py:25–31`). Avatar, Scene and Particle Effects may depend only on Sound Effects (:234–236). |
| Effect sound | Avatar Effect `definition.soundAlias` (`app/contracts/avatar_effect.py:385`) must name a `sound_effect` dependency (`content_package_capabilities.py:220–231`, used at :301 and, for Scene Effects, :413). One-shot on apply, no timing or volume; volume comes from the dependency `config.volume` (`web/src/lib/runtime-content/AnimaRuntimeMediaCatalog.ts:980–993`). Clip events can mute it with `playAccompanyingSound: false` (`web/src/lib/avatar/poses/animaPoseClip/clipVocabulary.ts:199, 211`). |
| Missing-dependency behavior | Catalog: an unresolved ref makes the entry INVALID (`adapters/repositories/sqlalchemy/content_catalog_repo.py:531–541`), spreading as `dependency_unavailable` (:596–615). Runtime closure drops the whole root (`app/services/runtime_content_closure.py:160–190`). Starter staging omits non-portable entries (`runtime/starter_content.py:126–135`), so a core item that depends on one fails closure. Playback itself already skips an unresolved sound silently (`AnimaRuntimeMediaCatalog.ts:395–423`, `web/src/ui/sound/SoundProvider.tsx:96–114`). **This is the main design constraint.** |
| Export | `app/services/content_package_export.py`: Included closure members are exported as bytes; `portable_json` (:104) already rewrites descriptor references; `_strip_non_portable` (:459–498) only tolerates an Idle Style pooling a non-portable Gesture, so any Reaction or effect reaching a non-portable sound would raise `package_non_portable` and break most Anima exports. `PackageManifest.complete_graph` (`app/contracts/content_package.py:260`) requires every dependency to be a package entry. |
| Import | `app/services/content_package_import.py` `_plan_non_portable` (:655–681, generic by kind and logical key); `_restored_idle_refs` and `_rebind_anima` are Gesture/Idle only. |
| Typed save | `app/services/content_save_service.py`: restricted bytes are refused for every kind; nothing stops Local content depending on a non-portable target. |
| Included Avatar Effects | 26 descriptors at `content/included/vfx/avatar/<id>/<id>.json`, ids `builtin:avatar-effect:<id>`, all with `"dependencies": []` and no `soundAlias`. 13 had sounds before the 2026-09-02 cleanup (see the mapping table in Phase 4). No Included Gesture, Reaction or Scene Effect references a sound today. |
| Creator pickers | All use `useSoundEffects` → `effectPage` (`web/src/query/hooks/useEffects.ts:98–162`) → `GET /v1/sound-effects`. Avatar Effect "Sound when applied" (`web/src/ui/avatar-effect-creator/AvatarEffectSetupFields.tsx:335–397`), Scene Effect creator (`web/src/ui/scene-effect-creator/SceneEffectCreatorPage.tsx:231`), action editor SFX tab (`web/src/ui/action-editor/ActionEditorPage.tsx:288–312, 950–961`), Library "Use in Gesture/Reaction" (`web/src/ui/library/LibraryContentInventory.tsx:320–347`). `typedComponentCatalogViewItem` drops `portability` (`web/src/lib/content/catalogTypes.ts:354–406`). |
| Customize into Local | `AvatarEffectCreatorPage.tsx` `hydrateAvatarEffect` (:1551–1590) → `exactSoundFromPreview` (:1592–1617) copies the Included sound edge into the Local copy; Scene Effects do the same (`SceneEffectCreatorPage.tsx:2215–2240`); action copies carry sound edges via `dependenciesFromPreview` (`web/src/ui/action-editor/actionDocumentLoader.ts:33–104`). |
| Non-portable UI | Generic helper `web/src/lib/content/portability.ts`; export selection and review already list omitted items by kind (`web/src/ui/library/SharingPackageDetails.tsx:100–140`). Sound-specific gaps: `effectLibraryCard` never sets `nonPortable` (`web/src/lib/content/libraryPresentation.ts:192–211`); `LibrarySoundDialog.tsx:53` shows no reason; the save error says "motion" (`web/src/lib/content/contentSaveErrors.ts:17–18`). |
| Pack tool | `desktop/scripts/runtime/mixamo-motion.mjs` (476 lines) and `mixamo-motion-cli.mjs`. Core functions already take manifest, paths and credentials as parameters (`verifyPack` :143, `stagePack` :187, `scanForPackBytes` :253, `fetchPack` :347, `publishPack` :407, `manifestFor` :462). Mixamo-specific: constants :31–65 (pack ID, paths, `ANIMAMA_MIXAMO_R2_*`, private fields), the `.vrma` payload regex and `gestures/<id>` record key (:125–137). Singleton call sites: `stage.mjs:37, 73–83`, `licenses.mjs:26, 213–251` (a second staged dir would fall through to core licence refs at :251), `release-scan.mjs:39, 523–541`, `desktop/src/main-process/runtime/supervisor.ts:173–209`. |
| Release workflow | `.github/workflows/release-desktop-macos.yml:104–155` (`desktop-macos-signing` environment, fetch step, `ANIMAMA_REQUIRE_MIXAMO_MOTION: "1"`); secrets table `docs/frontend/desktop/releases.md:488`; manual steps `docs/frontend/desktop/release-process.md:64–76, 177–178`. |
| Ignore rules | `.gitignore:74–75` ignores `/content/included/sfx/`; **`.dockerignore` does not**, and `Dockerfile:18, 44` copy `content/included`, so an image built from a checkout holding the ignored previews would contain them. Compose bind-mounts `./content/included` (`docker-compose.yml:146–150`). |
| Watermarked previews | Only in the primary checkout's ignored `content/included/sfx/comedy/1/` (45 `.ogg`, 20 sidecars with `builtin:sound-effect:<key>` ids that Phase 4 reuses). None matches a licensed file by hash. Mounting the pack beside them would collide on logical keys and fail the Included scan. |
| Tests | Backend: `tests/test_content_portability.py`, `tests/test_non_portable_packages.py`, `tests/test_included_content_integrity.py`, `tests/test_included_content_catalog.py:131–150` (every `builtin:sound-effect:` dependency must resolve in the tracked copy; must learn about optional edges), `tests/test_starter_content_closure.py`, `tests/test_content_package_capabilities.py:182`. Desktop: `desktop/tests/mixamo-motion.test.mjs`, `runtime-supervisor.test.ts:514–530`, `runtime-packaging.test.mjs`. |
| Hosted | Cloud mounts no Included content and has no `/v1/content` routes yet. The byte routes (`server/routers/content.py:302–366`) are principal-authorized, `private`/`no-store`, with no public listing. Same contract as Mixamo (`docs/backend/operations/mixamo-motion-pack.md`, "Hosted deploy"). |

## Progress

- [x] Issue #399 drafted and updated with owner decisions (2026-10-09).
- [x] Repository surveyed; plan drafted (2026-10-09).
- [x] Owner review of this plan (2026-10-09): optional sound link accepted,
      fresh mapping for every effect, watermarked previews deleted.
- [x] Implementation authorized for the whole plan (`/implement`, 2026-10-09).
- [ ] Phase 1: Generalized private packs and the empty sound pack.
- [ ] Phase 2: Optional accompanying sounds and the non-portable sound policy (backend).
- [ ] Phase 3: Frontend affordances.
- [ ] Phase 4: Sound mapping, pack assembly and integration (owner gates G1–G3).
- [ ] Final integration review.
- [ ] PR opened and merge approval.
- [ ] Release gate G4: WOW Sound's written confirmation, recorded in the release
      review before the first public release containing the pack. Not part of
      the PR.

## Surprises & Discoveries

- **A required sound dependency would break self-host and export** (2026-10-09).
  Included Avatar Effects live in the tracked core source; the sounds live in a
  private source that is often absent. A required edge makes the effect INVALID
  wherever the pack is missing, invalidates every Reaction and Gesture using it,
  fails desktop starter staging (this happened once before as
  `missing:builtin:sound-effect:cute_slide`) and makes nearly every Anima
  unexportable. Hence the optional-dependency design (Decision Log).
- **The non-portable machinery is mostly kind-generic** (2026-10-09).
  Distribution derivation, restricted-byte checks, the `portability` field,
  byte routes and the frontend portability helper work for Sound Effects as
  they are. The single manifest, the pack ID allow-list, the desktop tool and
  the export/import omission rules are Mixamo- or Gesture/Idle-specific.
- **The playback path already degrades well** (2026-10-09). An unresolved sound
  is skipped silently after the visual applies; only catalog validity, closure
  and export need to change.
- **The 20 previously used sounds equal the 20 sidecars** in the ignored preview
  directory. The owner described those pairings as random, so none is reused.
- **Stacked effects** (2026-10-09). Reactions often apply two or three effects at
  once (for example `anger-3`: angry, face_red, steam_puffs). If every effect
  has a sound, they play together unless events set
  `playAccompanyingSound: false`.
- **`.dockerignore` gap** (2026-10-09, pre-existing). It doesn't exclude
  `/content/included/sfx/`. Fixed in Phase 1.
- **Particle Effects** may declare a sound dependency, but nothing plays it and
  no creator offers it; `docs/frontend/runtime/sound.md:24–25` claims otherwise.
  Out of scope; the doc line is corrected in Phase 4.
- **Agent authoring refuses sounds.** `web/scripts/effect-save.mjs:110–113` and
  `effect-promote.mjs:304–308` reject effects with sounds; the Avatar Effect
  skill says effects with a sound can't be promoted yet.

## Decision Log

- 2026-10-09, owner (recorded in #399): only Included content uses the licensed
  sounds; creators can't attach them to user content (Q1). Ship only the sounds
  Included content references (Q3). Every Included Avatar Effect has an
  associated sound. WOW Sound's written confirmation is a release gate, not an
  implementation gate.
- 2026-10-09, agent (*proposed*, for owner review with this plan):
  - **Optional accompanying sounds.** A `sound_effect` dependency edge on an
    Avatar or Scene Effect may declare `"optional": true`. An optional edge that
    doesn't resolve leaves the effect VALID and silent: the catalog records no
    blocking diagnostic, the runtime closure omits the sound, and desktop
    staging tolerates it. `soundAlias` may name an optional edge. Required edges
    keep today's behavior. Alternatives considered:
    - *Put sound-carrying copies of the effects in the pack* (as "Emotive Idle"
      lives in the Mixamo pack): duplicates 26 effects and gives self-host and
      desktop different effect identities.
    - *A pack-level overlay mapping effects to sounds*: no descriptor changes,
      but a new concept, invisible in creators, and every new Included effect
      would need a private pack republish. With optional edges, the reference
      lives in the tracked public descriptor and only the bytes are private.
  - **Non-portable Sound Effects are never dependencies of Local content.**
    Typed save refuses a Local item whose edge targets a non-portable Sound
    Effect (required or optional). Import strips such optional edges and refuses
    required ones. This is a rule for the Sound Effect kind only, failing closed
    for kinds without an explicit exception: Local Idle Styles may still pool
    non-portable Gestures (ADR 0018).
  - **Export strips optional non-portable sounds.** When an exported descriptor
    has an optional edge to a non-portable or unavailable sound, export removes
    the edge and its `soundAlias`, and the review lists the omitted sound. No
    bytes-free reference is recorded: the receiver's own Included effect, where
    import binds to it, already carries the sound. Phase 2 records how import
    treats Included-origin entries.
  - **Local Gestures and Reactions may use Included effects that carry a
    licensed sound.** The user picks the effect, never the sound, which matches
    the AI-cue use WOW Sound approved. Include this in the confirmation request
    (G4).
  - **Scope: Avatar Effects only for content.** Phase 4 assigns sounds to the 26
    Included Avatar Effects only. Gesture `sfx` events (the former
    shy-finger-poke `cute_slide` cue) and Scene Effect sounds are left for
    later. The optional flag is still accepted on Scene Effects, which share
    `soundAlias`.
  - **Names.** Source and pack ID `wow-comedy-sfx`; pack layout
    `sfx/wow-comedy/<key>.ogg` plus `<key>.meta.json`, keyed
    `builtin:sound-effect:<key>`, with keys derived from file names
    (`AC_Love_Bubble_02` → `love_bubble_02`). Tracked
    manifest `src/backend/animama/resources/wow-comedy-sfx-manifest.json`;
    public inventory `scripts/wow-comedy-sfx/inventory.json` (one `**` rule,
    `"distribution": "non-portable"`, licence ID
    `LicenseRef-WOW-Sound-Media-embedded-product`); build input
    `build-inputs/wow-comedy-sfx/`; store prefix `built-in/wow-comedy-sfx` in the
    existing private bucket used by the Mixamo pack (R2 tokens are bucket-scoped,
    so the existing read token can read it). Release staging is required with
    `ANIMAMA_REQUIRE_WOW_COMEDY_SFX=1`.
  - **One generalized pack tool** with a pack definition per pack, sharing the
    existing verify, stage, scan, fetch and publish code. `pnpm
    desktop:mixamo-motion` stays as an alias, so the release workflow and docs
    keep working.
  - **Watermarked previews are denied by hash.** A tracked, public-safe
    `scripts/wow-comedy-sfx/preview-deny.json` lists their SHA-256 hashes
    (hashes only, no audio). It joins the backend's restricted set and the
    release scan, with no allowed location.
  - **A new ADR (0019)** records optional accompanying sounds and the
    non-portable sound policy, amending ADR 0018's scope.
- 2026-10-09, owner (plan review): the optional sound link is accepted. Don't
  reuse the sounds the effects had before the 2026-09-02 cleanup; they were
  random, so every effect gets a freshly chosen sound. The watermarked previews
  may be deleted entirely. The other proposed decisions stand as written.

## Phased implementation

### Phase 1: Generalized private packs and the empty sound pack

Requirements: #399 R1, R2 (machinery), R4 (staging), R6 (Docker exclusion).
Depends on nothing. Mixamo behavior must be unchanged.

Intended changes:

1. **Backend manifests.** `content_portability.py` replaces the single manifest
   with an explicit tuple of restricted-hash resources (`mixamo-motion-manifest.json`,
   `wow-comedy-sfx-manifest.json`, the preview deny list) and returns their
   union. Each pack manifest's `pack_id` is checked. Add `WOW_COMEDY_SFX_PACK_ID`
   to `_INCLUDED_PACK_IDS`. Add the empty manifest (`files: []`) and the empty
   preview deny list, so the PR is safe to merge before content exists.
2. **Pack definitions.** Refactor `desktop/scripts/runtime/mixamo-motion.mjs`
   into a shared private-pack module plus one definition per pack: ID, manifest
   and inventory paths, input and private-inventory paths, staged directory,
   payload pattern, record key, private fields, R2 environment names and the
   "required" variable. The Mixamo definition reproduces today's constants
   exactly. The sound pack's payload is `.ogg`, its record key is the sound
   path, and its private fields are `vendor`, `product`, `license_tier`,
   `purchase_date`, `licensee`, `order_reference`, `source_file` and `sha256`.
   The CLI takes `--pack <id>`; `pnpm desktop:mixamo-motion` stays as an alias
   for `--pack mixamo-motion`.
3. **Call sites loop over packs.** `stage.mjs` stages each pack under
   `runtime/content/<id>` with its own required variable. `supervisor.ts` mounts
   each staged pack as `{id, pack_id: id, version: build_id}`. `licenses.mjs`
   gives each staged pack its own licence refs (fixing the fall-through at
   :251). `release-scan.mjs` runs one hash scan per pack with that pack's
   allowed directory, plus the preview deny list with no allowed location.
4. **Tracked inputs.** `scripts/wow-comedy-sfx/inventory.json` (public-safe:
   vendor, licence reference, no purchase data). Add `/content/included/sfx/`
   to `.dockerignore`.
5. **Preview deny list and deletion.** Generate
   `scripts/wow-comedy-sfx/preview-deny.json` (path-free SHA-256 list with a
   schema version) from the primary checkout's ignored
   `content/included/sfx/comedy/1/`, check that no tracked file matches, then
   delete that directory (owner decision, 2026-10-09). The backend restricted
   set and the release scan include the list.

Tests: pack-definition tests for both packs in the desktop pack test (present,
absent, required, mismatched, extra, provenance and scan cases for the sound
pack, using synthetic `.ogg` fixtures); a supervisor test mounting both, either
or neither; `tests/test_content_portability.py` for the manifest union, a
second malformed manifest and the new pack ID;
`tests/test_included_content_integrity.py` for the new public inventory.

Checks: `uv run pytest -q`, `uv run ruff check`, `make format-check`; from
`src/frontend`: `pnpm desktop:check`, `pnpm desktop:test`,
`pnpm desktop:runtime:stage` and `pnpm desktop:runtime:audit` without either
pack input; `pnpm desktop:mixamo-motion verify` and `scan --git` behave as
before; `bash -n reset.sh` and both `docker compose … config --quiet` checks.

Completion: Mixamo staging, mounting, licences and release scan are unchanged
(the existing tests pass unmodified apart from imports); the sound pack stages
and mounts from a synthetic fixture in tests; review passes.

#### Phase 1 references

Issue: to be created. Commits: none yet.

#### Code Review #1 Findings

Not started.

#### Code Review #1 Revisions

Not started.

### Phase 2: Optional accompanying sounds and the non-portable sound policy (backend)

Requirements: #399 R3, R7 (degradation), R9 (backend). Depends on P1 (for the
restricted set; can start in parallel).

Intended changes:

1. **Document model.** `ContentDependencyV1` gains `optional: bool = False`;
   `_dependencies` parses `"optional": true` only on `sound_effect` edges of
   Avatar and Scene Effects and rejects it elsewhere
   (`dependency_optional_not_allowed`). Descriptor writers round-trip it.
2. **Catalog validity.** An unresolved or invalid optional edge doesn't make
   the entry INVALID or propagate `dependency_unavailable`. Record a
   non-blocking diagnostic if the diagnostics model supports warnings;
   otherwise none.
3. **Runtime closure and alias map.** `runtime_content_closure.py` omits
   unavailable optional edges instead of dropping the root; the runtime
   reference map leaves `sound.onApply` unset, which the frontend already plays
   silently.
4. **Desktop starter staging.** `runtime/starter_content.py` closure resolution
   tolerates optional edges to excluded, non-portable or missing targets and
   never stages them.
5. **Capabilities.** `content_package_capabilities._sound` accepts a
   `soundAlias` that names an optional edge, and allows a missing target for
   that edge.
6. **Export.** For a descriptor with an optional edge to a non-portable or
   unavailable sound, `portable_json` drops the edge and its `soundAlias`, and
   the export summary lists the sound as omitted (reuse the existing omitted-item
   model; extend its kind set if needed). Required non-portable edges keep
   `package_non_portable`. Anima export through Reaction and Gesture closures
   succeeds.
7. **Save and import policy.** Typed save refuses a Local item with any edge to
   a non-portable Sound Effect (`content_non_portable_dependency`, naming the
   sound). Import strips optional edges to non-portable sounds from Local
   entries and refuses required ones. Record how import treats Included-origin
   entries (binds to the receiver's Included item, or writes a Local copy).
8. **OpenAPI.** If summary or error schemas change, regenerate the client
   offline with `pnpm openapi-ts` (after `uv sync --python 3.12.13` in a fresh
   worktree).

Tests: parsing (optional allowed and refused); catalog validity with the pack
absent and present; a Reaction using an effect with a missing optional sound
stays VALID and in the runtime closure; starter staging with an optional
non-portable edge; `soundAlias` capability with an optional edge; content and
Anima export strip the sound and list it; import of a package that names a
non-portable sound optionally (stripped) and as required (refused); typed save
refusing Local edges to non-portable sounds; restricted `.ogg` bytes refused on
standalone save, as a companion file and on import.
`tests/test_included_content_catalog.py:131–150` accepts optional edges whose
target is in a pack manifest.

Checks: `uv run pytest -q`, `uv run ruff check`, `make format-check`,
`make check-test`; `pnpm openapi-ts:check` if the schema changed.

Completion: every listed test passes; no existing export, import or closure
test changes meaning; review passes.

#### Phase 2 references

Issue: to be created. Commits: none yet.

#### Code Review #1 Findings

Not started.

#### Code Review #1 Revisions

Not started.

### Phase 3: Frontend affordances

Requirements: #399 R9 (UI), R3 (review UI). Depends on P2.

Intended changes:

1. **Pickers hide non-portable sounds.** Keep `portability` in
   `typedComponentCatalogViewItem`; `effectPage`, or a picker-side filter,
   excludes non-portable Sound Effects from the Avatar Effect, Scene Effect and
   action editor sound pickers and the SFX tab.
2. **Customize drops the licensed sound.** `exactSoundFromPreview`,
   the Scene Effect equivalent and `dependenciesFromPreview` skip non-portable
   sound edges. The creator shows a short, visible note when it dropped one
   ("The built-in sound stays with the built-in effect"). Final wording is
   reviewed with the UI.
3. **Library.** Non-portable sound cards don't offer "Use in Gesture/Reaction";
   the sound dialog shows the non-portable reason instead of only "read-only".
4. **Copy.** The save error for restricted bytes no longer says "motion"
   (generic wording for all licensed built-in content), and the new
   non-portable-dependency error has its own message.
5. **Export and import review** list omitted sounds through the existing
   kind-generic omitted-item display; check the label reads naturally.

Tests: unit tests for the picker filter, the customize paths (Avatar Effect,
Scene Effect, action copy), the Library policy and dialog, and the error copy;
update fixtures for `portability` where needed.

Checks: from `src/frontend`: `pnpm check`, `pnpm web:lint`, `pnpm web:test`,
`pnpm build`. Browser check at desktop viewport on a task stack with a
synthetic non-portable sound mounted: picker, customize note, Library card and
export review. `pnpm e2e:test:fast` against a disposable built stack, because
this changes user-facing creator and sharing flows.

Completion: the creators can't attach a non-portable sound in any path; the UI
explains every unavailable action in text; review passes.

#### Phase 3 references

Issue: to be created. Commits: none yet.

#### Code Review #1 Findings

Not started.

#### Code Review #1 Revisions

Not started.

### Phase 4: Sound mapping, pack assembly and integration

Requirements: #399 R1, R2 (real manifest), R4, R6, R7, R8, and the acceptance
criteria with real content. Depends on P1–P3. Contains owner gates.

1. **Gate G1 (owner): store and secrets.** Confirm the private bucket still has
   no `r2.dev` URL and no custom domain. Use the prefix
   `built-in/wow-comedy-sfx`. Provide the pack's bucket, prefix and read
   credentials in owner-only env files and as secrets in the
   `desktop-macos-signing` environment. Record a dated, credential-free note
   here.
2. **Watermarked previews.** Phase 1 records their hashes in
   `scripts/wow-comedy-sfx/preview-deny.json` and deletes the ignored
   `content/included/sfx/comedy/1/` from the primary checkout (owner decision,
   2026-10-09). They would otherwise collide with the pack's logical keys.
3. **Fresh mapping (agent draft for G2).** Choose one sound per effect from the
   licensed pack using each effect's name, description and look, preferring
   short variants. None of the former pairings is reused. Draft table below; the
   owner's listening review (G2) is authoritative.

   Draft: recorded here at the start of Phase 4.

4. **Pack assembly** (agent, private workspace). From the owner's licensed copy,
   copy only the mapped sounds into `build-inputs/wow-comedy-sfx/sfx/wow-comedy/`
   with `<key>.meta.json` sidecars: name, a short description and
   `duration_seconds`. Write the private inventory beside it (purchase fields
   recorded privately, never in Git). Check that no key collides with core
   content. Run `verify`.
5. **Core descriptors.** Each of the 26 Avatar Effects gets one optional
   `sound_effect` edge (`alias: "on-apply"`, the creator's existing alias) and
   `definition.soundAlias`. **Stacking pass:** where a Reaction or Gesture
   applies several effects at the same moment, keep one accompanying sound,
   usually the most characteristic, and set `playAccompanyingSound: false` on
   the others. Add an integrity test: every Included Avatar Effect has exactly
   one optional sound edge whose key is in the tracked manifest.
6. **Gate G2 (owner): listening review.** Mount the assembled pack on a task
   stack and play each effect, with its sound, on both Included Avatars, plus
   the stacked Reactions. The owner approves or changes each pairing and the
   stacking choices. Rejected sounds are removed before publishing, so they
   never enter the store or the manifest. A candidate manifest is used locally
   for the review only.
7. **Publish** (the owner runs `publish --confirm` for the sound pack). Commit
   the tracked manifest after a public-safety review and `scan --git`. Add
   fetch, verify and `ANIMAMA_REQUIRE_WOW_COMEDY_SFX=1` to the release workflow
   and `release-process.md`.
8. **Tooling for future effects.** Let `effect-save.mjs` and
   `effect-promote.mjs` accept an optional edge to a sound in the tracked
   manifest. Update the Avatar Effect skill guidance: new Included effects get a
   pack sound; adding a new sound needs a new pack version.
9. **Build verification.** `fetch` + `verify`; stage a desktop runtime with
   `ANIMAMA_REQUIRE_WOW_COMEDY_SFX=1` (and the Mixamo requirement); audit it;
   run every leak scan on the real manifest and the preview deny list (tracked
   files, Docker build context, package set, the self-host image and the stage
   outside `runtime/content/wow-comedy-sfx`, plus a positive control). Confirm
   self-host `./reset.sh` starts with every effect VALID and silent.
10. **Documentation.** ADR 0019 (optional accompanying sounds and the
    non-portable sound policy); a pack guide beside
    `docs/backend/operations/mixamo-motion-pack.md` (or a shared private-packs
    guide if that reads better); `content/included/README.md` (replace the
    "no distribution license" paragraph and "This library holds no
    non-portable content"); `docs/frontend/runtime/sound.md` (optional sounds;
    fix the Particle Effect claim); `docs/frontend/runtime/avatar-vfx.md`;
    `docs/frontend/features/library.md`; the redistribution review, runtime
    staging and release docs; `.gitignore` comment at :74; the packaged
    attribution notice and licence sources crediting WOW Sound (R8); a visible
    credit where the app lists third-party notices.
11. **Gate G3 (owner): playback.** In a desktop build containing the pack, play
    the effects and stacked Reactions on both Included Avatars, and repeat the
    picker, customize and export restrictions with real items. The hosted check
    is deferred to Cloud's plan while hosted content routes don't exist.

Recovery: a bad sound or pairing is fixed by republishing under a new pack
version and updating the manifest; changing only a pairing to an already
shipped sound needs only a descriptor change. Removing the pack from a build
leaves every effect valid and silent.

Completion: G1–G3 recorded; the acceptance criteria in #399 hold with real
content; review passes.

#### Phase 4 references

Issue: to be created. Commits: none yet.

#### Code Review #1 Findings

Not started.

#### Code Review #1 Revisions

Not started.

## Final integration review

Not started. Covers the combined acceptance of #399 using still-valid phase
evidence: Mixamo unchanged, sound pack staged and mounted, self-host silent and
valid, creators blocked, export and import consistent, leak scans clean.

## Validation and acceptance

The acceptance criteria in #399 are the contract. Evidence per criterion:

- Leak checks (no pack or preview bytes outside the allowed runtime
  directory): P1 fixture tests, P4 real-manifest scans.
- Desktop plays restored cues; a build without the input is silent and passes:
  P4 staging plus G3; P1/P2 tests for the absent case.
- Backend rejection, omission and import behavior: P2 tests.
- Every Included Avatar Effect has a sound: the P4 integrity test.
- Creators can't select non-portable sounds: P3 tests and browser check, P2
  save refusal.
- Hosted serves through the authorized byte route only: code reading of the
  byte routes (P2) and the documented hosted contract; the live check is
  deferred to Cloud.
- Documentation: P4.
- WOW Sound written confirmation: release gate G4, outside the PR.

Never mark an unperformed check passed. Local, browser, owner and hosted
evidence are recorded separately per phase. Hosted CI is disabled; local
checks are the evidence.

Each phase gets one full initial review and at most two repair rounds, plus a
final integration review, following
[bounded code review](../../../SDLC.md#bounded-code-review). Findings and
revisions are recorded under each phase as `Code Review #N Findings` and
`Code Review #N Revisions`.

## Idempotence and recovery

- `fetch`, `verify`, `scan` and staging are repeatable and write only to ignored
  build-input and stage directories. `publish` is a dry run unless `--confirm`
  is passed, and a published version is immutable.
- Optional edges make the pack removable at any time: unmounting it leaves
  effects valid and silent, with no data migration.
- No Alembic revisions. If a catalog column is added, it goes into the baseline
  SQL, and development databases may be reset at the owner's discretion.
- If a licensed or watermarked file is ever committed by mistake, stop and tell
  the owner. History rewriting is the owner's decision. Never force-push
  without approval.
- The watermarked previews are deleted from the primary checkout (owner
  decision); their hashes stay in the tracked deny list.

## Outcomes & Retrospective

Not started.

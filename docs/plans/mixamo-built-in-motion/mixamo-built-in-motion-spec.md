# Ship Mixamo-derived motion as built-in content in desktop and hosted builds only

Status: Agreed
Owner decision: intent discovery with the owner on 2026-10-07 (D1–D7) and the
owner's 2026-10-08 decisions (D8–D10) under Open questions and decisions.
Authoritative source: [issue #242](https://github.com/raymond-van/animama/issues/242).
This file is an issue snapshot, published and read back at `2026-10-08`, after the D8–D10 update.
Source baseline: `d4f7028f` (`origin/main`, 2026-10-07).

## Problem and intended users

Today Animama ships no Mixamo-derived motion. Its starter pack uses 21
project-authored Gestures and 72 Reactions, and new companions have an empty Idle
selection. Mixamo motion is available only through the optional Local installer
([Mixamo acquisition](../../frontend/runtime/mixamo-acquisition.md)), which a
user runs by hand: they download FBX files with their own Adobe account, convert
them, and install them as ordinary, editable, exportable Local content.
Mixamo-derived VRMA files are ignored by Git, excluded from Docker build contexts
and rejected by the tracked-only desktop staging gate
([redistribution review](../../frontend/desktop/redistribution-review.md),
[platforms](../../frontend/desktop/platforms.md)).

As a result, desktop and hosted users get a noticeably less expressive companion
than the owner's development installation. The agent-authored
`animaPoseClip/2.0` Gestures from #282 (promotion to Included in #310) narrow
this gap only partly: none of them is an idle loop, and the format keeps the feet
planted, so it cannot replace motion such as the excited jump. The owner wants
the desktop (Electron) app and the hosted Animama Cloud app to ship
owner-selected Mixamo clips as Included avatar motion. They must not leave the app as
reusable assets, and the self-hosted web app and the source repository must never
contain or distribute them.

Intended users: desktop and hosted Animama users, who get richer Included motion
to choose from; self-hosters, whose experience is unchanged; and the owner, who
needs a release process that stays within Adobe's terms and leaves an audit
trail.

## Goals, scope and non-goals

In scope:

- A **non-portable** redistribution class for Included content, marked in the
  public license inventory and enforced by the backend.
- Shipping 35 owner-selected Mixamo clips (30 Gestures and 5 idle loops; D8) and
  one Included Idle Style that pools the idle loops, all as non-portable content
  in the desktop and hosted builds.
- Closing every route by which such an item could leave the app as a reusable
  file or become a user-owned copy.
- Private build inputs: an owner-only store, a reviewed staging allowlist, and
  provenance records.
- Verifying build contents and playback.

Non-goals:

- Starter changes in any build. The clips are available in Library only; no
  starter loadout or default Idle Style includes them (D2).
- Changing the self-hosted web app, its starter content, or the optional Local
  installer and its manifest.
- A visible Library label for non-portable items (D5).
- Technical protection (encryption or obfuscation) against users who extract bytes
  from the installed app or from network traffic.
- Building hosted sharing, publishing or a marketplace. None exists today. This
  spec only constrains any future hosted surface.
- Implementing Cloud deployment steps. Cloud owns its own plans and consumes the
  public contract defined here.
- Replacing or retiring agent-authored 2.0 Gestures. Where the two sets overlap
  (for example a wave or a bow), both stay in Library; #310 proceeds independently.
- Recovering the original Adobe IDs for the existing converted files by
  guesswork. Unrecorded provenance fields stay marked as not recorded (R8, D9).

## Required behavior

### R1 Mixamo motion as Included content in desktop and hosted builds

The desktop app and the hosted composition include the 35 clips the owner
selected on 2026-10-08 (D8: 30 Gestures and 5 idle loops, drawn from the 71
legacy conversions listed in `scripts/mixamo-assets.json`) and one Included Idle
Style that pools the idle loops by emotion,
as the former starter Idle Style did. All are non-portable. Users can select them
in Anima loadouts and Idle Styles, the companion can invoke them, and Library
previews them. They are not starter defaults in any build, and the Idle Style is
not a default selection. Self-host starter content must not depend on them (R7).

### R2 Non-portable marking

The public license inventory gains a reviewed redistribution class,
`"distribution": "non-portable"`. It marks matching Included entries as usable in
the product but never portable. Rules match the selected item folders: the
descriptor, payload and any generated metadata or portrait.

- The backend derives the restriction from the Included source partition and the
  matching inventory rule. It is not derived from user-editable descriptor fields,
  and a Local descriptor cannot claim or remove it.
- The catalog exposes the restriction as a read-only item property, so the UI can
  explain unavailable actions.
- An item with a payload whose bytes match a restricted payload is also restricted,
  wherever it is stored (see R5).

### R3 No content-package or Anima-export route

- **Content package export** (`POST /v1/content/package-exports`, summary and
  file routes) rejects a selection whose roots include a restricted item. The
  error names the restricted items. Library's export selection does not offer
  restricted items, and explains why if they are shown.
- **Dependencies.** No package ever contains the bytes or descriptor of a
  restricted item. A non-restricted root that depends on one, such as a Local Idle
  Style whose pools reference non-portable Gestures, follows the same rule as
  Anima export below.
- **Anima export** (an `anima_id` package, including implicit bindings added
  during capture) omits restricted items and carries each as a non-portable
  reference (logical key and kind only, no bytes or descriptor). Export review
  lists every omitted item. On import, a reference binds to the importing
  installation's own matching non-portable Included item if one exists. Otherwise
  the slot falls back to the importer's normal default (no Gesture, or the Default
  pool without that Gesture), and import review states this (D3). Blocking was
  rejected because any Anima that equipped one of these items would become
  unexportable; plain omission was rejected because desktop-to-desktop round trips
  would lose motion.
- The backend enforces all of this in the export service. Re-checking a prepared
  export (`recheck`) applies the same rule. A package that the UI did not build is
  still rejected.
- Import rejects any package member whose bytes match a restricted payload (R5).

### R4 No creator, JSON or file export route

- The Gesture creator opens a restricted item for preview only. Customize, Save,
  Save & Equip, Save as Local copy, duplicate and Creator JSON export are
  unavailable, with an explanation. Opening the item never loads its payload into
  a Local draft that could be saved.
- Restricted items have no `.vrma`, JSON or project export, and no "copy" action
  in Library.
- Idle Style editor: duplicating the non-portable Included Idle Style, or saving a
  Local Idle Style that references non-portable Gestures, is allowed, because it
  stores references only, not motion bytes. The resulting Local Idle Style is
  exportable only under R3's dependency rule.
- Any creator path that samples restricted motion into a new clip or pose (for
  example capturing a pose while a restricted VRMA plays) is either unavailable for
  restricted sources or produces content marked restricted. The ExecPlan
  inventories these paths before implementation.
- The byte routes used for playback (`/v1/content/files/…`, the preview file
  route, and the runtime bundle file route) keep serving restricted bytes to
  authorized readers, because playback needs them. They never send an attachment
  `Content-Disposition`, and they are never linked as downloads (R6).

### R5 Backend save and import enforcement

Typed save (`PUT /v1/{kind}/{entry}` through `ContentSaveService`) and package
import reject any file whose bytes match a restricted payload, with a clear error
that does not echo file contents. This covers a client that skips the UI
restriction, re-uploads bytes fetched for playback, or submits an imported copy.
Byte-identical matching is the enforced minimum. Modified derivatives are covered
by UI unavailability (R4) and by policy. The spec does not require similarity
detection.

### R6 Delivery format (deliberate decision)

Loose `.vrma` files are acceptable inside the Electron runtime content (outside
ASAR, like other immutable core content) and on hosted origins or a CDN, because
Mixamo requires no technical protection. This is recorded as a deliberate
decision. These files are:

- not documented as downloadable assets, not listed in any public index or
  directory listing, and not offered through any download affordance;
- on hosted origins, served only to authenticated application sessions through
  the product's file routes or equivalent unlisted URLs, never from a public
  asset-pack location.

### R7 Kept out of source and self-host builds

- No Mixamo-derived file (payload, descriptor, generated portrait or private
  inventory) is committed to Git, present in a Docker build context, or included
  in a self-host image or build, or in the public package-set artifacts (backend
  wheel and npm packages) that Cloud consumes.
- **Private store (D4):** a dedicated, owner-only prefix in the existing private
  R2 bucket that hosted deploy already reads, never the public desktop release
  bucket. The bucket must have no public access (no `r2.dev` URL and no custom
  domain); this is verified before the first upload and again before each
  release. Build and deploy credentials are read-only and scoped to the prefix
  where R2 supports it.
- Desktop and hosted build or deploy steps fetch the files from the private store
  into a dedicated build-input directory outside `content/`. Ignored copies in a
  checkout, including those placed by the Local installer, never satisfy the gate.
- The tracked-only staging gate gains an explicit, reviewed allowlist: a tracked
  manifest of expected non-portable paths with SHA-256 hashes, which is
  public-safe. Staging admits an untracked input only when it comes from the
  dedicated build-input directory and exactly matches the manifest. A missing,
  extra or mismatched file fails the build with the offending path. Changing the
  manifest requires owner review.
- A source tree, Docker context, package-set artifact or self-host build
  containing any manifest hash fails its check.
- Starter content and starter creation are unchanged in every build. Self-host
  starter content and the optional Local installer behave as they do today and
  pass the existing checks without the private store.

### R8 Provenance records

- **Private inventory** (kept in the private store, never in Git): for each clip,
  the Mixamo animation name and ID, character, export settings, download date,
  licensee (the owner's Adobe ID), the conversion tool, version and steps, and the
  resulting SHA-256. Per D9, the pack ships the existing legacy conversions:
  fields that were never recorded (animation ID, character, export settings,
  download date, conversion version) are marked "not recorded", and the record
  carries the converter each file reports and the date it entered the legacy
  repository.
- **Public-safe entry** in `content/included/licenses/inventory.json`: the
  non-portable rule, creator, license reference, the provenance summary and the
  link to this decision. It contains no Adobe ID, account data or private path.
- The build fails if any manifest entry lacks a complete private-inventory record.
  The check runs where the private store is available and reports only
  pass/fail and the path.

### R9 Hosted Cloud parity

Hosted Cloud is expected to reach parity with this codebase, so the hosted
composition ships and plays these items the same way as desktop (D7). It
inherits the restriction from shared backend services (R2–R5) through the public
package set, without Cloud-specific code in this repository, and its deploy
fetches the bytes from the same private store (R7). In the hosted composition,
users can never share, publish, export or transfer non-portable items to one
another, including through any future sharing or publishing feature. Cloud's own
plans own private-store access and deployment steps.

### R10 Release gate

A desktop or hosted release containing non-portable items is not published until
the owner has reviewed the current Adobe General Terms and Mixamo terms, or
obtained Adobe's written confirmation, and recorded the dated, non-sensitive
outcome in the release review (D6). This is an owner gate, not an implementation
phase; implementation and merge may proceed before it.

## Constraints

### Licensing basis

This section records the owner's reading of the public terms. **It is not legal
advice.**

- Adobe's Mixamo licensing FAQ allows Mixamo characters and animations in any type
  of creative project, video games included, royalty-free. It forbids distributing
  the raw animation files: standalone, in asset packs or engine templates, or for
  free. A file is acceptable only when it is part of the product and not handed out
  as a reusable asset.
  Source: [Adobe Mixamo FAQ (community)](https://community.adobe.com/t5/mixamo-discussions/mixamo-faq-licensing-royalties-ownership-eula-and-tos/m-p/13234775).
- Adobe has never officially answered whether *modified* Mixamo animations may be
  redistributed. Community answers say no. This spec therefore treats a converted
  or edited derivative the same as the original.
  Source: [community thread](https://community.adobe.com/questions-696/use-and-distribution-of-created-animations-based-on-mixamo-animations-589442).
- The existing license inventory also cites the [Mixamo FAQ](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html)
  and [Mixamo Additional Terms](https://wwwimages2.adobe.com/content/dam/cc/en/legal/servicetou/Mixamo-Addl-Terms-en_US-20210623.pdf).
  The Additional Terms also prohibit using Mixamo content to create, train, test or
  improve machine-learning systems. Non-portable Mixamo items are used only for
  avatar playback.
- Mixamo does not require technical protection against extraction. The obligation
  is that the product does not offer the files as reusable assets.

Release gate: before any build that contains these items is released, the owner
reviews the current Adobe General Terms and Mixamo terms, or obtains Adobe's
written confirmation, and records the outcome (R10).

### Conflicts with established decisions

- **Current exclusion.** The redistribution review, platforms guide, `.gitignore`,
  `.dockerignore` and acquisition guide all state that Mixamo-derived VRMA files
  are never included in desktop packages. This spec reverses that for desktop and
  hosted builds only. The self-host and source exclusions stay.
- **Inventory provenance.** The two existing Mixamo rules in
  `content/included/licenses/inventory.json` (`gestures/**/*.vrma` and
  `idle-styles/starter/animations/*.vrma`) record a 2026-09-03 owner decision to
  ship converted VRMA as embedded runtime content. Later documentation excluded
  them, and the rules carry no `distribution` key. Delivery replaces these rules
  with the new class in R2, so the history is not left ambiguous.
- **Uniform Included semantics.** Today every Included item is readable,
  customizable into a Local copy and exportable in content packages.
  [ADR 0004](../../adr/0004-filesystem-content-and-recoverable-mutations.md) treats
  the source partition as distinct from ownership, but no existing record defines
  Included content that is usable but not portable.
- **Terminology.** The glossary uses "built-in" for read-only Model templates and
  defines **Portable package**. The class is therefore named **non-portable**
  (D5): it names the restriction and does not overload "built-in".
- **ADR required.** A new ADR (next number at landing, currently 0015) records the
  non-portable redistribution class: content admitted only through private build
  inputs, enforced by the backend, and never exportable or copyable. It reverses a
  deliberate exclusion, is costly to undo once shipped, and has real alternatives
  (keeping the Local-only installer, or authoring replacement motion as in #282).
  The ADR lands with the implementation PR, and the glossary gains a
  **Non-portable content** entry.

### Other constraints

- **Public-ready records.** Treat this repository as publicly readable. Specs,
  plans, issues and tracked manifests contain no Adobe ID, credentials, download
  URLs with tokens, bucket credentials or private paths.
- **Repository independence.** The public repository builds, tests and runs
  without the private store, a Cloud checkout or Mixamo files
  ([repository boundaries](../../architecture/repository-boundaries.md)).
- **Compatibility.** Existing Local items created with the optional installer
  stay ordinary, editable Local content unless their bytes match a non-portable
  payload. In that case R5 applies to any new save or import, but existing files
  are not deleted. The ExecPlan must decide how such pre-existing matches are
  surfaced. Packages exported before this change keep importing under R5.
- **Security.** Enforcement is server-side. UI affordances are explanatory only.
  Errors do not reveal file contents or private-store locations. Private-store
  credentials stay in owner-only external configuration.
- **Accessibility.** Unavailable actions explain the restriction in text, not by
  colour or icon alone.
- **Development.** Do not add Alembic revisions. Update the baseline schema
  directly if catalog storage changes.

## Acceptance criteria

- [ ] R2–R5: backend tests show each route rejects or omits non-portable items.
      Routes: content package export and summary, Anima export with explicit and
      implicit bindings, prepared-export recheck, package import of a crafted
      package containing restricted bytes, typed save of re-uploaded restricted
      bytes, and dependent Local Idle Style export. Errors name the items and do
      not echo bytes.
- [ ] R4: frontend tests and a desktop-viewport browser check show that
      Customize, Save, duplicate and JSON export are unavailable for a restricted
      Gesture, with a text explanation; that duplicating the Included Idle Style
      and saving reference-only Local Idle Styles still work; and that the
      sampling paths the ExecPlan inventories behave as specified.
- [ ] R3 import fallback: a round trip of an exported Anima binds to a matching
      non-portable Included item where present and falls back with a review notice
      where absent.
- [ ] R6: playback byte responses carry no attachment `Content-Disposition`, and
      no documentation or UI offers non-portable files for download.
- [ ] R7: a desktop stage and the hosted deploy artifact contain every manifest
      file with matching hashes. `git ls-files`, the Docker build contexts, the
      public package-set artifacts and a self-host image contain none of them,
      checked by hash. Staging with only ignored local copies fails. Staging with a
      mismatched or extra file fails.
- [ ] R7: the private store's bucket has no public access, verified before the
      first upload and recorded without credentials.
- [ ] R7: self-host `./reset.sh` creates both starter companions and passes the
      existing starter checks without the private store. Starter loadouts are
      unchanged in desktop and hosted builds. The optional installer still
      installs Local content.
- [ ] R8: all 35 shipped clips have a complete private-inventory record (D9), verified
      by the build check. The public inventory entry contains no personal data.
- [ ] R1: owner playback check in the desktop app and the hosted app of all 35
      clips and the Included Idle Style on both Included Avatars,
      `AvatarSample_Y_0` (VRM 0) and `AvatarSample_A_1_New` (VRM 1). Retargeting
      and foot contact must look correct, not merely play. Owner-only check,
      recorded in the PR and plan. Where hosted avatar playback does not yet
      exist, the hosted check is deferred to Cloud's plan and recorded as such.
- [ ] Documentation: the ADR is accepted, and the redistribution review, platforms
      guide, acquisition guide, `content/included/README.md` and glossary describe
      the non-portable class and leave no contradictory statement.
- [ ] R10: the owner's dated terms review or Adobe's written confirmation is
      recorded before release. This is a release gate.

## Open questions and decisions

Status: Agreed
Owner decision: intent discovery with the owner on 2026-10-07 resolved Q1–Q5,
the goal revisit after #282, hosted consumption and the release gate (D1–D7
below). The owner's 2026-10-01 task instruction established the original goal,
licensing basis and requirements.
Source baseline: `d4f7028f` (`origin/main`, 2026-10-07); first drafted at
`17584fa1` (2026-10-01).

Decisions (2026-10-07):

- **D1 Goal after #282:** Mixamo is still wanted. Ship all 29 former starter
  clips, regardless of overlap with agent-authored 2.0 Gestures. #310 promotion
  and #314 hand work proceed independently.
- **D2 Q1 clip scope:** the 29 `starter_target` clips (23 Gestures and 6 idle
  loops), plus one non-default Included Idle Style that pools the idle loops.
  Library only: none becomes a starter default in any build.
- **D3 Q2 Anima export:** omit restricted items, carry non-portable references
  and rebind on import, with fallback and review notices (R3).
- **D4 Q3 private store:** a dedicated owner-only prefix in the existing private
  R2 bucket that hosted deploy already reads, with no public access on the bucket
  and bucket-scoped, read-only build credentials (R7; R2 tokens cannot be
  limited to a prefix). Not the public desktop
  release bucket.
- **D5 Q4 and Q5:** no visible Library label; unavailable actions explain the
  restriction. The class is named `non-portable` (inventory value and glossary
  term).
- **D6 R10:** kept as written. Owner review of current Adobe terms, or Adobe's
  written confirmation, gates the first release containing these items, not
  implementation or merge.
- **D7 Hosted Cloud:** assume parity with this codebase. The hosted composition
  ships and plays these items like desktop, inheriting enforcement through the
  public package set and fetching bytes from the same private store (R9).

Decisions (2026-10-08):

- **D8 Clip selection (revises D1 and D2):** after a playback review of all 71
  legacy conversions, the owner selected 35 clips: 24 of the former starter
  clips (not Blush Head scratch, Explain, Slight Bow, Talk or Idle Sway) plus 11
  others. Idle Happy replaces Idle Sway in the Idle Style's pools. Raw legacy
  names are replaced with descriptive names and descriptions.
- **D9 Legacy conversions (revises R8's fresh downloads):** ship the existing
  legacy VRMA conversions instead of downloading afresh, with the provenance
  that exists.
- **D10 Private store:** the bucket has no public access (no `r2.dev` URL,
  custom domain or CORS rules); separate read-only and read-write tokens are
  scoped to it and kept in owner-only files.

No blocking questions remain. The ExecPlan inventories the creator sampling paths
(R4) and decides how pre-existing Local matches are surfaced (Constraints).

## Spec

[Issue #242](https://github.com/raymond-van/animama/issues/242) is authoritative; this file is its snapshot.

## ExecPlan

[mixamo-built-in-motion-execplan.md](mixamo-built-in-motion-execplan.md). Phases: #323, #324, #325, #326, #327.

## Delivery links

None yet.

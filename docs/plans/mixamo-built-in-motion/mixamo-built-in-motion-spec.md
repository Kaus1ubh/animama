# Ship Mixamo-derived motion as built-in content in desktop and hosted builds only

Status: Proposal
Owner decision: Pending. The owner's 2026-10-01 task instruction establishes the
goal, licensing basis and requirements below; the open questions remain undecided.
Authoritative source: [issue #242](https://github.com/raymond-van/animama/issues/242).
This file is an issue snapshot, published and read back at `2026-10-01T18:05:11Z`.
Source baseline: `17584fa1` (`origin/main`, 2026-10-01).
ExecPlan: required before implementation (substantial, licence-sensitive work
spanning backend enforcement, frontend affordances, build inputs and release gates).

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
than the owner's development installation. The owner wants the desktop (Electron)
app and the hosted Animama Cloud app to ship a set of Mixamo-derived Gestures and
Idle Style motions as built-in avatar motion. They must not leave the app as
reusable assets, and the self-hosted web app and the source repository must never
contain or distribute them.

Intended users: desktop and hosted Animama users, who get richer built-in motion;
self-hosters, whose experience is unchanged; and the owner, who needs a release
process that stays within Adobe's terms and leaves an audit trail.

## Licensing basis

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
  improve machine-learning systems. Built-in Mixamo items are used only for avatar
  playback.
- Mixamo does not require technical protection against extraction. The obligation
  is that the product does not offer the files as reusable assets.

Release gate: before any build that contains these items is released, the owner
reviews the current Adobe General Terms and Mixamo terms, or obtains Adobe's
written confirmation, and records the outcome (R10).

## Conflicts with established decisions

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
- **ADR required.** A new ADR (next number at landing, currently 0012) should
  record the built-in-only redistribution class: content admitted only through
  private build inputs, enforced by the backend, and never exportable or copyable.
  It reverses a deliberate exclusion, is costly to undo once shipped, and has real
  alternatives (keeping the Local-only installer, or authoring replacement motion).
  The ADR lands with the implementation PR. The glossary should define the class
  term once the name is chosen.

## Goals, scope and non-goals

In scope:

- A **built-in-only** redistribution class for Included content, marked in the
  public license inventory and enforced by the backend.
- Shipping a chosen set of Mixamo-derived Gestures and Idle Style motions as
  built-in-only content in the desktop and hosted builds.
- Closing every route by which such an item could leave the app as a reusable
  file or become a user-owned copy.
- Private build inputs: an owner-only store, a reviewed staging allowlist, and
  provenance records.
- Verifying build contents and playback.

Non-goals:

- Changing the self-hosted web app, its starter content, or the optional Local
  installer and its manifest.
- Technical protection (encryption or obfuscation) against users who extract bytes
  from the installed app or from network traffic.
- Building hosted sharing, publishing or a marketplace. None exists today. This
  spec only constrains any future hosted surface.
- Implementing Cloud deployment steps. Cloud owns its own plans and consumes the
  public contract defined here.
- Recovering the original Adobe IDs for the existing private converted files by
  guesswork. Provenance must be recorded from the actual download (R8).

## Required behavior

### R1 Built-in Mixamo content in desktop and hosted builds

The desktop app and the hosted composition include the selected Mixamo-derived
Gestures and Idle Style motions as Included content. They can be selected in Anima
loadouts and Idle Styles, invoked by the companion, and previewed in Library.
Whether they become starter defaults in those builds is part of the clip-scope
decision (Q1). Self-host starter content must not depend on them (R7).

### R2 Built-in-only marking

The public license inventory gains a reviewed redistribution class (working name
`"distribution": "built-in-only"`). It marks matching Included entries as usable
in the product but never portable. Rules match the selected item folders: the
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
  Style whose pools reference built-in Mixamo Gestures, follows the same rule as
  Anima export below.
- **Anima export** (an `anima_id` package, including implicit starter bindings
  added during capture) **proposed default, pending Q2:** omit restricted items and
  carry each as a non-portable reference (logical key and kind only, no bytes or
  descriptor). Export review lists every omitted item. On import, a reference binds
  to the importing installation's own matching built-in item if one exists.
  Otherwise the slot falls back to the importer's normal default (no Gesture, or
  the Default pool without that Gesture), and import review states this. Blocking
  is rejected as the default because once these items are starter defaults,
  every desktop Anima would reference them and export would never work.
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
- Idle Style editor: duplicating a built-in-only Idle Style, or saving a Local Idle
  Style that references built-in-only Gestures, is allowed, because it stores
  references only, not motion bytes. The resulting Local Idle Style is exportable
  only under R3's dependency rule.
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
  in a self-host image or build.
- Desktop and hosted build or deploy steps fetch the files from a private,
  owner-only store into a dedicated build-input directory outside `content/`. Ignored
  copies in a checkout, including those placed by the Local installer, never
  satisfy the gate.
- The tracked-only staging gate gains an explicit, reviewed allowlist: a tracked
  manifest of expected built-in-only paths with SHA-256 hashes, which is
  public-safe. Staging admits an untracked input only when it comes from the
  dedicated build-input directory and exactly matches the manifest. A missing,
  extra or mismatched file fails the build with the offending path. Changing the
  manifest requires owner review.
- A source tree, Docker context or self-host build containing any manifest hash
  fails its check.
- Self-host starter content, starter creation and the optional Local installer
  behave as they do today and pass the existing checks without the private store.

### R8 Provenance records

- **Private inventory** (kept in the private store, never in Git): for each clip,
  the Mixamo animation name and ID, character, export settings, download date,
  licensee (the owner's Adobe ID), the conversion tool, version and steps, and the
  resulting SHA-256.
- **Public-safe entry** in `content/included/licenses/inventory.json`: the
  built-in-only rule, creator, license reference, the provenance summary and the
  link to this decision. It contains no Adobe ID, account data or private path.
- The build fails if any manifest entry lacks a complete private-inventory record.
  The check runs where the private store is available and reports only
  pass/fail and the path.

### R9 Hosted Cloud constraint

In the hosted composition, users can never share, publish, export or transfer
built-in-only items to one another, including through any future sharing or
publishing feature. The restriction lives in shared backend services (R2–R5), so
the hosted composition inherits it without Cloud-specific code in this
repository. Cloud's own plans own private-store access and deployment.

### R10 Release gate

A build containing built-in-only items is not released until the owner has
reviewed the current Adobe General Terms and Mixamo terms, or obtained Adobe's
written confirmation, and recorded the dated, non-sensitive outcome in the
release review. This is an owner gate, not an implementation phase.

## Constraints

- **Public-ready records.** Treat this repository as publicly readable. Specs,
  plans, issues and tracked manifests contain no Adobe ID, credentials, download
  URLs with tokens, or private paths.
- **Repository independence.** The public repository builds, tests and runs
  without the private store, a Cloud checkout or Mixamo files
  ([repository boundaries](../../architecture/repository-boundaries.md)).
- **Compatibility.** Existing Local items created with the optional installer
  stay ordinary, editable Local content unless their bytes match a built-in-only
  payload. In that case R5 applies to any new save or import, but existing files
  are not deleted. The ExecPlan must decide how such pre-existing matches are
  surfaced. Packages exported before this change keep importing under R5.
- **Security.** Enforcement is server-side. UI affordances are explanatory only.
  Errors do not reveal file contents or private-store locations. Private-store
  credentials stay in owner-only external configuration.
- **Accessibility.** Unavailable actions and any Library label explain the
  restriction in text, not by colour or icon alone.
- **Development.** Do not add Alembic revisions. Update the baseline schema
  directly if catalog storage changes.

## Acceptance criteria

- [ ] R2–R5: backend tests show each route rejects or omits built-in-only items.
      Routes: content package export and summary, Anima export with explicit and
      implicit starter bindings, prepared-export recheck, package import of a
      crafted package containing restricted bytes, typed save of re-uploaded
      restricted bytes, and dependent Local Idle Style export. Errors name the
      items and do not echo bytes.
- [ ] R4: frontend tests and a desktop-viewport browser check show that
      Customize, Save, duplicate and JSON export are unavailable for a restricted
      Gesture, that Idle Style reference-only copies still save, and that the
      sampling paths the ExecPlan inventories behave as specified.
- [ ] R3 import fallback: a round trip of an exported Anima binds to a matching
      built-in item where present and falls back with a review notice where absent.
      This criterion depends on Q2.
- [ ] R6: playback byte responses carry no attachment `Content-Disposition`, and
      no documentation or UI offers built-in-only files for download.
- [ ] R7: a desktop stage and the hosted deploy artifact contain every manifest
      file with matching hashes. `git ls-files`, the Docker build contexts and a
      self-host image contain none of them, checked by hash. Staging with only
      ignored local copies fails. Staging with a mismatched or extra file fails.
- [ ] R7: self-host `./reset.sh` creates both starter companions and passes the
      existing starter checks without the private store. The optional installer
      still installs Local content.
- [ ] R8: every shipped clip has a complete private-inventory record, verified by
      the build check. The public inventory entry contains no personal data.
- [ ] R1: owner playback check in the desktop app and the hosted app of every
      shipped clip on both included avatars, `AvatarSample_Y_0` (VRM 0) and
      `AvatarSample_A_1_New` (VRM 1). Retargeting and foot contact must look
      correct, not merely play. Owner-only check, recorded in the PR and plan.
- [ ] Documentation: the ADR is accepted, and the redistribution review, platforms
      guide, acquisition guide, `content/included/README.md` and glossary describe
      the new class and leave no contradictory statement.
- [ ] R10: the owner's dated terms review or Adobe's written confirmation is
      recorded before release. This is a release gate.

## Open questions and decisions

Raise these with the owner. Do not decide them alone.

- **Q1 Clip scope:** the 29 former starter clips (23 Gestures and 6 idle motions,
  the `starter_target` entries in `scripts/mixamo-assets.json`), or a new list?
  Should they become starter defaults in desktop and hosted builds? The original
  Adobe IDs and export settings were never recovered, so either choice needs fresh
  downloads with recorded provenance (R8).
- **Q2 Anima export behavior:** the proposed default is to omit and carry a
  non-portable reference with import-side rebinding (R3). The alternatives are
  plain omission without rebinding, or blocking the export.
- **Q3 Private store location:** the recommendation is a separate private R2 bucket
  with owner-only credentials, distinct from the public release bucket used for
  desktop distribution. Hosted deploy fetches from the same store.
- **Q4 Library label:** should built-in-only items carry a visible label? The
  recommendation is a small text label such as "Built-in", so the unavailable
  export and customize actions are understandable.
- **Q5 Class name:** the working name `built-in-only` is used for the inventory
  value and the glossary term.

## Spec

[Issue #242](https://github.com/raymond-van/animama/issues/242) is authoritative; this file is its snapshot.

## ExecPlan

Required, not yet written. Write it at
`docs/plans/mixamo-built-in-motion/mixamo-built-in-motion-execplan.md` after the
owner resolves the blocking open questions.

## Delivery links

None yet.

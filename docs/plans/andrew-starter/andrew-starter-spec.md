# Male starter Anima Andrew replaces Caitlyn

Status: Agreed.
Owner decision: 2026-10-19 discovery answers and voice choice set the outcome
and choices below; implementation authorized the same day.
Authority: https://github.com/raymond-van/animama/issues/618 (this file is a
snapshot captured at the issue's 2026-10-20T14:43:50Z revision).

## Problem and intended users

A fresh installation creates two starter Animas, Annie and Caitlyn, and both are
female. A new installation owner who wants a male companion has to build one in
the Anima creator before the first chat. Caitlyn's Avatar is also the unmodified
VRoid sample `AvatarSample_Y_0`, which anyone can export.

The change serves new installation owners, who should get one female and one
male starter, and content authors, whose review renders and per-Avatar tuning
cover the two Included Avatars.

## Goals, scope and non-goals

In scope:

- A new starter Anima, Andrew, replaces Caitlyn in the starter set. He uses the
  owner's Andrew 1.0 VRM, an edited VRoid sample whose hair the owner changed.
- `AvatarSample_Y_0` and Caitlyn's portrait leave Included content. Andrew's
  Avatar takes their place wherever a second Included Avatar is used, including
  review tooling, per-Avatar tuning, tests, skills and documentation.
- Andrew's default voice is a male PocketTTS voice that ships as a core voice.

Non-goals:

- Annie and her Avatar are unchanged. Replacing Annie's VRM is separate work.
- No starter-specific loadout. Andrew uses the shared starter loadout, including
  its female-coded moves.
- No migration or adoption of existing Caitlyn data. Development databases may be
  reset.
- No starter greetings or memories, which no starter has today.
- Azelma stays a core voice even though no starter uses it.

## Required behavior

- R1 Starter set: starter ensure on a fresh installation creates exactly Annie
  and Andrew, each with a ready receipt. The starter identities are `starter:annie`
  and `starter:andrew`; `starter:caitlyn` is no longer valid anywhere in the
  creation contract, persistence constraint or generated client. A later ensure
  never creates Caitlyn, and Andrew follows the existing starter repair and
  deleted-starter rules.
- R2 Avatar: Andrew 1.0 is an Included Avatar with a verified revision. It loads
  in chat, the creator and Library with working blink, emotion and viseme
  expressions, spring physics, and no material or skinning faults. Andrew's
  starter references this Avatar.
- R3 Portrait: Andrew has an Included portrait made from his Avatar in the same
  format, framing and metadata as Annie's. His starter, the sidebar and the Anima
  roster show it.
- R4 Voice: Andrew's starter voice is the PocketTTS preset Michael. Michael
  becomes a core voice, so Andrew speaks on a fresh offline installation with no
  downloads. The core voices are then Eve, Azelma and Michael, and Michael is
  removed from the download catalogue.
- R5 Identity: Andrew's starter identity is English Markdown in the existing
  starter section structure, written in the voice of a calm butler. He is
  composed and warm, has a dry sense of humour, and takes care of the user. It
  uses he/him and describes his actual outfit and look.
- R6 Retire Y_0: `AvatarSample_Y_0`, its portrait and their licence entries are
  removed from Included content and packaging. No shipped or seeded record, test
  fixture, script default, skill or document still refers to `AvatarSample_Y_0`,
  Caitlyn, Azelma as a starter voice, or the legacy `avt_caitlyn` seed row.
  One exception: `AvatarSample_Y_0.vrm` stays in the repository as a
  test-only VRM 0 fixture. It is stored in Git LFS outside `content/included`,
  so it is never packaged, scanned as content or listed as an Avatar, and tests
  that need a VRM 0 model keep using it. Generic test data that only borrows the
  name "Caitlyn" may stay, as may retirement entries (the seed's guarded
  DELETE, `_RETIRED_BUILTINS`, tests that retire or reject the old ids) and
  dated licence history or fixture provenance that names Caitlyn.
- R7 Tooling and tuning: every place that covers "both Included Avatars" uses
  Annie and Andrew. This includes:
  - effect, animation and content-tune renders and their aliases;
  - the desktop smoke and audit checks;
  - per-Avatar tuning and baselines: eyelid closure profile, headless VRM fixture,
    hand presets and hand offsets, and the Included clip-sample baseline;
  - the authoring skills.
  The baselines are regenerated or retuned for Andrew rather than deleted.
  Every Included Reaction passes its motion checks on Andrew. Gestures pass on
  Annie, and pass on Andrew except those listed in `KNOWN_ANDREW_FAILURES`
  (owner decision on 2026-10-20). Those 24 original clips keep small
  Andrew-only contact and clearance faults that are not visible at chat
  framing. Each stays listed only while it still fails on Andrew.
- R8 Licensing: the licence inventory and notices record Andrew 1.0 and his
  portrait as owner-authored edits of a VRoid A–Z sample preset under VRoid's
  sample and component terms. The base preset is unidentified, which is
  acceptable. The shipped VRM's embedded meta is set as follows:
  - `name` is `Andrew` with no trailing whitespace; `authors` is unchanged;
  - `commercialUsage` is `corporation`, so the file's own terms permit bundling
    in a paid app;
  - `allowRedistribution` is false, `modification` is `prohibited` and
    `avatarPermission` is `onlySeparatelyLicensedPerson`, so an extracted file
    grants no reuse outside Animama;
  - the other meta fields are unchanged.
  Only the meta changes; the mesh, materials, expressions and spring bones stay
  as they are. The licence review record for Andrew lists these values. The
  stale statement in
  `docs/frontend/desktop/redistribution-review.md` that Caitlyn is the owner's own
  creation is corrected.
- R9 Documentation: the current docs and the glossary describe the Annie and
  Andrew starter pair and the core voice set. ADR 0010 is checked: "both starter
  voices" stays true, and any new wording only states that a third core voice
  exists.

## Constraints

- Development rules apply. There is no Alembic revision: the starter-identity
  CHECK in `alembic/versions/0001_baseline.sql`, the ORM and the seed SQL are
  edited directly. Existing development databases are reset at the owner's
  discretion.
- Removing an Included Avatar breaks saved references to it, and Included
  references are never rewritten silently. An installation that still holds
  Caitlyn is unsupported after this change and must be reset.
- The generated API client is regenerated through `pnpm openapi-ts`, never
  edited by hand.
- Adding a core voice increases the core voice payload by that voice's size,
  about 8 MB for the candidates. Desktop packaging and model inventories must
  stay consistent with the core set.
- Andrew 1.0 is a VRM 1.0 file. Annie's Avatar and the code paths it exercises
  are unchanged.
- The VRM is about 16 MB and is stored like the other Included Avatars (Git LFS).
- Starter identities stay in English (ADR 0024).

## Acceptance criteria

- [ ] R1: backend starter, owner-bootstrap, DB-bootstrap and content-closure tests
  show that a fresh ensure creates Annie and Andrew only, and that
  `starter:caitlyn` is rejected.
- [ ] R2, R3, R5: on a freshly reset stack, the Andrew starter opens in chat with
  his portrait and identity. The owner checks live that he blinks, emotes,
  lip-syncs and moves naturally.
- [ ] R4: on a fresh installation without voice downloads, Andrew speaks with
  Michael's voice. Voice-catalogue and model-store tests reflect the new core
  set.
- [ ] R6: a repository search finds no remaining references to Y_0 or the
  Caitlyn starter outside generic test names and historical plans.
- [ ] R7: review renders exist for Andrew; per-Avatar tests and baselines pass;
  the motion checks pass on Andrew for all Included Reactions and for every
  Gesture not in `KNOWN_ANDREW_FAILURES`, and on Annie for all of them.
- [ ] R8: licence and redistribution checks pass with Andrew's entries, and the
  VRM meta has been reviewed.
- [ ] `uv run pytest`, `make check-test`, `pnpm verify` and the full
  `pnpm e2e:test` pass. The full browser suite is required because starter
  content and Animas change.

## Open questions and decisions

- 2026-10-19, agreed: the motive is to offer a male option. Y_0 is removed
  rather than kept. A new male voice becomes core and Azelma stays core. The
  loadout stays shared. Andrew is a calm butler type. Andrew 1.0 is final for
  now. Existing data may be reset.
- 2026-10-19, agreed: after listening to the Oliver, Noah, Michael and Ethan
  previews, the owner chose Michael as Andrew's voice.
- 2026-10-19, agreed: Annie and Andrew are both VRM 1.0, so `AvatarSample_Y_0`
  stays as a test-only VRM 0 fixture to keep VRM 0 code paths covered (R6).
- 2026-10-20, agreed: keep the 24 original Gesture clips that fail only on
  Andrew. They are listed in the test, and retuned drafts are kept outside
  the repository (R7).
- 2026-10-19, agreed: clean up Andrew's VRM meta (R8). The source file has the
  name `Andrew1.0` plus a tab, `commercialUsage: personalProfit`, and open
  redistribution, modification and avatar use. The owner, as author, may set
  these freely, and the restrictive values support the uniqueness goal.
- Proposed: draft Andrew's identity text during implementation for owner review
  before merge.

## Spec

https://github.com/raymond-van/animama/issues/618

## ExecPlan

Required. This change touches packaging, persistence constraints, core voice
delivery, per-Avatar baselines and the full browser suite, so it is substantial.
See [andrew-starter-execplan.md](andrew-starter-execplan.md) (draft, unreviewed).

## Delivery links

None yet.

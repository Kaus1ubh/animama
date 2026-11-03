# Open-source readiness and codebase polish

Source agreement: [#823](https://github.com/raymond-van/animama/issues/823), a
sub-issue of [#235](https://github.com/raymond-van/animama/issues/235) covering
its sections 1 (Open-source polish) and 3 (Other publication blockers); #235's
body was read on 2026-11-02, refreshed that day against `main` at `d3fb9875`.
The task instruction of 2026-11-02 adds the owner's goal: the repository should
document how the project is built with AI agents under a lifecycle the owner
controls, and what a reader notices first should be tidy, without rewriting
the code.
Authorized scope: the read-only audit and this plan. The implementation phases
wait for the owner's decisions and approval of this plan (gate G0).
Planning baseline: `d3fb9875` (`main`). Workspace: worktree
`funny-faraday-578ee0`, branch `chore/open-source-readiness`; no Compose stack;
backend environment `uv sync` on Python 3.12.13, `pnpm install` in
`src/frontend`, LFS content pulled.

## Purpose and context

After this plan, the source can be published under the owner's chosen licence
and route, and a public reader finds:

- a README that says what Animama is, shows it, and gives verified quick starts
  for the desktop app, self-hosting and running from source, with the licence,
  trademark note, credits, bring-your-own-key data flow, the self-host operator
  note and what happens after distribution ends;
- a short page explaining how the project is built with AI agents under the
  owner's lifecycle, linking the lifecycle documents, skills, specs, ExecPlans
  and ADRs that show it;
- complete licence records for every tracked file, and the AGPL-3.0-only
  licence applied;
- community files and public issue templates;
- process documents that are accurate, consistent and free of private or
  personal references;
- a tidier root, test and script layout and code without leftover debug code,
  where the owner agrees the cleanup is worth its risk.

Orientation:

- **Licence records.** `licenses/source-review.json` (schema
  `animama-source-license-review/1`) holds one entry per tracked file: path,
  `candidate_license`, `basis`, `copyright`, `review` and, for third-party
  inputs, `source`, `revision`, `evidence`, `notices` and `conditions`. Upstream
  notices live in `licenses/third-party/`. `content/included/licenses/inventory.json`
  holds ordered glob rules for Included content; the first rule whose `fnmatch`
  glob matches a locator supplies its provenance
  (`src/backend/animama/adapters/content_store/filesystem_store.py`,
  `_matched_provenance`). Desktop staging copies those rules into the runtime
  licence inventory (`src/frontend/desktop/scripts/runtime/licenses.mjs`), whose
  hash the owner approves per target in
  `src/frontend/desktop/runtime/release-policy.json`. Entry revisions do not
  include provenance, so changing a rule's review value changes no content
  revision. Tests pin today's `pending` state:
  `tests/test_included_content_integrity.py` and
  `tests/test_included_content_catalog.py`.
- **Source-review tool.** At the planning baseline,
  `scripts/public-release/prepare_source.py` froze tracked files, copied them
  into a candidate and applied the licence election; D2 publishes this
  repository itself, so Phase 1 replaces it with
  `scripts/public-release/check_source.py`, which checks that the review covers
  the tracked files exactly.
- **Public front door.** `README.md`, `SECURITY.md` (owned by #819), no
  community files; `.github/ISSUE_TEMPLATE/` holds the maintainer forms
  `parent.yml`, `task.yml` and `local-bug.yml`.
- **Process.** `AGENTS.md`, `SDLC.md`, `PLANS.md`, `SPECS.md`, `GLOSSARY.md`,
  `docs/agents/domain.md`, the scoped guides `src/backend/AGENTS.md` and
  `src/frontend/AGENTS.md`, `docs/adr/`, `docs/plans/` (76 folders),
  `.agents/skills/` (20 skills; `.claude/skills` links to it),
  `.claude/agents/sdlc-reviewer.md`, `.claude/hooks/` and `.claude/settings.json`.
- **Cleanup tools.** `scripts/repository-cleanup/` (pinned `scc`, Knip and
  Vulture review aids) and `docs/architecture/repository-cleanup.md`.

Files both sessions change, sequenced so the second PR rebases: the copyright
line in `src/frontend/desktop/electron-builder.yml` (Phase 1) and
`docker-compose.yml` (A2) are also touched by #819's fixes, and Tier B linting
of `product-ui` waits for #819's fix to `streamdown-response.tsx` and the memory
markdown previews.

Boundaries: #819 (the security review) owns `SECURITY.md`,
`.github/workflows/*`, repository settings, the history scan and fixes in
security-sensitive code (`src/backend/animama/local/http/`, Electron security
guards and fuses, CSP, and the update and model-download paths). A cleanup that
would touch those is left alone or taken to the owner first. This plan does not
change `LICENSE` or repository visibility until the owner decides them; changing
visibility is the owner's own action.

## Progress

- [x] Audit (2026-11-02): read-only, against `d3fb9875`; summary under
  Surprises & Discoveries.
- [x] Owner decisions D1–D6 and D9 (2026-11-02 and 2026-11-03); D7 follows
  from D2.
- [x] G0: owner approval of this plan, including D8 and D10 (2026-11-03), with
  the lifecycle documents kept at the root.
- [x] Phase 1: licence records cover the exact tree, and the licence changes
  (review passed 2026-11-03; PR pending owner merge approval).
- [x] Phase 2: README, process page and community files (review passed
  2026-11-03; in the single Phases 2–5 PR).
- [ ] Phase 3: process documents and skills are current and public-safe.
- [ ] Phase 4: agreed cleanups.
- [ ] Phase 5: publication readiness and the #235 checklist.

## Surprises & Discoveries

Audit of `d3fb9875`, 2026-11-02, read-only. Agents covered the process
documents, backend and frontend code, the repository layout and the desktop's
behaviour after distribution ends; the licence and publication facts were
measured directly. Security findings go to #819 and are not recorded here.

**Licence records.**

- `licenses/source-review.json` has 3,654 entries for 5,809 tracked files:
  2,336 files have no entry (among them the 5 tracked `.claude/` files and 81
  of 94 under `.agents/`), 181 entries name removed files, and the 59 lip-sync
  fixtures carry an open rights question (D6). Of the missing files, about
  1,070 can inherit their siblings' classification, about 1,120 are authored
  text, and 128 are binary assets whose provenance must be confirmed, most of
  them recorded as AI-generated for Animama in `src/frontend/web/public/README.md`.
- UI components adapted from MIT-licensed libraries are recorded as original
  work: shadcn/ui-style primitives in `src/frontend/web/src/ui/components/`,
  `shine-border` and `sparkles-text` (Magic UI) and `text-effect` (Motion
  Primitives), in both `web` and `product-ui`. Only the newer landing
  `text-shimmer.tsx` credits its source. Phase 1 compares each with its
  upstream and records the MIT notices.
- `content/included/licenses/inventory.json` has 414 rules, all
  `redistribution_review: pending`, over 1,349 tracked files: 1,267 owner- or
  agent-authored, 48 generated from CC0 particle inputs, 6 Annie and Andrew
  files under VRoid terms, and 28 that fall through to the legacy `**/*` rule.
  The rules marked `excluded` match no tracked file.

**Public front door.** The README still says the source is proprietary and that
no public release exists, gives Python 3.11 where the backend requires 3.12,
has no picture and does not mention how the project is built. There is no
`CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` or trademark note, the issue forms are
maintainer forms, and the repository has no homepage, topics or social preview.

**Process documents and skills.** All 298 relative links in them resolve, and
the commands they name exist, with these exceptions and problems:

- `.claude/hooks/session-start.sh` sets a personal email address as the commit
  identity in every remote session, so anyone's web session would commit as
  the owner.
- `AGENTS.md` and `SDLC.md` refer to a "skill pilot" gate defined nowhere;
  `SDLC.md` states a dated 2026-09-18 inspection of the private repository's
  protection as current.
- Contradictions: `merge-n-clean` closes issues referenced with `Refs #N`,
  which `SDLC.md` reserves for partial delivery; `git-workflow` merges through
  the REST API while `SDLC.md` and `merge-n-clean` use `gh pr merge
  --match-head-commit`; `docs/adr/README.md` lets an agent accept a record
  without the owner's confirmation; `implement` creates an ExecPlan without
  stopping for owner review; `.claude/settings.json` pre-approves bare
  `make check-test` while `SDLC.md` routes it through `scripts/heavy-slot.py`
  (a permission change, left to the owner).
- Duplicated rules have drifted: the naming rules live in both `AGENTS.md` and
  `SDLC.md`, the private-plan wording differs between `git-workflow` and the PR
  template, and the stack commands and Context7 guidance are repeated.
- Stale references: `AGENTS.md` lists a `memory` Compose profile that does not
  exist; `animama-effect-assets` relies on an `image-gen` skill outside the
  repository; `$docs-sync` is Codex notation; the `.claude/skills` link is
  explained only inside one plan; `animama-vrm` names an old three-vrm version;
  `AGENTS.md` addresses the reader as "my approval".
- Readability: `SDLC.md` opens with a 20-row table whose cells run to 59 words;
  nothing in the README introduces the lifecycle; `sdlc-reviewer` is not named
  in `SDLC.md`; "Cloud" has no glossary entry and "Raymond" and "the owner" are
  mixed.

Strengths a reader should be pointed to: bounded, tiered review with check
records bound to Git trees; 79 ExecPlans and 40 specs, 76 of them recording
review findings and revisions; evidence rules that separate local, CI and owner
acceptance; ADRs that record unknowns as unknown; the read-only reviewer agent,
format hook and permission allow-list; head-matched merges and ownership-checked
cleanup; the glossary; enforced repository boundaries; and the model
benchmark's cost caps and blind judging.

**Desktop after distribution ends** is summarized under D5. In addition, the
first-run dialog links Terms and Privacy on `animama.ai`, which must stay
reachable or move.

**Repository layout.**

- Root, 37 entries: `pytest.ini` can merge into `pyproject.toml`; the root
  `.prettierrc` and `package.json` are unused; `.vscode/` points at a removed
  `src/agents` tree and holds a personal editor setting; `src/.prettierrc`
  points at a removed `src/web-ui`. Ignore files, the `Dockerfile` and
  `pyproject.toml` still name removed trees. The rest must stay where tools
  find it.
- `docker-compose.yml`: 173 of its 382 lines are comments, including a disabled
  `gesture` service; the `voice` profile's `parakeet` service builds from a
  directory that has not existed since the repository split, so selecting that
  profile fails.
- `tests/` holds 296 flat test files. Twelve subject packages would read
  better, but the move changes about 70 `__file__`-relative paths (some would
  skip silently if missed), 58 cross-test imports, a non-recursive guard, two
  test paths in `validate-public.yml` (#819's file) and the CI selection rules
  in `scripts/ci/validation_policy.py`.
- `scripts/` couples to Cloud, packaging and CI by path; regrouping it, or
  moving the lifecycle documents into `docs/`, costs more than it gains.

**Frontend code.** No `console.log`, `debugger` or TODO markers in app code,
and explicit `any` only in a declaration file for vendored code. Findings:

- 311 of 1,119 web modules start with a Next.js `"use client"` directive,
  which nothing in this Vite and Electron app reads.
- Dead code: 10 unimported files (about 740 lines), 8 modules only their own
  tests use, 44 unreferenced exports, a 54-line commented-out array, unused
  environment fields and three unused dependencies.
- The web app compiles with `strictNullChecks` only; desktop, packages and e2e
  use `strict`.
- ESLint covers only `web`; the Prettier check skips 239 files; `knip.json`
  exists but nothing runs it.
- 21 files exceed 1,500 lines and 81 functions exceed 300; the largest is a
  3,610-line debug component.
- Duplicated helpers (35 `isRecord` copies with two different meanings, seven
  byte-identical sanitizers in the procedural-animation layers), 32 re-export
  shims that documentation cites instead of their packages, mixed hook file
  naming and a duplicate `@web/` import alias.

**Backend code.** No debugger calls, star imports, bare `except:` or TODO
markers; `print` only in command-line entry points; source functions are 99%
annotated. Findings:

- Code derived from Letta (Apache-2.0) is recorded as original work:
  `src/backend/animama/app/contracts/base.py` keeps Letta's ID-prefix helpers,
  including their special case for Job and Run classes and their deprecation
  message, and `src/backend/animama/orm/sqlalchemy_base.py` follows Letta's ORM
  base. The repository split came from a tree that held `src/letta/`
  (`.dockerignore` still names it), so Phase 1 searches for other derived code.
- Stale configuration: `pyproject.toml` excludes and per-file ignores for
  missing paths, a pydocstyle convention with no docstring rules selected, and
  inline-snapshot settings without the dependency; `Makefile` excludes a
  removed `web-ui` path.
- 531 of 588 `# noqa` comments name rules that are not selected; 84 imports
  climb up to four parent packages while 1,811 are absolute; 12 calls use the
  deprecated `datetime.utcnow()`.
- Dead code: vestigial prompt, structured-output and shim modules (about 550
  lines), a legacy voice-provider start-up path and its three adapters (about
  475 lines, plus ten Compose variables only it reads), about 490 lines of
  unused definitions and about 470 lines that only tests use.
- 62 broad exception handlers neither log nor re-raise, including start-up
  hooks that silently disable a component.
- Ten declared dependencies are never imported, while `tiktoken` is imported
  without being declared (it arrives through `llama-index-core`, which the
  desktop runtime bundles).
- mypy's `strict` is relaxed for untyped definitions and calls, and `scripts/`
  (28,000 lines) is neither formatted nor type-checked.
- Four modules exceed 1,500 lines and 30 functions exceed 150; six test files
  exceed 1,500 lines, mostly because their fakes live inline.

Cloud imports about 80 backend modules, so shared modules keep their names and
locations; anything visible in the API, schema or generated client is out of
scope.

## Decision Log

Owner answers were given in chat on the dates shown. Legal and trademark risk
assessments are kept out of this record; it holds only the choices.

- **D1 Licence.** 2026-11-02, owner: AGPL-3.0-only for original code,
  documentation and project-made assets, as proposed. Third-party material
  keeps its own terms, recorded per file. Issues are welcome; outside pull
  requests are not accepted for now, which keeps the owner the sole copyright
  holder and free to relicense; a DCO or CLA can be added later. Rationale: the
  self-host server is network software, where AGPL's network clause is the
  copyleft that applies. Alternatives offered: Apache-2.0, MIT.
- **D2 Publication route.** 2026-11-02, owner: make this repository public,
  rather than the proposed snapshot in a new repository. 2026-11-03, owner,
  after being told that the root commit (`aba32da3`, the 2026-09-08 repository
  split) holds third-party media that the 2026-09-15 licence cleanup removed
  from the tree but not from history, and that removing it would mean
  rewriting every commit and having GitHub Support detach every PR's refs:
  publish the repository as is, since the current tree does not contain those
  files. Consequences for this plan:
  - Publication exposes all 2,041 commits (2,040 authored with a personal email
    address), 242 branches, 2 tags, every issue and PR with its comments and
    edit history, and every LFS object ever pushed.
  - `LICENSE` and the package licence metadata change in this repository, not
    in a candidate copy; the snapshot tool no longer selects what is published.
  - Links to this repository's issues and PRs (407 in 135 files) resolve once it
    is public, so they stay as they are.
  - Phase 5 adds a review of the tracker (issue and PR bodies, comments and
    edit history) and of the branches before the visibility change. The owner
    changes visibility after #819's gates.
  - Optional, not required by this decision: GitHub Support can be asked to
    purge orphaned LFS objects without rewriting history.
- **D3 Trademark note.** 2026-11-02, owner: the short note without a ™ or ®
  claim, as proposed: the licence covers the code, not the name or logo;
  describing a project as based on or compatible with Animama is fine; a
  distributed or hosted modified build takes a different name and icon,
  changes the app identifier, update channel, release storage and model
  origin, and does not imply endorsement.
- **D4 Name risk.** 2026-11-03, owner: accepted; publish as Animama. The
  acceptance and its basis are held privately.
- **D5 After distribution ends.** 2026-11-02, owner: a final release, then cut
  off, as proposed. Today an installed app checks for updates once, 15 seconds
  after start, and hides a failed check; chat, avatars and the three bundled
  voices keep working offline, while dictation, Voice Mode, offline speech
  recognition and the 35 on-demand voices need model files from
  `downloads.animama.ai`, as do the source scripts' default acquisition and 24
  voices encoded for Animama. Before the cut-off, a final desktop release stops
  update checks (a flag sealed into the build) and explains that downloads have
  ended and how to supply model files; the source scripts default to upstream
  sources; the final feed stays up for a short transition, then the download
  domain is disconnected. Older builds then fail their update check silently
  and show download errors. That code touches the update and model-download
  paths #819 owns, so it is a separate issue (#837); this plan writes the
  README text.
  #819's notes for that issue: the switch that stops update checks is built
  into the final release, not read from the feed, and `animama.ai` and the
  download host stay registered and under the owner's control after
  disconnecting, because installs that never take the final release keep
  contacting them.
- **D6 Lip-sync fixtures.** 2026-11-03, owner: keep the 59 files under
  `src/frontend/web/tests/lipsync/fixtures/` as AGPL-3.0-only, recording their
  basis: timing and audio-feature numbers derived from TTS outputs and from an
  evaluation-only aligner whose weights are CC BY-NC 4.0, with no audio or
  weights.
- **D7 Internal material.** Follows from D2: everything already in the
  repository is published, including `AGENTS.md`, the lifecycle documents,
  `.claude/` (`settings.local.json` stays ignored), the skills and all plans.
  Phase 3 fixes what the audit found going forward.
- **D8 Delivery.** 2026-11-03, owner, with the plan: one task branch and PR
  per phase, with Phase 4 split into a root-and-backend PR and a frontend PR,
  an exception to the one-PR-per-plan default so each area is reviewed on its
  own; each PR says `Refs #823` and the last says `Closes #823`.
  Every PR runs targeted checks and records the unrun full suite (D12).
  2026-11-03, owner, after Phase 1's PR: merge what is ready (#836, merged as
  `56cd8c51`), then deliver Phases 2–5 in a single PR, on branch
  `chore/open-source-polish` from `main`.
- **D9 Cleanup scope.** 2026-11-03, owner: Tiers A and B, and reduce the root
  further than Tier A's 33 entries where possible. On approving the plan the
  owner kept `SDLC.md`, `PLANS.md`, `SPECS.md` and `GLOSSARY.md` at the root,
  so moving `SECURITY.md` into `.github/` brings it to 32 (Phase 3 and A1).
- **D12 Checks per phase.** 2026-11-03, owner: do not run the full pre-push
  suite after each phase. Each phase and its PR run the checks their changes
  affect and record the unrun suite; this replaces D8's per-phase suite runs
  and the high-risk tier's suite-before-review step for this plan. Independent
  review still runs at each phase's tier.
- **D11 Phase 1 confirmations.** 2026-11-03, owner, answering the Phase 1
  gate: clear all four Included content classes as classified (owner- and
  agent-authored items, CC0-derived particle textures, Annie and Andrew under
  VRoid terms, the original Scene Effect descriptors); the logo and mascot
  mark were AI-generated under the owner's direction; credit the code adapted
  from other open-source projects and delete the dead derived parts; credit
  the tweakcn palette that inspired the theme without claiming its licence.
- **D10 Smaller defaults.** 2026-11-03, owner, with the plan: the
  Contributor Covenant 2.1 as the code of conduct, with the project contact
  address; repository description, homepage, topics and social preview drafted
  in Phase 2 and applied by the owner.

## Phased implementation

Every phase starts from current `main` on its own task branch (D8), reads the
#235 body again before ticking an item, and stays out of #819's files.

### Phase 1: Licence records cover the exact tree, and the licence changes

Review tier: high risk. The content inventory and licence metadata feed desktop
packaging, and the source-review tool is release tooling.

Requirements: #235 "Licence", "Refresh `licenses/source-review.json`" and
"Clear every bundled content item"; D1, D2, D6 and the content clearance below.

1. Add a coverage check, `scripts/public-release/check_source.py`, that lists
   tracked files without an entry, incomplete entries, entries for files that
   no longer exist, duplicates, entries whose licence still says "pending" and
   tracked private state, exiting non-zero on any; test it with disposable
   fixtures. Under D2 this repository is what gets published, so the candidate
   copy (`prepare_source.py`, its tests and its licence transform) is retired
   once step 8 applies the licence here.
2. Remove the 181 stale entries; files that were renamed get new entries.
3. Add entries for the 2,336 missing files:
   - inherit from same-directory siblings that share one classification
     (about 1,070 files);
   - give authored text (code, tests, docs, configuration, locales) the
     original-work attestation basis after checking each directory against
     `licenses/third-party/code-and-models.json` and the artwork notices
     (about 1,120 files);
   - classify the 128 binary assets from their provenance records. The app
     backgrounds, emotion mascots and Create illustrations are AI-generated for
     Animama (`src/frontend/web/public/README.md`); landing stills and
     portraits that render Annie or Andrew keep the VRoid model terms; screenshots
     in plan folders and test evidence are project captures. Anything without a
     record is listed for the owner, never guessed.
4. Sweep for code derived from other projects that is recorded as original:
   compare the Letta-shaped backend bases and the UI components named under
   Surprises & Discoveries with their upstreams, and search for further
   signatures (Letta, shadcn/ui, Magic UI, Motion Primitives and other
   component registries). Each derived file either records the upstream
   licence for its upstream portions, with the notice added to
   `licenses/third-party/code-and-models.md`, or is replaced; dead derived
   code is deleted here rather than attributed.
5. Resolve the 59 lip-sync fixtures per D6.
6. Content inventory: the owner confirms each class — owner- and agent-authored
   effects, gestures, reactions and artwork (1,267 files); the CC0
   Kenney/Brackeys particle derivatives (48); Annie and Andrew with their
   portraits (6, VRoid terms). The 28 files that fall through to the legacy
   `**/*` catch-all get explicit rules, so the catch-all matches nothing that
   ships. The rules then record the dated clearance in place of `pending`,
   and the tests that pin `pending` assert the cleared value instead. Entry
   revisions exclude provenance, so no content revision changes; the runtime
   licence inventory hash does, so the next desktop release needs a fresh
   inventory review, as `docs/frontend/desktop/redistribution-review.md`
   already requires.
7. Update `licenses/README.md` and `scripts/public-release/README.md` to the
   decided state.
8. Apply D1 in this repository: replace `LICENSE` with the AGPL-3.0-only text
   from `scripts/public-release/templates/`, and change the licence metadata
   the candidate transform used to rewrite (`pyproject.toml`, the
   `package.json` files marked `UNLICENSED`, the `animama` group in
   `src/frontend/desktop/runtime/license-sources.json` and the copyright line
   in `src/frontend/desktop/electron-builder.yml`). Third-party licence texts
   stay as they are.

Checks: `check_source.py` passes on the working tree; the tool's unit
tests; `uv run pytest tests/test_included_content_integrity.py
tests/test_included_content_catalog.py tests/test_content_portability.py`;
`pnpm desktop:test` from `src/frontend`; lint, format and type checks for the
touched backend and frontend files (D12: no full pre-push suite).

Gate: owner confirmation of the content classes and of any asset listed
without a record.

#### Phase 1 record

Starting revision: `aa9bee05` (`main`; the branch fast-forwarded from
`d3fb9875` before any commit, picking up #825–#827). Branch
`chore/open-source-readiness`.

Implementation notes and agent decisions, within the approved scope:

- The coverage check is a new `scripts/public-release/check_source.py` rather
  than a command added to `prepare_source.py`: under D2 nothing else in that
  tool has a job, so `prepare_source.py`, its tests and the AGPL template it
  copied are removed. The check also reports tracked private installation
  state, reusing the old tool's path rules.
- The refresh is rule-based: 44 entries follow their file's rename, 1,040
  inherit a uniform same-directory classification, 1,097 authored text files
  take the original-work attestation, and 155 were classified by hand:
  AI-generated app art recorded in `src/frontend/web/public/README.md` (96);
  renders and screenshots showing the starter Avatars, which keep the VRoid
  terms (29); the Pocket runtime port, already in
  `licenses/third-party/code-and-models.md`, joining its Apache-2.0 group (1);
  new original scripts and tests (22); and the brand mark and icons (7),
  AI-generated for Animama (D11). 181 entries for
  removed files are gone; the 59 lip-sync fixtures follow D6.
- Content clearance is recorded per rule as `cleared-2026-11-03`, or
  `excluded` for the nine rules that keep material out (LeLu's Noise Pack
  joined them in review #1). Under D2 every merge
  is published, so `tests/test_included_content_integrity.py` now rejects a
  `pending` rule, a new test requires the `**/*` fallback to match no shipped
  file, and the promote skills record the owner's approval of an item's licence
  records as its dated clearance. The 26 descriptors of the original Scene
  Effects, which only the fallback covered, get an owner-authored rule. The
  private pack inventories under `scripts/` stay `pending`: those packs are
  never published.
- A provenance sweep compared the code with likely upstreams (Letta, the
  OpenAI Agents SDK, shadcn/ui, Magic UI, Motion Primitives, ElevenLabs UI,
  Vercel AI Elements, Lucide, prompt-kit and tweakcn). Per D11, 34 adapted
  files now record their upstream licence, revision and notices; 31 have a
  two-line header (Apache-2.0 ones say they were modified) and the two Lucide
  icons and the landing text shimmer keep their existing in-file credits,
  all indexed in
  `licenses/third-party/adapted-code.md` beside byte-exact upstream licence
  texts; the 13 unmodified provider marks and their licence texts record
  models.dev and llama.cpp. The unused `radio-group.tsx` is deleted, and
  `src/backend/animama/orm/sqlalchemy_base.py` keeps only its abstract base:
  its Letta-derived query helpers and timeout decorator had no callers here or
  in the Cloud checkout. Deferred to the final desktop release (D5), because
  they change packaged notices: the desktop and hosted notice bundles do not
  yet carry the adapted UI-code or Hey API notices, the packed
  `runtime-contracts` package ships only the AGPL `LICENSE` although its
  generated client includes Hey API's MIT runtime, and the desktop's
  `included-content-attribution.txt` still credits the excluded LeLu pack.
- Entry revisions exclude provenance, so no content revision changes. The
  runtime licence inventory changes (content review values, the `animama`
  notice group), so the next desktop build needs fresh per-target inventory
  reviews; the published 0.1.2 preview keeps its own receipts. Cloud's next
  repin sees the new licence rule and the AGPL notice it copies as
  `notices/LICENSE`. npm declarations are unchanged, so no package version
  bump is needed.

Check record (working directory: repository root unless noted; `.venv` is the
worktree's `uv sync` environment on Python 3.12.13). The rows below ran on the
uncommitted tree before review #1; the reviewer and an independent checks run
repeated them on tree `c6e66560` (the index-copy hash of the working tree),
and the rows after the review ran on the repaired tree `8dd62229`:

| Command | Result |
| --- | --- |
| `.venv/bin/python -m unittest discover -s scripts/public-release -p 'test_*.py'` | 9 tests pass. |
| `.venv/bin/python scripts/public-release/check_source.py` | Passes: 5,809 tracked files, each with one entry. |
| `.venv/bin/python -m pytest -q -p no:cacheprovider tests/test_included_content_integrity.py tests/test_included_content_catalog.py tests/test_content_portability.py tests/test_starter_content_closure.py tests/test_included_derivatives.py tests/test_action_effect_override_save.py tests/test_avatar_effect_merge_transition.py tests/test_optional_sound_dependencies.py` | 97 pass. The two changed tests failed before the inventory change and pass after it. |
| `pnpm desktop:test` (`src/frontend`) | 593 pass, 1 fails, 14 skipped. The failure, "stops staging when the frontend install does not match its lockfile", also fails on unmodified `main` at `aa9bee05` in a scratch worktree: it depends on the local pnpm store, not on this change. |
| `.venv/bin/ruff check` and `.venv/bin/ruff format --check` on `src/backend/animama/orm/`, `app/contracts/base.py`, `domain/usage.py` | Pass (37 files formatted). |
| `.venv/bin/mypy src/backend/animama/orm src/backend/animama/app/contracts/base.py src/backend/animama/domain/usage.py` | No issues in 37 source files. |
| `.venv/bin/python -m pytest -q -p no:cacheprovider -n 2 tests/test_chat_compaction_repo.py tests/test_memory_manager.py tests/test_direct_chat_turn_executor.py` | 202 pass (ORM models on PostgreSQL and `Usage`). |
| `pnpm exec eslint` on the 18 changed web files (`src/frontend/web`, under bash) | Pass. |
| `pnpm exec prettier --check` on the changed web and `product-ui` files (`src/frontend/web`) | Changed web files pass. `product-ui` `message.tsx` and `theme.css` are reported, but both were already unformatted at `aa9bee05`; `product-ui` is outside `pnpm prettier:check`. |
| Full pre-push suite | Not run (D12). A first run was stopped by the owner before `make check-test` finished. |

After review #1, on tree `8dd62229`:

| Command | Result |
| --- | --- |
| `.venv/bin/python scripts/public-release/check_source.py` | Passes: 5,821 entries. |
| `.venv/bin/python -m unittest discover -s scripts/public-release -p 'test_*.py'` | 11 tests pass. |
| `.venv/bin/python -m unittest discover -s scripts/ci -p 'test_validation_policy.py'` | 34 tests pass. |
| The 8 content test files above (`pytest -q -p no:cacheprovider`) | 97 pass. |
| `ruff check` (`scripts/public-release`, `scripts/ci/validation_policy.py`, the integrity test, `src/backend/animama/orm`) and `ruff format --check` | Pass. |
| `git diff --check HEAD` | Clean. |

Independent reruns during review #1 (tree `c6e66560`): every row above passed,
plus `scripts/package-sets` tests (45), `scripts/repository-boundary/check-python-imports.py`
(no forbidden edges) and `pnpm -s check` (types and i18n). In the reviewer's
run the lockfile desktop test passed too, so that inherited failure depends on
the local pnpm store.

#### Code Review #1 Findings

Reviewed source: working tree `c6e66560`, baseline `aa9bee05`, high-risk tier,
initial review by an independent read-only reviewer, with a separate checks
rerun.

- P1-F1 (required): the Motion Primitives notice said no licence file is
  published and invented a copyright line; upstream has `LICENCE.md`
  ("Copyright (c) 2024 ibelick").
- P1-F2 (required): the `LICENSE` entry claimed original work although the file
  is the verbatim AGPL text.
- P1-F3 (required): the desktop notice copies of the provider-logo MIT licences
  were recorded as original work.
- P1-F4 (required): the 12 generated client and core files under
  `runtime-contracts/src/generated/` are Hey API's MIT runtime, recorded as
  original work.
- P1-F5 (required): 482 Reaction and effect entries still said "owner review
  (G2) pending", although G2 was approved on 2026-10-15.
- P1-F6 (optional): the fallback test let a tracked content file with no rule
  pass unnoticed.
- P1-F7 (optional): the plan and #823 still named the retired tool's commands.
- P1-F8 (optional): the record's file count and the "every adapted file has a
  header" claim were inexact.
- P1-F9 (optional): the two pnpm patches carry upstream MIT lines but were
  recorded as original work.
- P1-F10 (optional): the rules for raw particle packs with no tracked files were
  cleared, including LeLu's, whose terms D11 did not cover.
- P1-F11 (optional): `effect-promote.mjs` copies the Avatar Effect rule's review
  value into new owner-authored Particle rules.
- P1-F12 (optional): `@radix-ui/react-radio-group` is now unused.
- P1-F13 (optional): `check_source.py` accepted entries with only a path and
  documented the private paths incompletely.
- Pre-existing: five `pocket-browser-code` hashes in
  `licenses/third-party/code-and-models.json` no longer matched their files.
- From the checks rerun: three references to `radio-group` remained
  (`scripts/ci/validation_policy.py`, `docs/backend/operations/development.md`,
  and the web dependency).

#### Code Review #1 Revisions

- P1-F1 accepted: the upstream `LICENCE.md` is kept byte for byte as
  `licenses/third-party/code-motion-primitives-LICENSE.md` (including its stray
  last line), the invented notice is deleted, and the two Motion Primitives
  entries and `adapted-code.md` cite it. Verified with `gh api
  repos/ibelick/motion-primitives/license`.
- P1-F2 accepted: `LICENSE` is recorded as preserved licence text, Copyright (C)
  2007 Free Software Foundation, Inc.
- P1-F3 accepted: both desktop notice copies are recorded as preserved licence
  text.
- P1-F4 accepted: the 12 files record MIT, Copyright (c) Hey API, from
  `@hey-api/openapi-ts` 0.90.10, whose `LICENSE.md` is added; the files are not
  edited. Verified: each matches the package's `dist/clients` source except the
  generated header and import suffixes.
- P1-F5 accepted: the 482 bases now say G2 was approved on 2026-10-15
  (`docs/plans/reaction-pools/reaction-pools-execplan.md`).
- P1-F6 accepted: the test also requires every tracked content file except the
  folder README to have a rule.
- P1-F7 accepted: the plan's tool description, Phase 1 step 1, the checks lines
  and acceptance name `check_source.py`; #823's approach and acceptance were
  edited to match.
- P1-F8 accepted: the counts and the header claim are corrected here and in
  `adapted-code.md`.
- P1-F9 accepted: both patches record MIT for their upstream lines, with the
  packages' licence texts added.
- P1-F10 accepted for LeLu: its rule is now `excluded`, because its terms cover
  use in games, not redistribution. Kenney and Brackeys stay cleared: their
  packs are CC0.
- P1-F11 rejected: the copied value is the owner-authored class's dated
  clearance (D11), which covers new owner-authored work in that class; items
  with their own licence entries record their own approval date, as the
  promote skills say.
- P1-F12 deferred to Phase 4 (A4, unused dependencies), because removing it
  changes the lockfile.
- P1-F13 accepted: entries missing a path or a required field are reported as
  `malformed`, with two new tests; the README lists every private root.
- Pre-existing hash drift fixed: the five hashes are refreshed, with a dated
  note in the group's modifications.
- Leftover `radio-group` references: removed from the CI allowlist and the
  development guide; the dependency waits for A4 (P1-F12).

Repair round 1 of 2 used; review #2 is a targeted recheck of these revisions.

#### Code Review #2 Findings

Reviewed source: working tree `a1f6001e`, a targeted recheck by an independent
reviewer, with the affected checks rerun (all passed, plus the
`scripts/package-sets` tests). Every revision above was confirmed, and the
rejection of P1-F11 and deferral of P1-F12 were judged reasonable.

- P1-R2-F1 (required): 41 inventory rules still said "The owner's review of this
  content (gate G2) is pending", contradicting the corrected source-review
  entries for the same files; rule provenance ships in catalog entries.
  Optional on the same lines: 345 cleared rules still said the copyright status
  of AI-generated material "must be reviewed before public release".
- P1-R2-F2 (optional): the record said eight rules are `excluded`; there are
  nine.
- P1-R2-F3 (optional): `check_source.py` raised on a non-text licence and
  accepted blank fields.
- P1-R2-F4 (optional): the `@vitejs/plugin-react` patch quotes
  `dist/refresh-runtime.js`, which carries Meta's MIT notice.
- For D5: the packed `runtime-contracts` package and the desktop and hosted
  notice bundles omit the Hey API notice; the desktop attribution text still
  credits LeLu.

#### Code Review #2 Revisions

- P1-R2-F1 accepted: the 41 rules say the owner approved the content (G2) on
  2026-10-15, and the 345 rules say the question was left to the owner, who
  cleared the content on 2026-11-03. The only remaining "must be reviewed" text
  is on the excluded BGM rule, where it is accurate.
- P1-R2-F2 accepted: the count is corrected above.
- P1-R2-F3 accepted: fields must be non-blank text (copyright may list
  holders), with a new test.
- P1-R2-F4 accepted: the patch entry names Meta's notice.
- D5 items recorded with the other packaged-notice gaps above.

Checks after repair round 2, on tree `575ebdc5`: `check_source.py` passes (5,821
entries); the `scripts/public-release` tests (12) pass; `pytest -q` on the five
content test files and `scripts/package-sets` gives 117 passed; `ruff check` and
`ruff format --check` on `scripts/public-release` pass; `git diff --check HEAD`
is clean.

Repair round 2 of 2 used; review #3 is the final targeted recheck.

#### Code Review #3 Findings

Reviewed source: working tree `4f5ada3b`, a final targeted recheck by an
independent reviewer, with the affected checks rerun (all passed). P1-R2-F1 to
F4 are resolved and the D5 deferrals are recorded; no regression and no
blocking finding. Result: pass. Two optional wording points: 153 rules said
the copyright status "and the image generator's terms … was left" (should be
"were"), and `adapted-code.md` did not mention Meta's notice.

#### Code Review #3 Revisions

Both wording points were fixed after the pass: the 153 rules now read "were
left", and `adapted-code.md` names Meta's React Refresh notice. These are
wording-only edits outside the review budget; the implementer verified them
with the content integrity and catalog tests (22 passed). Phase 1 review is
complete.

### Phase 2: README, process page and community files

Review tier: light (documentation and templates).

Requirements: #235 README rewrite, `CONTRIBUTING.md` and `CODE_OF_CONDUCT.md`,
trademark note and public issue templates; D1, D3, D5 and D10.

1. Rewrite `README.md`: what Animama is and a picture of it; download and
   requirements, with what happens after distribution ends (D5); quick starts
   for desktop, self-hosting and running from source; bring-your-own API keys
   and what data leaves the machine; that whoever self-hosts is the operator;
   how the project is built; documentation map; licence, name and logo, and
   credits. Every command is run and every claim checked against code or
   docs; the record lists each.
2. Add `docs/agents/README.md`, "How Animama is built": the lifecycle, who
   decides what, which tool reads which file, the evidence trail and a worked
   example. Link it from the README, `AGENTS.md` and `SDLC.md`.
3. Add `.github/CONTRIBUTING.md` (D1's contribution policy, how to report bugs
   and request features, the checks to run, and the agent guides) and
   `.github/CODE_OF_CONDUCT.md`, where GitHub also finds them, and the name and
   logo note as `docs/trademarks.md` (D3), so the root does not grow.
4. Add public issue forms `bug.yml` and `feature.yml` and a `config.yml` that
   turns off blank issues and links the security policy at
   `https://github.com/raymond-van/animama/security/policy` (it resolves
   wherever the file lives), private vulnerability reporting once it is
   enabled on publication day, and the community Discord. The maintainer forms stay, labelled as such; `local-bug.yml` gives
   way to `bug.yml`, with `SDLC.md` and `SPECS.md` updated.
5. Draft the repository description, homepage, topics and social preview for
   the owner (D10).

Checks: a relative-link check over the changed Markdown; YAML parse of the
forms; `check_source.py` with the new files' entries.

#### Phase 2 record

Branch `chore/open-source-polish`, from `main` at `56cd8c51` (after #836), the
single PR for Phases 2–5 (D8). That PR must merge after #835, whose desktop
changes the README's data section describes.

- The README is rewritten: what Animama is, a picture (the landing page's
  share image), features checked against the code (152 Gestures and 168
  Reactions; 24 tracked emotions; the voice and provider options), the ways
  to run it, what happens after distribution ends (D5), self-host and
  from-source commands, keys and data, the operator note, documentation,
  licence, name and credits. The D5 paragraph says that after the cut-off,
  installed apps and built self-hosted servers can no longer install offline
  speech recognition, the 35 downloadable voices or the voice-cloning encoder,
  while a development stack can still acquire the speech recognition models
  from their pinned Hugging Face sources with `--source upstream`.
- The data section uses the wording #819 verified in code for the state after
  #835, for the desktop app and browser use, and links the safety protocol's
  "Your data" section as the full list. A separate sentence says what a
  self-hosted server sends, including Memory Manager traces to OpenAI on the
  built-in OpenAI connection.
- Speech setup follows the modes: built self-host takes Pocket TTS and Smart
  Turn from `browser_speech.py` on the host and installs offline speech
  recognition and the downloadable voices in the app; a development stack
  reads all speech models from the host, where `--source upstream` reaches the
  original publishers.
- `docs/agents/README.md` explains the lifecycle; `.github/CONTRIBUTING.md`
  (D1's no-outside-PR policy), `.github/CODE_OF_CONDUCT.md` (the Contributor
  Covenant 2.1 adopted by link, not copied) and `docs/trademarks.md` (D3) are
  new. The issue forms gain public `bug.yml` (renamed from `local-bug.yml`,
  with `SDLC.md` and `SPECS.md` updated) and `feature.yml`, a `config.yml`
  that turns off blank issues and links the security policy and Discord, and
  "Maintainer:" labels on the two maintainer forms.
- Proposed repository metadata (D10), for the owner to apply: description
  "AI companions that move, feel and remember: a 3D avatar desktop companion
  you run yourself, with your own AI provider keys."; website
  https://animama.ai; topics `ai-companion`, `avatar`, `vrm`, `desktop-app`,
  `electron`, `fastapi`, `react`, `threejs`, `text-to-speech`,
  `speech-recognition`, `self-hosted`, `ai-agents`; social preview the same
  share image.

Check record (repository root). The stack run used the staged Phase 2 tree
`3ac84f02`; the README commands it exercised are unchanged since. The
link, YAML and coverage rows ran on the final Phase 2 tree `64718ec0`. The
other rows cite code and documentation read at those trees.

| Command or claim | Evidence and result |
| --- | --- |
| `ANIMAMA_WEB_BUILD_MODE=production ./reset.sh --name osr --base-port 8950` (clean environment, no secrets) | "Local stack ready" at `http://animama-osr.localhost:8950`. `/` and `/setup` return the app with a browser's fetch-metadata headers; plain requests get 404 from the local request admission, as designed. Stopped with `docker compose -p animama-osr --profile "*" down --remove-orphans`; its one task-only volume is kept for cleanup. |
| `git clone …/animama.git`, `git lfs pull` | The repository URL is this repository's; `git lfs pull` hydrated this worktree's 533 LFS files. |
| Default port 8000 | `reset.sh` defaults `WEB_SERVER_PORT` to 8000. |
| Remote access | `reset.sh` accepts only localhost public origins (`is_loopback_host`: "remote access requires an operator-owned proxy"), so the README sends remote access through the operator's own TLS and authentication. |
| Speech setup per mode | Built self-host ignores host speech recognition sets and installs them in the app from `downloads.animama.ai` (`docs/backend/operations/model-assets.md`, built self-host; `domain/model_assets.py` host allowlist); it uses the host's `browser_speech.py` set after a `reset.sh` run. Development reads all three sets from the host (`reset.sh` model resolution). `parakeet.py` and `sensevoice.py` accept `--source upstream`; `browser_speech.py` already uses Hugging Face. The 35 downloadable voices install only through `/v1/model-assets`. |
| `make help` | Lists the backend targets. |
| Features | 152 Gesture and 168 Reaction folders under `content/included/`; 24 tracked emotions in `domain/emotions.py`; platforms in `docs/frontend/desktop/installation.md`; closed beta from the landing page's `CLOSED_BETA`. |
| Keys | Desktop vault (`docs/frontend/desktop/installation.md`); self-hosted keys from the server environment (`docs/frontend/features/model-settings.md`). |
| Data section | The desktop list is #819's verified wording for the state after #835; self-hosted Memory Manager tracing from `adapters/memory_manager/openai_agents_runtime.py` (`tracing_disabled=not connection.is_builtin_openai`) and `development.md#memory-manager-tracing`. |
| Relative-link and anchor check over the changed Markdown (scratch script) | All resolve. |
| YAML parse of the five issue forms (`yaml.safe_load`) | Pass. |
| `.venv/bin/python scripts/public-release/check_source.py` | Passes with the new files' entries. |

#### Code Review #1 Findings (Phase 2)

Reviewed source: staged tree `3ac84f02`, light tier, one independent reviewer.

- P2-F1 (required): the README described speech in built self-host wrongly:
  built mode ignores host speech recognition sets, `browser_speech.py` has no
  `--source`, all 35 downloadable voices install only in the app, and the
  acquisition block came after `reset.sh`.
- P2-F2 (required): "No analytics, crash reports or usage telemetry" was not
  limited to the desktop app; a self-hosted server sends Memory Manager traces
  to OpenAI on the built-in OpenAI connection.
- P2-F3 (required): `AGENTS.md` and `SDLC.md` did not link the process page.
- P2-F4 (required): the check record had no Git trees and did not list each
  verified command and claim.
- P2-F5 (required): the process page said AI involvement is recorded file by
  file for code; only artwork and content are. Optional on the same lines: two
  pushed branches carry `Co-Authored-By` lines, which D2 publishes.
- P2-F6 (optional): the process page omitted the final integration review and
  the session-start hook, said every skill has `agents/openai.yaml`, and
  called hosted CI minutes metered, which stops being true at publication.
- P2-F7 (optional): the security reporting route: `SECURITY.md` still says no
  route exists, `config.yml` lacks the private-reporting link, and `bug.yml`
  named the policy without a link and used maintainer language.
- P2-F8 (optional): `CONTRIBUTING.md` asked every distributed or hosted fork to
  rename, unlike the trademark note, which asks it of modified builds.
- P2-F9 (optional): reaching the app remotely also needs `--host`; "any
  computer with Docker" overlooks that `reset.sh` needs WSL on Windows; the
  D5 release had no issue.

#### Code Review #1 Revisions (Phase 2)

- P2-F1 accepted: self-host now runs `browser_speech.py acquire` before
  `reset.sh` and installs speech recognition and voices in the app; the
  Parakeet and SenseVoice commands moved to "Run from source" with
  `--source upstream`; the D5 paragraph says what installed apps and
  self-hosted servers can no longer install.
- P2-F2 accepted: the telemetry sentence is about the desktop app, and a new
  paragraph says what a self-hosted server sends.
- P2-F3 accepted: both files link the page.
- P2-F4 accepted: the record above names its trees and evidence for each
  command and claim.
- P2-F5 accepted: the page names the owner attestation for the work as a whole
  and per-file records for artwork and content, and says `main`'s commits carry
  no attribution. The two branches join Phase 5's branch review.
- P2-F6 accepted: all four points corrected.
- P2-F7 accepted in part: `bug.yml` links the policy and drops the maintainer
  sentence. The private-reporting link only works once reporting is enabled on
  publication day, so adding it to `config.yml` is a Phase 5 gate; #819 owns
  the `SECURITY.md` wording.
- P2-F8 accepted: `CONTRIBUTING.md` follows the trademark note.
- P2-F9 accepted: the README names `--host` and macOS, Linux or WSL, and #837
  tracks the final release.

Repair round 1 of 2 used; a targeted recheck follows.

#### Code Review #2 Findings (Phase 2)

Reviewed source: staged tree `b83a01c0`, a targeted recheck by an independent
reviewer, with the link, YAML and coverage checks rerun (all passed). P2-F1,
F2, F3, F5, F6, F7 (partial), F8 and F9's WSL and #837 parts are resolved.

- P2-R2-F1 (required): the README's `--host` advice was wrong. `reset.sh`
  accepts only localhost public origins, and admission compares the Origin
  exactly, so P2-F9's premise was mistaken.
- P2-F4 (required, not resolved): the record named no tree for the
  post-review rows and still described the old README text.
- P2-R2-F2 (optional): the voice-cloning encoder also downloads from
  `downloads.animama.ai`.
- P2-R2-F3 (optional): `--source upstream` sat above `browser_speech.py`,
  which rejects it; the upstreams are pinned Hugging Face exports; a paragraph
  followed a code fence without a blank line.

#### Code Review #2 Revisions (Phase 2)

- P2-R2-F1 accepted: P2-F9's `--host` part is withdrawn; the README says
  Animama listens only on the user's computer and that remote access goes
  through the operator's own TLS and authentication.
- P2-F4 accepted: the record names its trees and describes the current text.
- P2-R2-F2 accepted: the README and #837 name the cloning encoder.
- P2-R2-F3 accepted: `--source upstream` applies to the Parakeet and SenseVoice
  commands, the upstreams are called pinned Hugging Face sources, and the fence
  is followed by a blank line.

These are wording repairs on the light tier, verified by the implementer: the
relative-link check, YAML parse and `check_source.py` pass on tree
`64718ec0`. Phase 2 review is complete; repair rounds used: 2 of 2.

### Phase 3: Process documents and skills are current and public-safe

Review tier: light.

Requirements: #235 "Decide which internal material ships" (D7) and the
personal email in `.claude/hooks/session-start.sh`.

Move `SECURITY.md` to `.github/SECURITY.md`, which GitHub also reads (agreed
with #819 on 2026-11-03; #819 then edits its content at the new path), updating
its four references. `SDLC.md`, `PLANS.md`, `SPECS.md` and `GLOSSARY.md` stay at
the root (owner, 2026-11-03). With A1 the root goes from 37 entries to 32; the
rest are found by tools, packaging or Cloud at their current paths.

Then fix the process-document findings in place: the commit identity in the
session hook, undefined or dated statements, contradictions between the
lifecycle documents and skills, duplicated rules (one home, linked from the
rest), stale references and tool-specific notation. Review the current
`docs/plans/` files for wording to correct going forward; their history is
published as it is (D2).

Checks: the relative-link check; `git grep` for personal addresses and
private paths; the skill files' front matter still parses.

### Phase 4: Agreed cleanups

Review tier: standard; a move that touches CI, build or packaging inputs is
high risk and is left to the owner first.

Requirements: D9. Refactors keep behaviour and keep or add tests; the before
and after are measured with `scripts/repository-cleanup/`. Two PRs, one for the
repository root and backend and one for the frontend. Each item names its main
risk.

Tier A, recommended: low risk and visible to any reader.

- A1. Root and configuration (with the Phase 3 move, 37 root entries become
  32): merge `pytest.ini` into `pyproject.toml`; delete the root
  `.prettierrc` and `package.json`, `.vscode/` and `src/.prettierrc`;
  prune ignore rules, `Dockerfile` paths, `pyproject.toml` settings and the
  `Makefile` exclude that name removed trees. The matching exclude in
  `validate-public.yml` is #819's file and is passed to that session.
- A2. `docker-compose.yml`: remove the broken `parakeet` service, the disabled
  `gesture` block, other dead comments and the legacy voice variables; correct
  the profile list in `AGENTS.md` and the compose boundary test.
- A3. Remove the 311 `"use client"` directives.
- A4. Delete dead code: the frontend's unimported files, unused dependencies,
  environment fields and commented-out blocks; the backend's vestigial modules
  and shims, legacy voice-provider path and unused definitions, each checked
  against Cloud's imports. Test-only production code is listed for the owner
  rather than deleted.
- A5. Mechanical lint fixes: remove no-op `# noqa` (RUF100), make relative
  imports absolute (TID252) and replace `datetime.utcnow()` with an identical
  naive-UTC helper.
- A6. Delete unused re-export shims and point documentation at the packages
  they re-export.

Tier B, measure first and stop if the cost is out of proportion:

- B1. Strictness: count the errors from `strict` in the web app and from a
  strict mypy override for `animama.*` before fixing them; extend ESLint to
  packages, e2e and scripts and widen the Prettier patterns (desktop lint waits
  for #819, whose files it would touch).
- B2. Merge byte-identical helpers (the procedural-animation sanitizers, the
  backend freeze and digest helpers); `isRecord` keeps two clearly named
  variants, and environment truthiness is unified only on the owner's word,
  because it changes behaviour.
- B3. Log the silently swallowed exceptions outside `local/http/`.
- B4. Naming: the 11 `use-x.ts` hook files, the duplicate `@web/` alias, and
  module docstrings for the 20 largest backend modules.
- B5. Unused Python dependencies, except `llama-index-core`, which needs a
  desktop bundle check (high risk) and an explicit `tiktoken` dependency.

Tier C, deferred unless the owner asks: the `tests/` regroup (it edits #819's
workflow and the CI selection rules), move-only splits of oversized modules
and of test files' inline fakes, the `scripts/` regroup and moving the
lifecycle documents into `docs/`.

### Phase 5: Publication readiness and the #235 checklist

Review tier: light.

Under D2 the repository's whole record goes public, so before the owner changes
visibility:

1. Scan every issue and PR body, comment and edit-history revision for personal
   data, private paths and wording the owner may want to change, reusing
   #819's tracker export (#819 scans the same text, run logs and artifacts for
   secrets), and list them for the owner. Attached images become public too
   and are checked for personal data. Edit-history revisions can only be
   deleted in the web interface. #819's pass (2026-11-03) found no secrets in
   the tracker, run logs or artifacts and no attachments; a home-directory
   path appears only in two earlier revisions of PR #44's body. Those and
   #823's first revision are listed for the owner to delete.
2. List the 242 remote branches as merged or unmerged; the owner decides which
   to delete. List the two tags. `origin/claude/project-thread-nwnmxj` and
   `origin/chore/cloud-session-start-hook` carry `Co-Authored-By` lines.
3. On publication day, once private vulnerability reporting is enabled, add its
   link (`/security/advisories/new`) to `.github/ISSUE_TEMPLATE/config.yml`.
4. Draft, for the owner to send if wanted, a GitHub Support request to purge
   orphaned LFS objects without rewriting history.
5. Run `check_source.py` on the final tree, record the result, tick the #235
   items that are done, and list the rest as accepted or deferred by the owner.

## Validation and acceptance

From #823:

- [x] The owner has the audit and has made decisions D1–D6 and D9.
- [ ] The owner has approved this plan.
- [ ] `scripts/public-release/check_source.py` passes on the final tree, and `LICENSE` and
  the package metadata state AGPL-3.0-only.
- [ ] Every content inventory rule is cleared for redistribution, or its files
  are removed.
- [ ] Every README command and claim is verified; the community files and
  public issue forms are in place.
- [ ] The agreed PRs are open, with local validation recorded.
- [ ] Every section 1 and 3 item in #235 is ticked, or accepted or deferred by
  the owner.

Hosted CI is disabled, so each PR records local results only and says that no
hosted run took place. `gh workflow list --all` is checked immediately before
each `gh pr create` and push, because a re-enabled workflow starts billed runs.

## Idempotence and recovery

Every phase is a reviewable PR on its own branch. Nothing is published and no
repository setting changes; the visibility change is the owner's own action
after #819's gates. Changing `LICENSE` in the private repository grants nothing
to anyone until it is published, and a revert restores the old notice. Licence
records are data: a wrong classification is corrected by a follow-up commit,
and the owner's approvals are recorded with their dates. Layout moves are pure
renames in their own commits, so `git revert` restores the old layout.

## Outcomes & Retrospective

Not started.

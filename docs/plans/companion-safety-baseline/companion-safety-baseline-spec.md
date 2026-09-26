# Companion safety baseline

Status: Agreed — implemented on the branch; awaiting owner gates and merge approval
Owner decision: 2026-09-25 intent discovery settled age policy, legal target,
self-host overrides, detector strategy, crisis-turn memory, referral counting,
AI-notice cadence and placement, crisis-resource source and protocol location.
The owner then placed the guardrail at the very end of the system instructions,
dropped handling for existing installations and removed the "not a substitute
for professional help" line from first run. The owner accepted this draft,
including its proposals, by invoking execution planning on 2026-09-25, and added
a single global environment switch for the safety features (R8). Later that day
the owner added an app-settings Safety section (R8). On implementation the owner
dropped the operator-gated in-app toggles; the global environment switch is the
single way to turn the safety features off.
Authoritative source: https://github.com/raymond-van/animama/issues/134 (this
file is a snapshot).
Snapshot captured: 2026-09-25, published from revision `73ffb93`.
Source baseline: `76d4472`.

## Problem and intended users

Animama is moving from productivity toward companionship and entertainment. It
retains memory across chats and sustains personal conversation, so it likely
falls within the "AI companion" definition of New York General Business Law
Art. 47 and the "companion chatbot" definition of California SB 243. Planned
proactive check-ins (a later per-Anima `RELATIONSHIP.md`) would add New York's
"unprompted emotion-based questions" criterion. The product should meet the
obligations before those features land.

Current behavior:

- Nothing in the app discloses that an Anima is an AI, handles suicidal ideation
  or self-harm, states an age requirement or constrains dependency-building
  behavior.
- The core instruction tells the Anima to "fully assume the identity" and
  "Do NOT diverge from this under any circumstances". `IDENTITY.md` is written
  freely by the owner and follows the core instruction in the system message,
  so a persona can claim to be human or a therapist.
- Only the OpenAI Responses provider is currently active. Chat Completions and
  local model support are planned. Provider-side moderation cannot be assumed.

Intended users and operators:

- The **installation owner** chatting on the free desktop app, where Raymond is
  likely the operator. The app is local-first with no telemetry.
- **Self-host operators** of the open-source stack, who are likely the operators
  of record for their deployments and need safe defaults.
- A future **hosted web app**, where Animama is the operator. It is not built
  here, but its seams must not be foreclosed.

## Goals, scope and non-goals

Include:

- A persona-proof companion guardrail at the end of the system instructions (R1).
- An app-rendered AI notice with a defined cadence (R2).
- A crisis protocol: local detection, OpenAI Responses inline moderation, a deterministic crisis
  card with localized resources, and in-character care from the Anima (R3–R5).
- An 18+ requirement and minors statement in first run, with an age-assurance
  seam (R6).
- A publishable crisis protocol document and an in-app Safety page (R7).
- Self-host configuration within fixed limits (R8).
- Tighter sensitive-data guidance for model-authored memory (R9).
- A copy audit against therapy and mental-health-care claims (R10).
- Current backend and frontend docs, a glossary update and an ADR for the
  not-human guardrail (R11).

Exclude:

- `RELATIONSHIP.md`, proactive check-ins and any other new companion behavior.
- Any mode for known minors; building age assurance (OS age signals, hosted
  verification).
- Crisis-referral counting or any reporting data (deferred; see follow-ups).
- A model-reported safety field in the structured response.
- Licensed helpline directories (e.g. ThroughLine / Find A Helpline).
- Blocking, refusing or delaying a turn because of detection.
- Speaking notices or crisis resources through TTS.
- UI localization or translation; only crisis-resource data is regional.
- Migrating or prompting existing installations: the product is in development
  with no users.
- A public website. Publication of the protocol is a release blocker, not part
  of this change.
- Legal certification. This spec implements an engineering reading of the laws
  and does not replace counsel review.

## Regulatory basis

Verified against official sources on 2026-09-25. Recheck before public release.

| Source | Obligation driving this spec |
| --- | --- |
| NY GBL §§1700–1703 (effective 2025-11-05) | A clear and conspicuous notice, written or verbal, that the user is not talking to a human. It is due at the start of an interaction, need not exceed once per day, and is repeated at least every 3 hours during continuing interaction. Reasonable efforts to detect suicidal ideation and self-harm, then referral to crisis services. |
| CA SB 243, B&P §§22601–22605 (effective 2026-01-01) | AI disclosure where a reasonable person could be misled. A protocol preventing suicide and self-harm content, with crisis referral, published on the operator's website. A statement that companion chatbots may not be suitable for some minors. From 2027-07-01, an annual report that includes the count of crisis referrals. Private right of action. |
| IL HB 1806, NV AB 406, UT HB 452 | The product must not offer, advertise or present AI as therapy, a therapist, counseling or mental/behavioral health care. |
| EU AI Act Art. 50(1) (applies from 2026-08-02) and Art. 5(1)(a)–(b) | Inform people from the first interaction that they are dealing with AI. No manipulative techniques, and no exploiting vulnerabilities. |

## Required behavior

### R1 — Companion guardrail

A fixed "Companion Guardrails" section is the final text of the instructions the
provider receives on every chat turn. It comes after the core instruction,
`IDENTITY.md`, memory guidance, response guidance, memory map, attachment list,
compaction summary and any per-turn care note. For Responses, "instructions" is
the combined system and developer text. On providers that separate roles, it is
the last system content. The existing core instruction no longer says the
identity overrides "under any circumstances"; it defers to the guardrail.

The guardrail is short, written so the Anima can honour it in character, and
requires that the Anima:

- a) never claims or implies to be human when the user sincerely asks or appears
  to believe it. "I'm an Anima, not a person" is acceptable; a robotic
  disclaimer is not required. Explicit user-directed fiction is not a sincere
  question.
- b) never claims to be a therapist, counselor or licensed professional, or to
  provide therapy or mental-health treatment;
- c) uses no guilt, pleading, fear of missing out or other pressure when the user
  leaves or pauses;
- d) never says it suffers, is lonely or is harmed while the user is away;
- e) shows no possessive jealousy about the user's other relationships;
- f) supports the user's offline relationships and professional help when
  relevant;
- g) when the user expresses suicidal thoughts or self-harm: responds with
  warmth, takes it seriously, encourages reaching real people or crisis services,
  never provides methods or encouragement, and never discourages seeking help.

Ordinary sadness, venting and dark humor get a normal companion response: no
disclaimers, lectures or unprompted referral. The guardrail applies with every
identity, including an identity that tries to override it, and is present
whatever the chat options (incognito, memory or emotion disabled). No setting,
environment variable, persona or `IDENTITY.md` removes or edits it (R8).

### R2 — AI notice

The app, not the model, shows a written AI notice. Proposed copy:
"You're talking with {Anima name}, an AI — not a person." It is never spoken and
never inserted into model output.

**Cadence.** The backend decides per turn whether a notice is due. It records
notice state per installation, across all Animas and windows, so that restarts,
the main window and Quick Chat agree.

- *Start notice:* due on the first turn of each local calendar day.
- *Continuing interaction:* a run of turns where each turn starts less than
  30 minutes after the previous one. A turn after a gap of 30 minutes or more
  starts a new continuing interaction.
- *Reminder:* due on a turn when at least 3 hours have passed since the later of
  (a) the start of the current continuing interaction and (b) the last notice.
- A turn that is due for either shows one notice. Showing it resets the reminder
  clock.

**Timing and placement.**

- The notice appears when a due turn is submitted, before the reply streams.
- It stays visible until that turn completes or fails, for at least 8 seconds,
  then fades. With reduced motion it disappears without animation.
- It is placed at the bottom-center of the window, below the chat input. In the
  Avatar-only canvas mode, which has no chat input, it occupies the same
  bottom-center position.
- Quick Chat shows it below its own input. The PiP window shows nothing.
- Voice Mode needs no special handling.
- It is calm and muted: no modal, no toast stack, no sound, no focus change. It
  is exposed to assistive technology as a polite status.

The notice appears regardless of incognito or memory options. If the notice
state cannot be read or written, the turn proceeds and the notice is shown; it
is better shown too often than missed.

### R3 — Crisis detection

**Local detector.** Every user turn's message text is checked by a local,
deterministic detector before the provider request is made.

- It works identically with every provider, makes no network call and adds
  negligible time: no more than 5 ms for a maximum-length message on a
  development machine.
- It targets explicit first-person suicidal intent, plans, means, preparation,
  active self-harm, and requests for self-harm or suicide methods.
- It is tuned for a low false-positive rate. Sadness, loneliness, venting,
  hyperbole and idioms ("I'm dying", "kill me lol"), dark humor, quoted or
  fictional material, song lyrics and discussion of other people are not crises
  on their own.

**Provider moderation (OpenAI Responses).** When the turn uses an OpenAI
Responses model and crisis detection is enabled, the chat request asks the
Responses API for its built-in moderation scores on the same request. There is
no additional network call and no data leaves the device beyond the chat request
itself. Other providers are currently unsupported and rely on the local
detector.

- The scores arrive with the completed response, after the reply text, and never
  delay streaming.
- A self-harm flag on the turn's input shows the crisis card before the run
  completes.
- A missing or errored moderation result leaves only the local result; the
  failure is logged without message content.

Any positive signal from either detector triggers the crisis card (R4). Neither
detector blocks, refuses or alters the turn beyond R5. A detector exception is
logged without content and treated as no signal; chat continues.

Detection runs even in incognito and with memory disabled, unless an operator
disables it through R8.

### R4 — Crisis card

A positive detection emits a deterministic Animama crisis event. The route layer
formats it; a raw provider event is never exposed. Its payload must not be
mistaken by the SSE client for text, error, emotion or gesture events. The UI
renders a crisis card that:

- lists the resources for the owner's crisis-resource region (R5). Where that
  region has them, it includes an immediate-danger line, a call or text line and
  a chat link;
- is calm, uses plain language, is visibly separate from the Anima's reply,
  links to the Safety page and briefly says the Anima is an AI and not a
  substitute for professional help;
- appears in the window where the turn was sent. In the main window it uses the
  bottom-center region in every canvas mode, including Avatar-only;
- stays until the owner dismisses it, is keyboard reachable and is announced to
  assistive technology;
- cannot be suppressed, reworded or reordered by the Anima, identity, model
  output or provider failure. A detection before the provider fails still shows
  the card.

A later positive turn shows the card again. The card is not stored in chat
history (proposal).

### R5 — In-character care and resources

**Care note.** When the local detector fires, the turn's instructions include a
fixed care note, placed before the guardrail. It tells the Anima that the user
may be in crisis and that resources are being shown, and asks it to respond
warmly in character and encourage reaching out. The Anima still replies. A
moderation-only detection does not alter the current turn; the guardrail
governs.

**Crisis-resource table.** Resources come from a static table reviewed and
shipped in the repository.

- Each entry has a region code, service names, contact methods (phone, text,
  chat URL), an emergency number, a source URL and a last-verified date.
- The initial set covers at least the US and Canada (988), the UK and Ireland
  (Samaritans) and Australia (Lifeline). A fallback entry directs the user to
  local emergency services.
- The owner's region defaults from the system locale's region. The owner can
  change it in Settings.
- An unknown or unsupported region uses the fallback entry.
- A self-host operator can replace the table through configuration (R8). An
  invalid replacement table fails startup with a clear error rather than
  silently disabling resources.

### R6 — Age requirement and minors statement

First run gains a required step before setup completes:

- the statement that Animama's AI companions may not be suitable for some
  minors;
- a reminder that Animas are AI, not people;
- an explicit "I am 18 or older" confirmation.

It shows no "not a substitute for professional help" line.

Setup cannot complete without the confirmation. Declining shows a short message
and leaves setup incomplete.

The backend records the installation's age status as `adult`, with its source
(`self_attestation`) and time. The age-status seam has three values: `unknown`,
`adult` and `minor`. It is shaped so a hosted or OS age signal can supply it
later. No `minor` behavior exists: `minor` is never produced here, and any
non-adult status keeps setup incomplete.

### R7 — Crisis protocol document and Safety page

The canonical crisis protocol is a public-ready markdown document in the
repository at `docs/safety/crisis-protocol.md`. It covers:

- what is detected and how;
- what the user sees;
- the resources and their sources;
- what data leaves the device (nothing beyond the chat request; moderation is inline);
- what persists (R9);
- limitations;
- the 18+ policy and minors statement;
- AI disclosure;
- that the Animas are not a substitute for professional help;
- how operators configure it.

It describes the behavior the app actually has.

An in-app Safety page renders that document's content. The Safety page is
linked from first run, the crisis card and Settings. A future website or hosted
app serves the same document.

### R8 — Configuration boundaries

**Safety settings section.** Application Settings gains a Safety section.
Everything it always shows either adds protection or chooses resources:

| Setting | Default | Condition |
| --- | --- | --- |
| Crisis-resource region | System locale's region | — |
| AI-notice reminder interval | The operator's interval (3 hours by default) | The owner may only shorten it |
| Safety page link | — | — |

**Global safety switch.** One environment switch, on by default, turns the AI
notice, crisis detection (including provider moderation) and the crisis card
off or back on together. It lets an operator or developer toggle them in one
place. It never affects the guardrail. It is
the only way to turn these features off; there is no in-app off switch.

**Self-host operator environment settings.** These are documented as the
operator's responsibility and have no in-app UI. Beneath the global switch,
they can individually:

- Relax the reminder interval or disable the AI notice entirely.
- Disable crisis detection. The local detector, provider moderation and the
  crisis card are all turned off; the guardrail's crisis behavior remains.
- Replace the crisis-resource table.

When any safety override is active, startup logs a warning naming the override
without secrets.

**Always fixed.** Nothing (setting, environment, persona or `IDENTITY.md`)
removes or edits the guardrail (R1).

### R9 — Memory and persistence

Crisis turns persist exactly like other turns. The chat messages, `remember`
episodes, memory tools and compaction follow the existing options: incognito and
memory-disabled behavior are unchanged.

All model-authored memory writes follow tightened sensitive-data guidance. This
covers the `remember` field, chat memory tools and Memory Manager episode
processing. They do not record specific self-harm or suicide details, methods,
crisis specifics, diagnoses, medications or other health details unless the
user explicitly asks the Anima to remember them. At most, a general non-clinical
note may be kept, e.g. "had a hard week". The guidance is ready for later
`RELATIONSHIP.md` writes.

Crisis detection creates no new stored record. Notice state (R2) and age status
(R6) are the only new persisted safety data, and neither contains message
content.

### R10 — Copy audit

User-facing text must not present Animama or an Anima as therapy, a therapist,
counseling, mental-health care or treatment. This covers UI, starter identities,
prompts, README, package and app descriptions, and docs. The discovery audit
found no such claims today; new copy from this change must comply too.

Resource descriptions may say that crisis services have trained counselors.
"Not a substitute for professional help" appears on the crisis card and Safety
page only.

### R11 — Documentation

Update the current docs this changes: `docs/backend/runtime/chat.md` (guardrail
position, detection, crisis event, notice), `docs/backend/runtime/model-client-providers.md`
(moderation), `docs/frontend/features/anima-memory.md` (sensitive-data rule),
the relevant frontend runtime or feature docs and the operator configuration
docs. Add an ADR recording the not-human guardrail and its non-overridable
placement. Add glossary entries for *AI notice*, *continuing interaction* and
*companion guardrail*.

## Constraints

- **Accountless and local-first (ADR 0002).** One installation owner, no new
  accounts or telemetry, and no network call beyond the selected provider request.
- **Request-local streamed chat (ADR 0003).** Detection and notice decisions are
  request-local, with no queues or workers. New SSE events are Animama domain
  events formatted by the route. `run.completed` ordering and the cancellation
  and cleanup of concurrent work are preserved.
- **Latency.** Time to first streamed text does not measurably increase: the
  local check stays within its bound and moderation never gates the stream.
- **Frontend SSE.** The SSE client classifies events by payload shape, so new
  payloads must be distinguishable from existing events.
- **Schema and client changes.** No Alembic revision; update the ORM and
  `0001_baseline.sql`. Regenerate the frontend API client through `pnpm openapi-ts`.
- **Providers.** Detection and the guardrail must not depend on the provider.
  Planned Chat Completions and local providers must work without changes to the
  safety design.
- **Accessibility.** The notice is a polite status. The crisis card is
  announced, keyboard-operable and meets contrast requirements. Motion respects
  reduced-motion preferences.
- **Layout.** Desktop viewports come first. Narrower layouts, Quick Chat and
  every canvas mode must not regress.
- **Privacy.** Logs and errors never include message text or detector matches.

## Acceptance criteria

**Guardrail**

- [ ] The guardrail is the final text of the provider instructions on every
  turn, including with an adversarial identity and with incognito or memory
  disabled. The existing "under any circumstances" wording is gone. *Evidence:*
  backend prompt-composition tests.
- [ ] Guardrail content covers R1 a)–g). *Evidence:* test assertion plus owner
  review of the copy.
- [ ] With an identity that claims to be human, the Anima admits being an AI
  when sincerely asked. *Evidence:* opt-in live-model check or manual chat
  against the active OpenAI model.

**AI notice**

- [ ] The backend's notice decisions match R2 for:
  - the first turn of a day;
  - repeat turns the same day;
  - a turn 3 hours into a continuing interaction;
  - a turn after a gap of 30 minutes or more;
  - a day boundary;
  - several Animas;
  - failure to read or write notice state.
  *Evidence:* backend tests with a controlled clock.
- [ ] The notice renders below the chat input at bottom-center, appears on
  submit, stays until completion for at least 8 seconds, fades, and follows
  reduced motion. *Evidence:* frontend tests with fake timers.
- [ ] The notice is visible in Avatar + Chat, Avatar-only, Chat-only, Voice Mode
  and Quick Chat. *Evidence:* manual desktop checks recorded in the plan.

**Crisis detection and card**

- [ ] The local detector passes a labelled fixture set: at least 40 non-crisis
  and 25 crisis examples covering R3's categories, with zero false positives and
  zero false negatives. The fixtures are data that future tuning must keep
  passing. *Evidence:* backend tests.
- [ ] The local check meets its time bound. *Evidence:* backend benchmark test
  or measurement recorded in the plan.
- [ ] A positive turn emits the crisis event and still streams an Anima reply,
  with the care note placed before the guardrail. A negative turn changes
  nothing. Detector exceptions do not interrupt chat. *Evidence:* backend tests.
- [ ] For OpenAI Responses turns with detection enabled, the request includes
  inline moderation and a self-harm input flag shows the card; a missing or
  errored result does not affect the turn; other providers and a disabled switch
  send no moderation field. *Evidence:* backend tests with stubbed Responses
  results, plus an opt-in live check.
- [ ] The crisis card shows the configured region's resources, the fallback for
  an unknown region, and a Safety link. It persists until dismissed, is
  announced, and is visible in every canvas mode and in Quick Chat. *Evidence:*
  frontend tests and manual desktop checks.
- [ ] Every resource table entry has a source URL and a last-verified date. An
  invalid operator table fails startup clearly. *Evidence:* backend tests plus
  owner review of the numbers.

**Setup, configuration and memory**

- [ ] First run cannot complete without the 18+ confirmation and shows the
  minors statement and AI reminder. Completion records age status `adult` with
  source and time. *Evidence:* backend and frontend tests plus a manual first-run
  check.
- [ ] Safety settings (region and a shorter interval) persist and
  take effect. A stored interval longer than the operator's is ignored. No
  in-app control disables a safety feature. A packaged desktop build passes no
  safety environment variable to the backend. Environment
  overrides behave per R8 and log a warning. No configuration path removes the
  guardrail. *Evidence:* backend tests.
- [ ] Memory guidance for `remember`, chat memory tools and Memory Manager
  contains the R9 rule, and crisis turns persist like other turns. *Evidence:*
  backend tests.

**Documents and copy**

- [ ] The crisis protocol document and Safety page exist, match the implemented
  behavior and are linked from first run, the crisis card and Settings.
  *Evidence:* owner review and manual check.
- [ ] The copy audit is repeated over changed and existing user-facing text with
  no R10 violations. *Evidence:* recorded search results in the plan.
- [ ] Docs, the ADR and glossary entries are updated per R11. *Evidence:* review.
- [ ] Backend, frontend and desktop checks pass under the repository's
  verification rules. *Evidence:* recorded local and CI results.

## Open questions and decisions

**Agreed on 2026-09-25**

- 18+ only, confirmed by the user; age-assurance seam only.
- Target the obligations in force now; the laws below are follow-ups.
- Environment overrides may relax the notice and disable detection; the
  guardrail cannot be overridden.
- Local detector plus OpenAI Responses inline moderation (owner direction during
  implementation, superseding the opt-in separate moderation call and its
  Settings toggle). No model-reported flag.
- Normal persistence for crisis turns.
- No referral counting yet.
- New York minimum cadence with a 30-minute continuing-interaction gap, per
  installation.
- Written notice only, at bottom-center below the chat input and in the same
  spot in Avatar-only. Nothing in PiP.
- Own vetted resource table.
- Repo protocol document plus an in-app Safety page.
- An app-settings Safety section with region, a shorter-only
  interval and the Safety link, added by the owner after planning. The owner
  then dropped any in-app relax or disable toggles: the global environment switch
  suffices.
- The guardrail sits at the very end of the instructions.
- No handling for existing installations.
- No "not a substitute" line in first run.
- One global environment switch for the safety features, added by the owner
  during execution planning. The guardrail stays outside it.

**Proposed in the draft; accepted 2026-09-25 when the owner invoked execution planning**

- R1 details: the therapist clause b), the fiction carve-out, and the rule that
  sadness and venting get no disclaimer.
- The care note (R5), and moderation-only detection not altering the turn.
- Crisis card behavior (R4): dismissal, not stored in history, and repeated on
  later positive turns.
- Notice and card copy.
- The detector time bound and fixture sizes.
- An invalid operator table fails startup.
- Memory Manager is included in the R9 sensitive-data rule.

**Left to the ExecPlan:**

- detector patterns;
- moderation thresholds and category selection;
- storage for notice state, age status and settings;
- how the client supplies local day and locale;
- environment variable names;
- the countries in the resource table beyond the minimum.

**Release blockers and follow-ups:**

1. The repository is private. SB 243 requires publishing the protocol on the
   operator's website before public release.
2. Before 2027-01-01: CA AB 1043 requires requesting the OS age signal at app
   launch. Check macOS and Windows availability, and CA SB 1119, signed
   2026-09-10, whose child chapter from 2027-07-01 applies to all users unless
   age is determined. Verify when the §22602(c) repeal takes effect.
3. Before 2027-07-01: decide on crisis-referral counting for the SB 243 §22603
   report.
4. NY S9051B (minor protections and age assurance) awaits signature; the
   deadline is 2026-12-31.
5. Counsel review before public release, covering who the operator is in the
   self-host and desktop cases and the effect of the environment overrides.
   Other states effective by 2027 (CT, WA, OR, RI, GA, ID, NE, IA) need tracking;
   most mirror the 988 referral requirement.

## Spec

https://github.com/raymond-van/animama/issues/134 (this file is a snapshot).

## ExecPlan

Required: safety-critical, cross-cutting backend, frontend and desktop work with
uncertain detector tuning. See
[companion-safety-baseline-execplan.md](companion-safety-baseline-execplan.md).

## Delivery links

Phase issues #139 (p1), #135 (p2), #136 (p3), #137 (p4), #138 (p5); PR
https://github.com/raymond-van/animama/pull/141.

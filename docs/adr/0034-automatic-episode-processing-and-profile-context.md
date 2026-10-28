# 0034: Automatic episode processing and the profile in every turn

- Status: accepted (owner, 2026-10-28)
- Recorded: 2026-10-28
- Retrospective: no
- Original decision date: 2026-10-28 (owner agreement of the
  [episode recall and processing spec](https://github.com/raymond-van/animama/issues/775))
- Decision basis: Explicit owner decision
- Partly supersedes: [ADR 0009](0009-shared-user-memory-and-per-anima-relationship-memory.md)'s
  rejection of automatic background consolidation, for shared user memory only

## Context

ADR 0009 rejected automatic background consolidation: it would spend model tokens
without an owner action and rewrite files without review. Episode notes saved by
chat's `remember` field therefore reached curated memory only when the owner
opened the Memory Manager and started episode processing, so notes stayed
`pending` and `PROFILE.md` kept its template text. Chat instructions included the
Anima's `IDENTITY.md` and `MEMORIES.md` but listed `PROFILE.md` only in the memory
map, and recent notes reached a fresh chat only when the model searched for them.
In the #470 model benchmark, models searched in 12 of 96 recall turns and every
recalled note came from a search. The owner kept `remember` and asked for its
processing to be automated.

## Decision

1. **The profile and recent notes are in every turn.** With memory influence on,
   each turn's system instruction includes `PROFILE.md` (its first 16 KiB, at a
   line boundary) and the current Anima's recent episode notes from other chats
   (up to 20 notes and 3,000 characters from the last 14 local days), framed as
   notes, never instructions. This applies in every composition.
2. **The local composition processes notes automatically.** Once the owner's
   pending notes reach a threshold (default 10, Off or 5–50 in App Settings), an
   in-process backend worker starts an episode-processing run and approves its own
   proposals through the ordinary approval path. Runs start only while memory and
   memory updates are on, back off after failures, pause after 3 consecutive
   failures and start at most 10 times per local day.
3. **Automatic runs stay out of the owner's way.** They never supersede, complete
   or wait for an owner-started run, never leave an approval pending, and hold no
   file lock during a model request. Chat stays off their path.
4. **Automatic changes are reviewable after the fact.** Each change is an ordinary
   file version labelled as an automatic update from episode notes, with the
   existing diff and Revert.
5. **`MEMORIES.md` keeps ADR 0009's rule.** Episode processing writes only shared
   user memory. Each Anima's `MEMORIES.md` changes only through chat edits and
   owner-started Reflection; nothing rewrites it in the background.
6. **Hosted keeps owner-started processing.** The hosted composition receives
   decision 1 but no worker, setting or progress line.

## Alternatives

- **Rely on the model to search.** Already the behavior; the benchmark showed
  recall rarely happened.
- **Owner approval for automatic proposals.** Leaves the same unattended backlog
  as manual processing; version history and Revert give review after the fact.
- **Automatic Reflection as well.** `MEMORIES.md` holds one Anima's relationship,
  where an unreviewed rewrite costs more; it stays owner-curated.
- **Automatic processing in hosted.** Would add background spend outside the
  trial and monthly ceilings.

## Consequences

- Local installations spend the owner's Memory Manager key without a per-run
  action, bounded by the threshold, backoff, daily limit and existing per-step
  request budget. Off stops new runs.
- Instructions grow by up to about 19 KiB per model round, and a `PROFILE.md`
  change or a new note from another chat re-caches the instruction prefix once,
  as `MEMORIES.md` edits do.
- A run's origin is kept in its metadata, and the open-run uniqueness index is
  split by origin, so an automatic run and an owner run can both be open.
- ADR 0008's companion guardrail still overrides the added sections.

## Evidence

- [Episode recall and processing spec](../plans/episode-recall-and-processing/episode-recall-and-processing-spec.md):
  agreed requirements R1–R13.
- [Episode recall and processing plan](../plans/episode-recall-and-processing/episode-recall-and-processing-execplan.md):
  implementation decisions and delivery evidence.

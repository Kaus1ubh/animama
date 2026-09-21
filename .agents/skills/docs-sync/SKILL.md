---
name: docs-sync
description: Audit or edit documentation for accuracy, concision and reader value. Use for documentation reviews, cleanup, and deciding which docs a code change actually needs.
---

# Keep documentation useful

Documentation should help someone use, operate, debug or extend the system.
A code change does not automatically need a documentation change. Leave docs
alone when existing guidance remains accurate and sufficient.

## Choose the scope

Follow the user's requested scope. A repository-wide cleanup covers maintained
docs even on a task branch; branch location must not narrow that request.
For a change-specific review, inspect its diff against the agreed base, including
relevant uncommitted work. Read the repository and scoped agent guides, then the
existing documentation entrypoints.

Distinguish maintained guides from ADRs, specifications, execution plans,
archived evidence, generated output and third-party notices. Preserve historical
records and their gates; edit generated documentation at its source. Follow the
repository workspace and delivery policy.

## Review for reader value

For each page, identify its reader and the task or question it answers. Review
existing prose before looking for additions. Delete or consolidate repetition,
obvious UI descriptions, source-file inventories that do not aid navigation,
speculation and development narration. Do not rewrite useful prose merely to
reduce its line count.

Before adding or retaining a sentence, ask:

- What useful question does this answer, or what mistake does it prevent?
- Would the reader lose necessary guidance if it disappeared?
- Does this belong here, or is an existing authoritative section enough?

Keep supported workflows, commands, defaults, interfaces, compatibility
constraints, actionable limitations and recovery instructions. Verify changed
claims against source/configuration. A missing mention is a gap only when a
reader needs it; documenting every feature, control or internal symbol is not
a coverage goal.

Describe the current system directly. Remove obsolete guidance rather than
adding a sentence announcing its removal. Significant architectural rationale
belongs in an ADR; delivery progress and validation belong in the issue, PR or
plan. Discard trivial change narration instead of moving it into an ADR.

Use the [review checklist](references/doc-coverage-checklist.md) for a broad audit
or when a proposed addition's value is unclear.

## Apply and verify

For an audit-only request, report concrete findings and proposed edits without
editing. For an explicit update or cleanup request, apply the authorized changes;
do not ask for the same approval again. Ask only about material unresolved scope
or meaning, while continuing independent work.

Prefer editing the owning section over appending another summary or new page.
Check related instructions/templates when they would otherwise recreate the same
problem. Preserve links when consolidating content and update references to moved
or removed sections.

Run the smallest relevant documentation checks: formatting, local links/anchors
and existing tests that consume the affected docs. Review the diff for lost
contracts or unsupported claims. Do not start application services or invent
behavior tests for prose-only edits.

Report the reviewed scope, meaningful edits, verification and any remaining gaps.
For a broad audit, account for unchanged pages and excluded record types. Keep
coverage evidence in the task or PR, not a new permanent audit manual. Report
“no documentation change needed” when that is the correct result.

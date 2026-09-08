# Report contract

Read this after coverage and candidate synthesis. Produce `report.md` for a durable,
searchable handoff and `report.html` for visual comparison. Both describe the same
snapshot and findings; link to unit notes rather than duplicating every observation.

## Content

1. **Scope and coverage**: repository, HEAD, dirty-work scope, timestamp, whether
   complete or partial, file disposition counts, unit/flow status, exclusions,
   ignored-path scope, unreadable/blocked areas, and snapshot drift handling.
2. **System overview**: responsibility map and major flows, with a diagram of the
   current architecture. Distinguish observed relationships from inferred ones.
3. **Prioritized candidates**: all substantiated candidates, deduplicated by root
   cause. Keep speculative leads and unresolved gaps in a separate section.
4. **Next step**: top recommendation and why, or an explicit conclusion that no
   worthwhile deepening was established. Link the checkpoint for continuation.

Each candidate contains:

- A stable ID and domain-oriented title.
- Source evidence: files, symbols, lines, relevant caller/test locations, note links.
- Problem: concrete friction and its effect on behavior or future change.
- Conceptual solution: which module would own what; caller knowledge reduced.
- Benefits: locality, leverage, and verification through the resulting interface.
- Before/after diagrams with module/interface/seam labels.
- Dependency category, recommendation strength, and evidence confidence.
- Cost, migration sequence at a high level, behavioral risks, and counterevidence.
- Any ADR conflict with an explanation of why the evidence warrants revisiting it.
- Verification proposal and unanswered questions.

Explain why a candidate deserves attention rather than manufacturing findings for
every unit. A coverage gap is not evidence of a design defect. Avoid detailed
replacement interfaces until the user selects or has already authorized design work.

## HTML and diagrams

Write one offline HTML file with inline CSS and SVG or semantic HTML diagrams.
Use system fonts and local evidence links. No CDN, remote font, analytics, or runtime
dependency is needed. A little inline JavaScript may filter candidates or expand
details, but the report must remain readable without it.

Use a clear overview, candidate navigation, and generous spacing. Before/after
diagrams should compare the same capability at the same scale; label the gain in
caller simplicity instead of implying that fewer boxes automatically means better
architecture. At narrow widths, stack diagrams and wrap long paths. Include text
equivalents so the relationships are understandable without color or SVG.

Treat repository strings as text. Escape labels, snippets, and file paths when
embedding HTML/SVG; do not insert repository content as executable markup or script.
Use relative links for review notes and appropriately escaped file links for source.
Give every diagram an accessible label and retain visible keyboard focus.

## Verification and delivery

Check evidence links and anchors, open the HTML in an available browser/preview,
and inspect wide and narrow layouts. Confirm that diagrams, long paths, and status
labels remain readable. If no renderer is available, inspect the markup and state
that visual rendering was not verified; do not claim visual validation.

Rerun the coverage/drift gate after report generation. Distinguish tests read from
tests run, and mechanical coverage validation from substantive analysis.

Deliver the absolute report and checkpoint paths, summarize the leading findings
and remaining gaps, and state what was checked. Review artifacts stay outside the
repository by default. Do not publish tickets, edit domain docs, implement refactors,
or commit review artifacts unless the user requested that next action.

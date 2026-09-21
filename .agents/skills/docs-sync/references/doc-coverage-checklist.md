# Documentation review checklist

Use this for a broad audit or a disputed addition. It supports the reader-value
standard in [Docs Sync](../SKILL.md), not a requirement to document every change.

## Page review

- Identify the reader's task: setup, usage, operation, debugging or extension.
- Keep information needed to complete that task, including failures and recovery.
- Check commands, paths, defaults and behavior claims against their owning source.
- Consolidate repeated explanations; link to one authoritative section.
- Remove decorative UI detail, obvious behavior, speculative features and delivery
  history. Keep concrete compatibility or safety constraints that prevent mistakes.
- Preserve decision records, evidence and notices as records. Do not convert them
  into apparent current instructions or erase their approvals and limitations.

## Decide whether a change needs docs

| Change                                                            | Documentation decision                                                                                          |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Dialog spacing, icon alignment or a visual bug fix                | None unless existing guidance becomes misleading.                                                               |
| A control moves                                                   | Correct an existing instruction that sends readers to the wrong place; do not list where the control is absent. |
| An internal refactor preserves the documented contract            | None unless developer guidance references a changed entrypoint.                                                 |
| A command, default, public contract or recovery procedure changes | Update the owning guide with verified current instructions and relevant consequences.                           |
| A paragraph repeats another section                               | Keep the useful explanation in its owning section and link where needed.                                        |
| A removed feature leaves obsolete instructions                    | Remove or correct those instructions; retain a migration note only when users need an action.                   |

For example, “Camera is not an App Settings section” adds little. If a usage guide
needs the location, “Open Canvas settings to adjust the camera” answers the task.
A dialog fitting beside the sidebar normally needs no prose. A restore command
that requires stopping the service does: omitting that condition could lose data.

## Completion

- Review every page in the agreed scope; unchanged is a valid disposition.
- Check inbound links when removing a section or page.
- Run applicable formatting, link checks and documentation-consumer tests.
- Record coverage, limitations and checks in the task/PR without adding permanent
  documentation solely to prove that documentation was updated.

---
name: setup-ray-skills
description: Establish or repair a repository's SDLC skill contract, lifecycle documents, spec and execution-plan templates, domain guides, and GitHub templates. Use for initial setup or an intentional workflow update.
---

# Set up the lifecycle skills

Establish the repository contract used by this lifecycle skill bundle. The bundled
instructions are portable; put project-specific facts in the generated repository
documents. Install the bundled skill directories together; each execution skill can
then be invoked independently.

## Inspect before configuring

Read applicable agent instructions, existing contribution/workflow guidance,
templates, domain documents, package/task configuration and CI entrypoints.
Inspect the Git root, worktrees, branch, dirty paths and remote identity without
exposing credentials. Read available GitHub metadata to establish the target,
base, existing labels and actual checks. Do not invent protection or approval
enforcement from written policy.

Reuse supplied decisions. Ask only about consequential choices that inspection
cannot resolve: artifact authority or privacy, conflicting workflow rules, missing
repository identity, or human gates. Ordinary invocation authorizes local setup
edits; it does not require another blanket confirmation. Resolve conflicts before
changing established behavior.

## Establish the contract

Use [the SDLC template](assets/sdlc.md) to create or reconcile root `SDLC.md`.
Its `Repository setup` section is the entry point, not a separate configuration
system. If an existing equivalent is authoritative, preserve it and place an
explicit route in the repository's agent entrypoint. Record these facts:

- Repository and default base; guide, template and artifact locations.
- Planning root, spec authority before/after publication, and privacy boundaries.
- Naming, existing label mapping, actual CI requirements and merge authority.
- Applicable checks with working directories, the full pre-push suite, environment
  preparation and any machine-wide heavy-job wrapper.
- Human gates, bounded review policy with its risk tiers, glossary and ADR locations.
- Bundle availability, missing prerequisites and the scope of setup readiness.

For a new repository, default to root `SDLC.md`, `SPECS.md`, `PLANS.md` and
`GLOSSARY.md`; use `docs/plans/` as the planning root and `docs/adr/README.md`
with `docs/adr/template.md` for decisions. GitHub templates go in
`.github/ISSUE_TEMPLATE/parent.yml`, `.github/ISSUE_TEMPLATE/task.yml` and
`.github/pull_request_template.md`. These are setup defaults, not a reason to
replace an existing equivalent or override a configured private destination.

Reconcile the [spec guide](assets/specs.md), [plan guide](assets/plans.md),
[glossary](assets/glossary.md), [ADR guide](assets/adr-guide.md) and
[ADR template](assets/adr-template.md). Preserve existing equivalents and their
custom content. Preserve explicit gates in existing plans. Keep private locations
in approved private records; a public contract may require an authorized private
context without revealing its path. Confirm that context before dependent writes.

Add or reconcile [parent](assets/parent.yml), [task](assets/task.yml) and
[PR](assets/pull-request.md) templates. Preserve existing issue types. Record
existing labels; creating labels, protections or CI workflows is separate work.
Route the applicable agent entrypoint to `SDLC.md` and its `Repository setup`
section before using execution skills, with an explicit link to any established
equivalent. State that missing or inconsistent setup is repaired through
`setup-ray-skills`; execution skills use the configured guides and procedures.
If no entrypoint exists, create a concise `AGENTS.md` with that routing.

Use existing definitions and decisions. New glossary/ADR scaffolds may contain no
records; do not fabricate domain terms, rationales or historical acceptance.
Create artifact and phase directories when they first hold material. Fill template
tokens in generated guides; retain intentional authoring fields in actual templates.
An absent test suite or development stack is an explicit fact, not a made-up command.

## Verify and hand off

Check links, configured destinations, template syntax and skill dependencies.
Verify commands through their maintained definitions; run only appropriate safe
checks and distinguish inspection from execution. Confirm actual remote access for
operations that require it, or record that setup prerequisite as unresolved.
Report which workflow operations are ready and any blocked prerequisites.

On rerun, update the existing setup section and affected instructions in place.
Preserve user edits, settled choices and unrelated files. Do not duplicate sections,
rename established artifacts or reset choices merely to match a starter template.
Finish with the configured entrypoints, readiness and any remaining prerequisites.

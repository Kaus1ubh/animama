---
name: docs-sync
description: Analyze implementation, configuration, and user-facing behavior to find missing, incorrect, or outdated project documentation. Use when asked to audit doc coverage, sync docs with code, or propose doc updates/structure changes. Provide a report and ask for approval before editing docs.
---

# Docs Sync

## Overview

Identify doc coverage gaps and inaccuracies by comparing the current FastAPI backend, Vite/React frontend, configuration, and operational workflows against the project's documentation, then propose targeted improvements.

## Workflow

1. Confirm scope and base branch
   - Identify the current branch and default branch (usually `main`).
   - Prefer analyzing the current branch to keep work aligned with in-flight changes.
   - If the current branch is not `main`, analyze only the diff vs `main` to scope doc updates.
   - Follow the repository workspace policy. Inspect the current checkout or use `git show main:<path>` without switching the primary checkout; prepare approved edits through the configured workspace workflow.
   - Read the nearest `AGENTS.md` files and any backend/frontend agent guides before deciding which docs apply.

2. Build a feature inventory from the selected scope
   - If on `main`: inventory the full surface area and review docs comprehensively.
   - If not on `main`: inventory only changes vs `main` (feature additions/changes/removals).
   - Focus on user-facing behavior: HTTP APIs, WebSocket/SSE flows, auth behavior, database migrations, background jobs, React routes, generated clients, configuration options, environment variables, CLI commands, default values, and operational workflows.
   - Capture evidence for each item (file path + symbol/setting).
   - Use targeted search to find option types and feature flags (for example: `rg "Settings"`, `rg "BaseSettings"`, `rg "os.environ"`, `rg "VITE_"`, `rg "APIRouter"`, `rg "createFileRoute"`).
   - When the topic involves OpenAI platform features, invoke `$openai-knowledge` to pull current details from the OpenAI Developer Docs MCP server instead of guessing, while treating this project's source code as the source of truth for how the integration is wired.

3. Doc-first pass: review existing pages
   - Walk each relevant documentation root named by repo guidance or found in the workspace, such as `docs/`, backend docs, frontend docs, package READMEs, and operational runbooks.
   - Identify missing mentions of important, supported options (opt-in flags, env vars), customization points, API contracts, runtime flows, or new backend/frontend features.
   - Propose additions where users would reasonably expect to find them on that page.

4. Code-first pass: map features to docs
   - Review the current docs information architecture and navigation patterns from existing documentation files, README links, and AGENTS guidance.
   - Determine the best page/section for each feature based on existing patterns and the likely reader: backend developer, frontend developer, operator, or product/user-facing reader.
   - Identify features that lack any doc page or have a page but no corresponding content.
   - Note when a structural adjustment would improve discoverability.
   - When improving generated API/reference docs, treat the corresponding source comments, OpenAPI schema, or generator inputs as the source of truth. Prefer updating the source of generated docs instead of hand-editing generated output.

5. Detect gaps and inaccuracies
   - **Missing**: features/configs present in the selected scope but absent in docs.
   - **Incorrect/outdated**: names, defaults, or behaviors that diverge from the selected scope.
   - **Structural issues** (optional): pages overloaded, missing overviews, or mis-grouped topics.

6. Produce a Docs Sync Report and ask for approval
   - Provide a clear report with evidence, suggested doc locations, and proposed edits.
   - Ask the user whether to proceed with doc updates.

7. If approved, apply changes
   - Edit only documentation and generated-doc source files needed for the approved scope.
   - Keep changes aligned with the existing docs style and navigation.
   - Update README links, docs indexes, sidebars, or route manifests when adding or renaming pages, if this repo uses them.
   - Run the smallest relevant docs validation available in the repo. If no docs-specific validation exists, run a lightweight sanity check such as link/path checks, Markdown formatting, or the relevant backend/frontend verification command, and state what was not available.

## Output format

Use this template when reporting findings:

Docs Sync Report

- Doc-first findings
  - Page + missing content -> evidence + suggested insertion point
- Code-first gaps
  - Feature + evidence -> suggested doc page/section (or missing page)
- Incorrect or outdated docs
  - Doc file + issue + correct info + evidence
- Structural suggestions (optional)
  - Proposed change + rationale
- Proposed edits
  - Doc file -> concise change summary
- Questions for the user

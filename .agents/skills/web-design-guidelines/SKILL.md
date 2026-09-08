---
name: web-design-guidelines
description: Review UI code for Web Interface Guidelines compliance. Use when asked to "review my UI", "check accessibility", "audit design", "review UX", or "check my site against best practices".
metadata:
  author: vercel
  version: "1.0.0"
  argument-hint: <file-or-pattern>
---

# Web Interface Guidelines

Review files for compliance with Web Interface Guidelines.

## Animama scope

Apply the fetched guidelines to the current client-rendered React/Vite app. The frontend uses `createRoot`, not SSR or hydration: skip server/client hydration-mismatch and `suppressHydrationWarning` advice, while retaining ordinary controlled-input checks. Use existing TanStack Router search/params APIs for shareable URL state and Zustand for transient runtime state; do not add `nuqs` or synchronize every local state value to the URL. Use native image attributes and existing components rather than framework-specific image props.

Treat upstream library suggestions as examples, not dependency requirements. Preserve the scoped frontend guide's ownership and data-flow conventions. The remote rules can change; reapply these scope constraints after each fetch.

## How It Works

1. Fetch the latest guidelines from the source URL below
2. Read the specified files (or prompt user for files/pattern)
3. Check applicable rules in the fetched guidelines, using the Animama scope above
4. Output findings in the terse `file:line` format

## Guidelines Source

Fetch fresh guidelines before each review:

```
https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md
```

Use WebFetch to retrieve the latest rules. The fetched content contains all the rules and output format instructions.

## Usage

When a user provides a file or pattern argument:
1. Fetch guidelines from the source URL above
2. Read the specified files
3. Apply the fetched rules that fit the Animama scope above
4. Output findings using the format specified in the guidelines

If no files specified, ask the user which files to review.

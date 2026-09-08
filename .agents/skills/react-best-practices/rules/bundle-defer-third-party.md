---
title: Defer Non-Critical Third-Party Libraries
impact: MEDIUM
impactDescription: reduces work during application startup
tags: bundle, dynamic-import, client-startup
---

## Defer Non-Critical Third-Party Libraries

Import optional heavy libraries when their feature is used, or after mount if they are genuinely needed for that session. Use literal dynamic imports; see [conditional loading](bundle-conditional.md) and [lazy components](bundle-dynamic-imports.md).

Preserve the application's existing initialization and consent policy. Required error reporting, security checks, or readiness work may need to start immediately. Do not add analytics or external services merely to follow a performance example.

An effect runs after commit but does not guarantee that the browser has painted. If startup profiling shows contention, use an appropriate idle/deferred-work mechanism with cleanup and error reporting. Account for StrictMode when initialization must happen once.

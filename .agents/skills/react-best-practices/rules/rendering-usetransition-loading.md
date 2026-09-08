---
title: Distinguish Transition Pending State from Query Loading
impact: LOW
impactDescription: preserves responsive UI and correct request state
tags: rendering, transitions, tanstack-query, loading
---

## Distinguish Transition Pending State from Query Loading

Use TanStack Query's existing pending/fetching/error states for remote data. Use `useTransition` for non-urgent React updates and its `isPending` state for the transition itself. Keep controlled input updates synchronous.

A transition does not cancel an in-flight network request or prevent older responses from overwriting newer results. Preserve query cancellation and key-based result ownership. Do not replace a query hook with manual fetches inside transitions just to obtain a loading flag.

In the installed stable React API, state updates after an `await` need another `startTransition` call to mark those updates as transitions. Consult the actual API/version before relying on async transition behavior.

Reference: [React useTransition](https://react.dev/reference/react/useTransition)

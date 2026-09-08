---
title: Defer State Reads to Usage Point
impact: MEDIUM
impactDescription: avoids unnecessary subscriptions
tags: rerender, zustand, state
---

## Defer State Reads to Usage Point

When a callback needs the latest Zustand state but that value does not affect rendering, read the existing store with `store.getState()` inside the callback. Use a narrow store selector when the value does affect rendering.

For URL state, use TanStack Router's existing typed search schema and hooks. Do not introduce another router's `useSearchParams` or bypass search validation with raw URL parsing solely to remove a subscription. A narrow reactive selection is often clearer and safer.

Ensure an imperative read preserves the desired semantics: a latest-state read differs from the value captured when the UI rendered.

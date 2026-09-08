---
title: Keep Loading Boundaries Local
impact: HIGH
impactDescription: keeps the surrounding UI usable during lazy loading
tags: async, suspense, client-rendering
---

## Keep Loading Boundaries Local

Place Suspense around a lazy-loaded panel so the rest of the screen remains visible and interactive; see [lazy loading](bundle-dynamic-imports.md). Browser React components remain synchronous functions.

Suspense does not detect an ordinary effect or `useQuery` request. Use the existing query hook's pending/error states for that data. Adopt TanStack Query's Suspense APIs only when the surrounding route, error boundary, and loading behavior are designed for them. Do not create fetch promises during render or introduce async React components.

Start independent requests through existing query options/hooks concurrently. If multiple queries in one component deliberately use Suspense, use the library's parallel Suspense query API to avoid the first query suspending before the others start.

Reference: [React Suspense](https://react.dev/reference/react/Suspense)

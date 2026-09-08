---
title: Reuse TanStack Query Options and Cache
impact: MEDIUM-HIGH
impactDescription: shares in-flight requests and cached results
tags: client, tanstack-query, deduplication, data-fetching
---

## Reuse TanStack Query Options and Cache

Use the application's shared QueryClient and existing query keys, option factories, and hooks. Components observing the same key share cached results and in-flight work. Include every request parameter that affects the result in the key, and preserve established stale-time and invalidation policies.

Inspect `src/frontend/web/src/query/` and `src/frontend/web/src/app/query-client.ts` before adding another fetching path. Use the generated API client through the existing application wrappers; keep generated files unchanged.

Avoid effect-based fetches that duplicate existing queries, separate QueryClient instances per component, and copying remote data into Zustand merely to cache it. Keep local UI state in the existing Zustand stores or component state.

For writes, follow existing mutation hooks and invalidate or update their established query keys. A mutation is not automatically deduplicated like an in-flight query. Route loaders that prefetch data should share query options and QueryClient with the consuming component.

Reference: [TanStack Query](https://tanstack.com/query/latest/docs/framework/react/overview)

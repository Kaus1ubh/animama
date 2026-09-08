---
title: Lazy-Load Heavy Components
impact: CRITICAL
impactDescription: reduces initial JavaScript download and evaluation
tags: bundle, lazy, suspense, vite
---

## Lazy-Load Heavy Components

Declare React `lazy` components at module scope and render them under a `Suspense` boundary. Keep Vite import paths literal. Prefer the existing TanStack Router route-splitting conventions for route modules.

```tsx
import { lazy, Suspense } from 'react'

const Editor = lazy(() =>
  import('./Editor').then(module => ({ default: module.Editor }))
)

function EditorPanel({ open }: { open: boolean }) {
  return open ? (
    <Suspense fallback={<p role="status">Loading editor…</p>}>
      <Editor />
    </Suspense>
  ) : null
}
```

Use the application's error boundary for chunk-load failures. A Suspense fallback handles pending loads, not rejected imports. Do not recreate a lazy component during render.

Reference: [React lazy](https://react.dev/reference/react/lazy)

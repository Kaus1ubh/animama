---
title: Prefer Statically Analyzable Import Paths
impact: HIGH
impactDescription: keeps lazy chunks predictable
tags: bundle, vite, imports
---

## Prefer Statically Analyzable Import Paths

Use explicit import functions so Vite can discover and split the intended modules.

```ts
const modules = {
  editor: () => import('./Editor'),
  preview: () => import('./Preview'),
}
const loaded = await modules[selectedModule]()
```

Do not hide an arbitrary import path in a runtime string. For a known collection of files, follow Vite's literal `import.meta.glob` conventions. Use the existing TanStack Router route loader/splitting setup for routes rather than introducing a parallel page-module registry.

Reference: [Vite features](https://vite.dev/guide/features.html)

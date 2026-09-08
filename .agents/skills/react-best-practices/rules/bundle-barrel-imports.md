---
title: Check Barrel Import Costs Before Rewriting
impact: HIGH
impactDescription: can reduce module processing and bundle size
tags: bundle, imports, tree-shaking, vite
---

## Check Barrel Import Costs Before Rewriting

Vite can tree-shake supported ESM packages. A named import from a barrel does not necessarily ship the entire library. Inspect actual build output or development startup costs before bulk import rewrites.

For local modules, direct imports can avoid large re-export graphs and circular dependencies. For dependencies, use only public, typed subpaths supported by the package's exports. Preserve normal named imports when a package does not expose a supported subpath; never reach into private `dist/` internals solely for a theoretical bundle gain.

```tsx
// Local implementation needed by this component:
import { AvatarPreview } from './AvatarPreview'
// Avoid a broad feature barrel if it introduces unrelated dependencies.
```

Validate changed imports with the frontend typecheck and Vite build. Dependency and bundler changes require evidence that they solve the measured problem.

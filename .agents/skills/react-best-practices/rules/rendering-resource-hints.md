---
title: Preload Known Critical Browser Resources
impact: MEDIUM
impactDescription: starts needed resources earlier
tags: rendering, preload, resource-hints
---

## Preload Known Critical Browser Resources

Use resource hints only for known resources whose earlier download improves measured loading. Import asset URLs through Vite or use verified public asset paths; do not guess emitted chunk filenames.

```tsx
import { preload } from 'react-dom'
import portraitUrl from './portrait.webp'

function PreviewButton({ open }: { open: () => void }) {
  return (
    <button
      onPointerEnter={() => preload(portraitUrl, { as: 'image' })}
      onFocus={() => preload(portraitUrl, { as: 'image' })}
      onClick={open}
    >
      Open preview
    </button>
  )
}
```

For route preloading, use the existing TanStack Router Link/preload settings. For lazy component chunks, use a literal dynamic import; avoid hard-coded `/dashboard.js` paths that bypass Vite's output mapping. Resource hints do not replace query caching or route loaders.

Reference: [React DOM resource APIs](https://react.dev/reference/react-dom#resource-preloading-apis)

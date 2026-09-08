---
title: Avoid Parser-Blocking Classic Scripts
impact: HIGH
impactDescription: keeps HTML parsing responsive
tags: rendering, script, vite
---

## Avoid Parser-Blocking Classic Scripts

For static HTML entrypoints, classic scripts without `defer` or `async` block parsing while downloading and executing. Use `defer` when execution order or parsed DOM is required; use `async` only for independent scripts.

```html
<script src="/scripts/dom-helper.js" defer></script>
```

Vite's `type="module"` entry script is already deferred by default. Preserve its existing entrypoint and let Vite manage application dependencies. Animama mounts inside an existing HTML document; React application components should not introduce another `html`/`head`/`body` document shell.

Reference: [MDN script element](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script)

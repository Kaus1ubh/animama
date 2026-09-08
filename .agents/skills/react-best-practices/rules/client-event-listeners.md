---
title: Share Global Event Subscriptions When Useful
impact: LOW
impactDescription: avoids redundant global event work
tags: client, event-listeners, subscription
---

## Share Global Event Subscriptions When Useful

Reuse existing application hooks or providers for global events. If many consumers repeat the same expensive subscription, own it once in a provider or existing Zustand store and expose the smallest relevant state to consumers.

Keep subscription lifetime explicit: attach in an effect, remove the same handler during cleanup, and verify development StrictMode's setup/cleanup cycle. Multiple inexpensive independent listeners can be simpler than a shared registry; deduplicate when repeated work warrants it.

```tsx
useEffect(() => {
  const handleResize = () => updateViewport(window.innerWidth)
  window.addEventListener('resize', handleResize)
  handleResize()
  return () => window.removeEventListener('resize', handleResize)
}, [updateViewport])
```

The example belongs in the single owning provider/hook, not each consuming component. Keep keyboard shortcuts scoped to the active surface and respect editable elements and modifier keys.

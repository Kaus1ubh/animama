---
title: React 19 API Changes
impact: MEDIUM
impactDescription: cleaner component definitions and context usage
tags: react19, refs, context, hooks
---

## React 19 API Changes

> **⚠️ React 19+ only.** Skip this if you're on React 18 or earlier.

In React 19, function components can receive `ref` as a prop. Prefer that shape for new components where it fits the existing API. Both `useContext()` and `use(Context)` are valid; keep established usage unless a concrete refactor benefits from conditional context reads. Existing `forwardRef` components are not bugs and do not require a blanket migration.

**Existing supported pattern (forwardRef):**

```tsx
const ComposerInput = forwardRef<TextInput, Props>((props, ref) => {
  return <TextInput ref={ref} {...props} />
})
```

**Correct (ref as a regular prop):**

```tsx
function ComposerInput({ ref, ...props }: Props & { ref?: React.Ref<TextInput> }) {
  return <TextInput ref={ref} {...props} />
}
```

**Supported context read:**

```tsx
const value = useContext(MyContext)
```

**Alternative context read (also supports conditional calls):**

```tsx
const value = use(MyContext)
```

`use()` can also be called conditionally, unlike `useContext()`.

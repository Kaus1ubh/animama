# React View Transitions Skill

An agent skill for implementing smooth, native-feeling animations using React's View Transition API.

This repository copy gates React ViewTransition examples because Animama's React 19.2.5 does not export those APIs. Current work uses existing Motion/CSS patterns or TanStack Router's native view-transition integration. Read the compatibility gate in `SKILL.md` first; installing this skill does not require a React upgrade.

## What This Skill Covers

- **`<ViewTransition>` component** — animation triggers (enter, exit, update, share), placement rules, View Transition Classes
- **`addTransitionType`** — tagging transitions for directional or context-specific animations
- **Shared element transitions** — morphing elements across different views
- **View Transition Events** — imperative JavaScript animations via the Web Animations API
- **CSS pseudo-elements** — `::view-transition-old`, `::view-transition-new`, `::view-transition-group`
- **Router integration** — framework-agnostic navigation patterns using React transitions
- **Accessibility** — `prefers-reduced-motion` handling
- **Ready-to-use CSS recipes** — fade, slide, scale, directional navigation

## Skill Structure

```
react-view-transitions/
├── SKILL.md                      # Core skill (always loaded)
└── references/
    ├── implementation.md         # Step-by-step implementation workflow
    ├── patterns.md               # Real-world patterns and events API
    ├── troubleshooting.md        # Symptom-driven debugging
    └── css-recipes.md            # Copy-paste CSS animations
```

## Installation

Install via [skills.sh](https://skills.sh):

```bash
npx skills add https://github.com/vercel-labs/agent-skills --skill vercel-react-view-transitions
```

## Resources

- [React `<ViewTransition>` docs](https://react.dev/reference/react/ViewTransition)
- [React `addTransitionType` docs](https://react.dev/reference/react/addTransitionType)

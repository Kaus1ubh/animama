---
name: animama-ui
description: Design, build, and polish Animama web and desktop UI screens with the existing theme tokens and shared components, then verify them visually in the running app. Use for new screens, layout or visual redesigns of existing screens, UX flows, empty/loading/error states, and design reviews of frontend changes. Avatar motion, Gestures, and effects have their own skills.
---

# Animama UI

Animama is a desktop companion: the Anima's Avatar is the emotional center of
the product, and the surrounding UI should frame it rather than compete with it.
Extend the current UI and components; do not restyle the app or introduce a
parallel design system unless the owner asks for one.

Read `src/frontend/AGENTS.md` before editing. It owns component, accessibility
and reduced-motion requirements; this skill covers visual design and the
design-verification loop.

## 1. Ground the work

Before proposing anything:

1. Read `docs/frontend/design-system.md` and the tokens it points to.
2. Find the nearest existing screen or creator that solves a similar problem and
   reuse its layout, components and copy patterns.
3. Screenshot the related live screens at 1440x900 with the browser tools
   (start or reuse a stack with `animama-local-stacks`).
4. When the pattern is new to Animama, collect 2–5 references from shipped
   products (live sites in the browser, or a reference MCP if one is
   configured) and state what to take from each.

Write a short brief: the user's goal, the primary action, required states,
constraints, and what must stay unchanged.

## 2. Explore cheaply, then build for real

- Offer 2–3 directions as compact ASCII previews in a multiple-choice question
  (such as Claude Code's `AskUserQuestion`), or as an inline wireframe when
  spatial structure matters. These judge layout and
  hierarchy only; they do not use Animama's tokens.
- After the owner picks a direction, build it in the real React components.
  Visual quality is judged only in the running app.

## 3. Design language

Follow [the design system](../../../docs/frontend/design-system.md) for color,
status, type, spacing, radius, component and motion rules. The points agents
most often get wrong:

- Use semantic token classes; never hex, `rgb()` or Tailwind palette colors for
  surfaces, text, borders or brand color. Brand hues are provisional, so never
  depend on a token's current hue.
- Status messaging uses `success`/`warning`/`info` tokens, typically with `/10`
  surfaces and `/30` borders; data categories such as diff lines may keep palette
  colors.
- Use `text-2xs`/`text-xs`/`text-sm` and larger, never pixel font sizes. Body
  text is regular weight; emphasis comes from `font-medium`/`font-semibold`.
- Use `@/ui/components/*` primitives instead of hand-rolled controls; one
  `default` Button per view.
- UI motion must never compete with an Avatar Gesture or emotion change.

## 4. Every screen ships its states

Design and verify: empty (an invitation with a clear next action), loading
(skeleton or streaming, never a bare spinner on a blank page), error (what
happened and what to do next), long or overflowing content, and both light and
dark themes. Check keyboard focus order and visible focus rings.

## 5. Verify and critique

1. Screenshot the result at 1440x900, then a narrow width (about 900px) for
   regressions, in light and dark themes.
2. Critique against the brief: hierarchy, spacing rhythm, alignment, color
   restraint, copy, and whether the Avatar remains the focal point where
   present. Use `design:design-critique`, `web-design-guidelines`,
   `design:accessibility-review` and `design:ux-copy` when they are installed;
   they are optional.
3. Fix findings and repeat. Two or three rounds is normal; stop when remaining
   notes are matters of taste for the owner to decide.

Report screenshots or a description of each verified state, what was not
checked, and any manual checks still needed for avatar, audio or desktop
behavior.

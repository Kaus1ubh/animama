---
name: animama-particle-vfx
description: Understand and operate Animama's three.quarks Particle Effect system and /particle-effects/ creator. Use for emitter settings, textures, preview, saved particle content, avatar attachment, and Gesture or Reaction integration; Avatar Effect decals and Scene Effects are separate systems.
---

# Animama Particle VFX

Explain or author Particle Effects using the distinction between Quarks simulation,
the creator's editable subset, and Animama's content and playback contracts. This
skill covers mechanics and operation; it does not prescribe an artistic design
process or effect recipes.

## Read for the task

- For particle behavior, generators, rendering, JSON, or library compatibility,
  read [three.quarks mechanics](references/three-quarks.md).
- For controls, textures, import/export, preview, Save, and recovery, read
  [Using the creator](references/creator.md).
- For avatar anchors, lifetime, budgets, content resolution, or Actions, read
  [Animama integration](references/integration.md).

Load the relevant reference rather than every subsystem. Paths in references are
relative to the active Animama checkout, not a particular machine or worktree.

## Operational essentials

- A Particle Effect (`particle_effect`) contains one or more emitters and their
  resources. A timed Action event (`particle_vfx`) starts an instance. It is
  distinct from an Avatar Effect texture/decal and a Scene Effect.
- Separate emitter cycle duration, individual particle lifetime, and whole-effect
  playback duration. Looping an emitter does not remove Animama's playback limit.
- The creator exposes only part of Quarks. A feature in upstream documentation or
  a control in the UI is not proof of complete application integration. Read the
  relevant reference's limitations before relying on unusual settings.
- Use the existing app origin from task context or the running app. Inspect the
  visible creator and preserve unrelated drafts. For a requested UI workflow,
  use its controls and JSON Import; do not substitute hidden state changes,
  database edits, direct API saves, or filesystem installation.
- Saving creates Local content. It does not equip an Anima or assign an emotion.
  When integration is requested, reference the saved item from a Gesture or
  Reaction and verify that Action's playback.

## Evidence and currency

The references were checked against Animama `4f0f035` on 2026-09-24, with
`three.quarks`/`quarks.core` 0.17.1 and Three.js 0.182.0. Confirm the active
lockfile before applying version-sensitive claims. When consulting Context7,
resolve `three.quarks` first; the official repository is
`/alchemist0823/three.quarks`. Current upstream examples may exceed the installed
version or the creator's supported subset.

The baseline verification included source inspection, parsing both Quarks
compatibility fixtures with the installed library, and an isolated burst probe.
It did not include a live creator/save/reopen/Action pilot. Recheck limitations
against current source when relevant; do not treat them as permanent product rules.

Report the saved name and edit URL when applicable, the preview avatar, and what
was actually verified. Distinguish deserialization, creator preview, persistence,
Action playback, and live Anima playback; one does not establish the others.

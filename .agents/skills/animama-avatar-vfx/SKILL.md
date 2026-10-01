---
name: animama-avatar-vfx
description: Understand, create, preview, and tune Animama Avatar Effects through the /avatar-effects/ creator, including Hover, Face decal, Texture, image placement, motion, sound, and Gesture or Reaction integration. Use for avatar-attached visual effects and their authoring workflow; general VRM import/spec questions, particle emitters, and scene backgrounds are separate topics.
---

# Animama Avatar VFX

Turn artwork into reusable Avatar Effect content that looks correct on the intended
Anima's VRM avatar. Use the in-app creator for authoring and the actual avatar for
visual acceptance.

## Read for the task

- For terminology, rendering, compatibility, or choosing an effect type, read
  [What an Avatar Effect is](references/what.md).
- For creating, editing, importing, previewing, or saving content, read
  [How to use the creator](references/how.md). It includes the control reference,
  recipes, region assignment, and troubleshooting.
- For first-time authoring, read both. For a focused adjustment, read the relevant
  section rather than rediscovering the entire subsystem.

## Working approach

1. Establish the intended visual behavior: art floating near the head, art painted
   onto skin, or art mapped onto a material. Identify the source image and intended
   preview avatar. Infer routine settings from the artwork and request.
2. Use the existing app instance and supported browser tools. Inspect its current
   UI before acting; derive its origin from the running app or task context. Keep
   unrelated drafts and tasks intact.
3. Choose the type using the references. Fit static artwork first, then add motion
   and sound. Verify the effect's region as well as its visible placement.
4. Save Local content when creation is authorized, reopen it, and verify that the
   image and settings persisted. A successful save is not visual acceptance.
5. When requested, use the saved effect in a Gesture or Reaction and verify its
   timing and coexistence there. Saving an Avatar Effect alone does not equip it
   to an Anima or make it trigger during chat.

Use the visible creator, including its JSON Import when appropriate. Do not
substitute direct database/filesystem writes, hidden React-state changes, or API
saves for a requested UI workflow. If file selection or another required control
cannot be operated with the available tools, explain the specific limitation and
preserve the draft.

General VRM specification and three-vrm mechanics belong in the user's separate
VRM skill when available. This skill explains Animama's composition on top of
them; it does not require that other skill to create an effect. Use image-generation
guidance when the task includes creating artwork, not merely uploading existing art.

## Verification and currency

The references describe the creator and runtime controls as checked on 2026-09-24.
Their browser procedures are source-derived, not evidence of an executed UI pilot.
Use current UI labels and recheck the named source symbols when behavior differs.
Repository paths in the references are relative to the active Animama checkout;
they are navigation aids, not a dependency on a particular machine or worktree.

Report saved names and edit URLs, the avatar used, meaningful settings, checks
performed, and remaining limitations. Distinguish creator preview, save/reopen,
Action playback, and live Anima playback. Stop at the outcome the user requested.

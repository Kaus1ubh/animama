# Motion principles

Use when planning beats and timing. The goal is motion that reads instantly at
chat size, feels weighted and alive, and suits a desktop companion.

## Plan in beats

Write the prompt as 3–6 beats with times before keying anything, for example
"wave hello": anticipation 0–0.15 s, raise 0.15–0.55 s, three waves
0.55–1.8 s, lower 1.8–2.45 s, settle to 2.6 s.

| Kind | Typical length | Shape |
| --- | --- | --- |
| Small acknowledgement (nod, shrug) | 0.8–1.6 s | one or two accents, quick return |
| Expressive one-shot (wave, celebrate) | 1.6–3 s | anticipation, action, follow-through |
| Held/looping pose (thinking, hand on heart) | 1.5–4 s loop | reach once in the clip's fade-in, then an alive hold that loops |

Fades (`fadeIn` 0.25–0.35 s, `fadeOut` 0.3–0.45 s) blend from and back to the
live pose; start and end one-shots at `"base"` values.

## Make it read

- **Anticipation:** a small counter-move before a big one (dip the shoulder,
  draw the head back 2–4°, inhale with the chest) 0.1–0.2 s ahead.
- **Staggered timing (overlap):** never key every region at the same time.
  Order of arrival for most gestures: eyes/head → chest/spine → upper arm →
  forearm → hand → fingers, each 0.03–0.12 s behind the previous. The
  generator interpolates each component independently, so offset key times
  per joint.
- **Follow-through and settle:** let the trailing segment pass its target and
  come back (overshoot 3–8° on forearm/hand, 1–3° on the head) instead of
  stopping dead. Overshoot must be authored as an extra key; `auto` tangents
  never overshoot on their own.
- **Arcs:** hands travel on arcs, not straight lines. Combine elevation with a
  change of plane or elbow flexion so the hand path curves.
- **Ease and holds:** `auto` tangents keep velocity through intermediate keys
  and stop at peaks. Use `"tangent": "flat"` only for a deliberate hold or
  accent. A held pose should still drift 1–3° (breath, head micro-turn) over
  0.6–1.5 s; frozen holds look dead.
- **Weight and balance:** large arm moves shift the torso the other way a
  little (chest lateral flexion 2–4°, hips offset 1–2 cm). Excitement goes up
  and forward; doubt and shyness pull in and down.
- **Asymmetry:** avoid mirrored arms and perfectly centered heads. Tilt the
  head 3–8°, let the non-gesturing arm respond slightly (elbow 5–10°).
- **Secondary action:** a small head tilt, a smile, a blink accent or a finger
  curl adds life; keep it under the main action.
- **Exaggeration:** push the key pose a little beyond realism for
  readability at small sizes, but stay inside the natural (soft) ranges.

## Companion style

Animas idle beside a chat. Prefer friendly, open, readable gestures; keep
loops calm; avoid aggressive or sexualized motion; keep hands away from the
face center unless the prompt calls for it (and declare the contact).

## Loops

A loop's keys at 0 and the duration must match (validation enforces it). When
a track's keys start later or end earlier, the generator blends from its last
key back to its first across the seam rather than holding. Build
held loops as small oscillations around the held pose with different periods
per region (for example head 2.4 s, chest 1.2 s within a 2.4 s loop) so the
repetition is not obvious. Hand-shape and expression tracks in loops should
also return to their starting value.

# Human movement

Use when choosing joint values. Angles are degrees in Animama's anatomical
convention; the canonical basis has the Avatar facing +Z with its own left at
+X. Run `pnpm -s animation joints` for every component's meaning, natural
(soft) range and anatomical (hard) limit; values beyond the soft range are
reported as warnings, beyond the hard limit as failures. Limits summarize AAOS
and Soucie et al. (2011) adult normative ranges, distributed by Animama across
rig segments.

## Components at a glance

| Joint | Components (positive direction) |
| --- | --- |
| hips, spine, chest, upperChest, neck, head | `flexion` forward, `lateralFlexion` toward own left, `rotation` turn to own left |
| eyes | `yaw` look to own left, `pitch` look up. Live gaze (cursor look-at and the model's look-at) can override keyed eyes; mute `cursorLookAt`, keep eye moves small and let the head carry direction |
| Shoulder (girdle) | `elevation` shrug up, `protraction` round forward |
| UpperArm | `elevation` 0 hanging … 90 horizontal … 180 overhead; `planeOfElevation` 0 to the side, 90 straight forward, >90 across the body, <0 behind; `rotation` external (+) |
| LowerArm | `flexion` bend elbow; `supination` palm up/forward (+), pronation (−) |
| Hand | `flexion` toward the palm; `deviation` toward the thumb (+) |
| UpperLeg / LowerLeg / Foot / Toes | hip `flexion`, `abduction`, `rotation`; knee `flexion`; ankle `dorsiflexion`, `inversion` (only with `plantFeet: false`); toe `flexion` (always keyable) |
| Finger segments | `curl` toward the palm, `splay` toward the thumb side (proximal) |
| Thumb segments | `curl` across the palm, `palmarAbduction`, `twist` |

Base (Relaxed Rest) has arms hanging at about 17° elevation, elbows 6°,
wrists 6°; the torso and legs are neutral.

## Coupled motion

Real joints rarely move alone. Add the partners:

- **Arm above ~90°:** the shoulder girdle elevates (10–20°) and the chest
  leans slightly away; overhead reaches also protract the shoulder 5–10°.
- **Turning to look:** eyes and head lead, neck follows, chest turns about a
  third as much, hips barely; split a 40° turn roughly head 20, neck 12,
  upperChest 5, chest 3.
- **Bending forward or back:** distribute across spine, chest and upperChest
  (for example 6/8/6) rather than one joint; add hips flexion for big bows.
- **Weight shift:** hips offset 2–4 cm toward the supporting side with a
  1–2 cm drop, pelvis lateral flexion 2–4° away, chest counter-tilt 2–3°.
  `plantFeet` bends the knees to keep the feet down.
- **One-arm gestures:** turn the chest a few degrees toward the acting arm
  (right arm → negative chest `rotation`) so the gesture opens to the viewer,
  lean the chest slightly away from it (left `lateralFlexion` for a right arm
  raise) and shift the hips away (toward the Avatar's left, +x) as
  counterbalance. The wave example does all three.
- **Laughing or excitement:** chest flexion/extension pulses 3–6° with
  shoulder elevation pulses; head tilts back 5–10° at the peak.

## Arm orientation

- **Where a bent forearm points is set by upper-arm rotation.** With the arm
  raised to the side and ~80° external rotation, elbow flexion lifts the
  forearm vertically (waving, hand up). Unwind that rotation before or while
  lowering the arm, or the forearm swings out to the side; internal rotation
  brings it in front of the body.
- **Palm direction** comes from forearm `supination` plus upper-arm rotation:
  arm hanging, supination 0 → palm faces the thigh; +80 → palm forward;
  −60 → palm back. For a palm-out wave, keep supination near 10–20 and rely
  on external arm rotation.
- **Reaching forward:** `planeOfElevation` 70–100 with elevation 60–90 and
  elbow 20–60; across the body uses plane 110–135.
- **Palms up, forearms out (shrug, "who knows"):** upper arm elevation ~20,
  plane ~15, external rotation ~45; elbow ~85; supination ~75–80; wrist
  `flexion` −10 to −20 (bent back); `open-together` hands. Elbows stay near the ribs.
- **Pointing or reaching to the side:** plane 15–30 (slightly forward reads
  more natural than pure lateral), elevation 70–85, elbow 5–15, rotation near
  0 and supination near 0 for a palm-down point; add the `point` hand preset.
- **Touching the head or chest:** combine elevation, plane and elbow flexion
  to bring the hand there, check with a declared contact, then fine-tune.

## Planted feet

With `plantFeet` true the generator solves hip, knee and ankle each frame on
the reference Avatar. Keep pelvis rotation within ±15° and offsets within a
few centimetres; the checks report slides and lifts on each Avatar because
proportions differ.

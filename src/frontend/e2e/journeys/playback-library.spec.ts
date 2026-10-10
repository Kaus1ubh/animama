import { test } from "../fixtures/animama";
import { attachPlaybackCheckpoint } from "../helpers/checkpoints";
import {
  expectBottomRightDock,
  proveAvatarVFXPlayback,
  proveKawaiiSparklesDom,
  proveParticlePlayback,
  provePoseClipPlayback,
  proveReactionPlayback,
  proveScenePlayback,
  proveVrmaPlayback,
} from "../helpers/playback-assertions";
import type {
  ExpectedPlaybackTarget,
  PlaybackObservation,
} from "../helpers/playback-observation";
import {
  PreviewNetworkRecorder,
  ReadOnlyJourneyGuard,
} from "../helpers/preview-network";
import {
  openLibraryPreview,
  type LibraryPreviewSection,
} from "../helpers/preview-surfaces";

/**
 * What a pose or reaction clip journey must observe while it plays. The pose
 * proof checks neither particle effects nor expression weights.
 */
type ClipExpectations = {
  avatarEffects: readonly string[];
  eventIds: readonly string[];
  particleEffects: readonly string[];
  sceneEffects: readonly string[];
  /** Expression weights the clip must reach. */
  expressionThresholds: Readonly<Record<string, number>>;
};

type LibraryJourney = {
  channel: string;
  contentName: string;
  key: string;
  proof: "avatar" | "particle" | "pose" | "reaction" | "scene" | "vrma";
  requiredFiles: readonly string[];
  section: LibraryPreviewSection;
  target: ExpectedPlaybackTarget;
  /** Required by the pose and reaction proofs. */
  clip?: ClipExpectations;
};

const JOURNEYS: readonly LibraryJourney[] = [
  {
    key: "library-scene-fx-kawaii-sparkles",
    channel: "scene-vfx",
    contentName: "Kawaii Sparkles",
    section: "scene",
    proof: "scene",
    target: { kind: "scene_vfx", runtimeId: "kawaii-sparkles" },
    requiredFiles: [
      "emoji-sparkles-2728.svg",
      "emoji-sparkling-heart-1f496.svg",
    ],
  },
  {
    key: "library-particle-vfx-hearts",
    channel: "particle-vfx",
    contentName: "Hearts",
    section: "particle",
    proof: "particle",
    target: { kind: "particle_vfx", runtimeId: "hearts" },
    requiredFiles: ["heart.png"],
  },
  {
    key: "library-avatar-vfx-eye-confused-swirl",
    channel: "avatar-vfx",
    contentName: "Eye Confused Swirl",
    section: "avatar",
    proof: "avatar",
    target: { kind: "avatar_vfx", runtimeId: "eye_confused_swirl" },
    requiredFiles: ["eye_confused_swirl_r.png"],
  },
  {
    key: "library-reaction-admiration-3",
    channel: "reaction",
    contentName: "Admiration Reaction 3",
    section: "reaction",
    proof: "reaction",
    target: { kind: "anima_pose_clip", runtimeId: "admiration-3" },
    requiredFiles: [
      "heart.png",
      "star3.png",
      "emoji-star-struck-1f929.svg",
      "emoji-sparkles-2728.svg",
    ],
    clip: {
      avatarEffects: ["star3"],
      eventIds: ["scene-emotion-background", "avatar-star3", "particle-hearts"],
      particleEffects: ["hearts"],
      sceneEffects: ["scene-vfx-emotion-admiration"],
      expressionThresholds: { happy: 0.72, relaxed: 0.24 },
    },
  },
  {
    // No Included Gesture plays a Scene Effect, so this Reaction carries the
    // Scene Effect a clip event starts, beside an Avatar and a Particle Effect.
    key: "library-reaction-curiosity-3",
    channel: "reaction",
    contentName: "Curiosity Reaction 3",
    section: "reaction",
    proof: "reaction",
    target: { kind: "anima_pose_clip", runtimeId: "curiosity-3" },
    requiredFiles: [
      "exclamation.png",
      "idea_bulb.png",
      "emoji-thinking-face-1f914.svg",
      "emoji-question-mark-2753.svg",
    ],
    clip: {
      avatarEffects: ["idea_bulb"],
      eventIds: [
        "scene-emotion-background",
        "particle-exclamation",
        "avatar-idea-bulb",
      ],
      particleEffects: ["exclamation"],
      sceneEffects: ["scene-vfx-emotion-curiosity"],
      expressionThresholds: { surprised: 0.48, relaxed: 0.28 },
    },
  },
  {
    key: "library-gesture-being-cocky",
    channel: "vrma",
    contentName: "Being Cocky",
    section: "gesture",
    proof: "vrma",
    target: { kind: "animation", runtimeId: "being_cocky" },
    requiredFiles: ["being_cocky.vrma"],
  },
  {
    key: "library-gesture-have-an-idea",
    channel: "pose-clip",
    contentName: "Have an Idea",
    section: "gesture",
    proof: "pose",
    target: { kind: "anima_pose_clip", runtimeId: "have_idea" },
    requiredFiles: ["idea_bulb_fingertip.png"],
    // The bulb event starts 2.6 s into the clip and shows its effect for
    // 0.95 s; the proof keeps sampling until a sample inside that interval.
    clip: {
      avatarEffects: ["idea_bulb_fingertip"],
      eventIds: ["idea-bulb"],
      particleEffects: [],
      sceneEffects: [],
      expressionThresholds: {},
    },
  },
] as const;

/** The clip expectations a pose or reaction journey declares. */
function clipExpectations(journey: LibraryJourney): ClipExpectations {
  if (!journey.clip)
    throw new Error(`${journey.key} declares no clip expectations.`);
  return journey.clip;
}

for (const journey of JOURNEYS) {
  test(`${journey.key} @surface-library @channel-${journey.channel} @playback-representative @read-only`, async ({
    page,
    animamaEvidence,
  }) => {
    const network = new PreviewNetworkRecorder(page);
    const readOnly = new ReadOnlyJourneyGuard(page);
    try {
      const surface =
        await test.step(`Open Library and preview ${journey.contentName}`, async () => {
          return openLibraryPreview({
            contentName: journey.contentName,
            page,
            section: journey.section,
          });
        });
      let samples: PlaybackObservation[];
      let checkpoint = surface;

      switch (journey.proof) {
        case "scene": {
          const result =
            await test.step("Assert Scene VFX identity, activation, and bottom-right placement", async () => {
              await expectBottomRightDock(surface);
              return proveScenePlayback({
                evidence: animamaEvidence,
                evidenceName: journey.key,
                expectedKind: "background_layers",
                expectedTarget: journey.target,
                surface,
              });
            });
          samples = result.samples;
          checkpoint = result.effectRoot;
          await test.step("Assert both sparkle resources and moving marquee layers are visible", async () => {
            await proveKawaiiSparklesDom(result.effectRoot);
          });
          break;
        }
        case "particle":
          samples =
            await test.step("Assert Particle VFX identity, owner, anchor, and advancing clock", async () => {
              return proveParticlePlayback({
                evidence: animamaEvidence,
                evidenceName: journey.key,
                expectedAnchor: "head",
                expectedOwner: "content-preview",
                expectedTarget: journey.target,
                surface,
              });
            });
          break;
        case "avatar":
          samples =
            await test.step("Assert Avatar VFX identity, target, render mode, and clean diagnostics", async () => {
              return proveAvatarVFXPlayback({
                evidence: animamaEvidence,
                evidenceName: journey.key,
                expectedTarget: journey.target,
                surface,
              });
            });
          break;
        case "reaction": {
          const clip = clipExpectations(journey);
          samples =
            await test.step("Assert reaction timing, expressions, fired events, and all VFX channels", async () => {
              return proveReactionPlayback({
                evidence: animamaEvidence,
                evidenceName: journey.key,
                expectedAvatarEffects: clip.avatarEffects,
                expectedEventIds: clip.eventIds,
                expectedParticleEffects: clip.particleEffects,
                expectedSceneEffects: clip.sceneEffects,
                expectedTarget: journey.target,
                expressionThresholds: clip.expressionThresholds,
                surface,
              });
            });
          break;
        }
        case "vrma":
          samples =
            await test.step(`Assert VRMA ${journey.target.runtimeId} is active, weighted, and advancing`, async () => {
              return proveVrmaPlayback({
                evidence: animamaEvidence,
                evidenceName: journey.key,
                expectedTarget: journey.target,
                surface,
              });
            });
          break;
        case "pose": {
          const clip = clipExpectations(journey);
          samples =
            await test.step("Assert pose timing, resolved bones, fired events, and VFX channels", async () => {
              return provePoseClipPlayback({
                evidence: animamaEvidence,
                evidenceName: journey.key,
                expectedAvatarEffects: clip.avatarEffects,
                expectedEventIds: clip.eventIds,
                expectedSceneEffects: clip.sceneEffects,
                expectedTarget: journey.target,
                maxMissingBones: 1,
                surface,
              });
            });
          break;
        }
      }

      await test.step(`Assert preview API selected ${journey.target.runtimeId} and loaded required resources`, async () => {
        await network.waitForPreview(journey.target.runtimeId);
        await network.requireResources(journey.requiredFiles);
        await network.attach(animamaEvidence, `${journey.key}-preview-network`);
      });
      await test.step("Capture the playback checkpoint and observation", async () => {
        await attachPlaybackCheckpoint({
          evidence: animamaEvidence,
          locator: checkpoint,
          name: journey.key,
          samples,
        });
      });
      await test.step("Assert no catalog or loadout mutations occurred", async () => {
        await readOnly.assertNoMutations(animamaEvidence);
      });
    } finally {
      await network.dispose();
      await readOnly.dispose();
    }
  });
}

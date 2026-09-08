import { test } from "../fixtures/animama";
import { attachPlaybackCheckpoint } from "../helpers/checkpoints";
import {
  expectBottomRightDock,
  proveAvatarVFXPlayback,
  proveChaosChibiDom,
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

type LibraryJourney = {
  channel: string;
  contentName: string;
  key: string;
  proof: "avatar" | "particle" | "pose" | "reaction" | "scene" | "vrma";
  requiredFiles: readonly string[];
  section: LibraryPreviewSection;
  target: ExpectedPlaybackTarget;
};

const JOURNEYS: readonly LibraryJourney[] = [
  {
    key: "library-scene-fx-chaos-chibi",
    channel: "scene-vfx",
    contentName: "Chaos Chibi",
    section: "scene",
    proof: "scene",
    target: { kind: "scene_vfx", runtimeId: "chaos-chibi" },
    requiredFiles: ["chibi-1.png", "chibi-2.png"],
  },
  {
    key: "library-particle-vfx-cartoon-bang",
    channel: "particle-vfx",
    contentName: "Cartoon Bang",
    section: "particle",
    proof: "particle",
    target: { kind: "particle_vfx", runtimeId: "cartoon-bang" },
    requiredFiles: [
      "cartoon-bang-0.png",
      "cartoon-bang-1.png",
      "cartoon-bang-2.png",
      "cartoon-bang-3.png",
      "cartoon-bang-4.png",
      "cartoon-bang-5.png",
    ],
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
    key: "library-gesture-shy-finger-poke",
    channel: "pose-clip",
    contentName: "shy-finger-poke",
    section: "gesture",
    proof: "pose",
    target: { kind: "anima_pose_clip", runtimeId: "shy-finger-poke" },
    requiredFiles: [
      "eye_vv.png",
      "emoji-sparkles-2728.svg",
      "emoji-sparkling-heart-1f496.svg",
    ],
  },
] as const;

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
          await test.step("Assert both Chibi resources and moving marquee layers are visible", async () => {
            await proveChaosChibiDom(result.effectRoot);
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
        case "reaction":
          samples =
            await test.step("Assert reaction timing, expressions, fired events, and all VFX channels", async () => {
              return proveReactionPlayback({
                evidence: animamaEvidence,
                evidenceName: journey.key,
                expectedAvatarEffects: ["star3"],
                expectedEventIds: [
                  "scene-emotion-background",
                  "avatar-star3",
                  "particle-hearts",
                ],
                expectedParticleEffects: ["hearts"],
                expectedSceneEffects: ["scene-vfx-emotion-admiration"],
                expectedTarget: journey.target,
                expressionThresholds: { happy: 0.72, relaxed: 0.24 },
                surface,
              });
            });
          break;
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
        case "pose":
          samples =
            await test.step("Assert pose timing, resolved bones, fired events, and VFX channels", async () => {
              return provePoseClipPlayback({
                evidence: animamaEvidence,
                evidenceName: journey.key,
                expectedAvatarEffects: ["eye_vv_pair"],
                expectedEventIds: [
                  "scene-kawaii-sparkles",
                  "avatar-eye-vv-pair",
                  "sfx-cute-slide",
                  "scene-focus-light-streak",
                ],
                expectedSceneEffects: ["kawaii-sparkles", "light-streak"],
                expectedTarget: journey.target,
                maxMissingBones: 1,
                surface,
              });
            });
          break;
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

import type { Avatar, ProceduralSpeechTimingContext } from "@/lib/avatar";
import type { AvatarUpdateOptions } from "@/lib/avatar/Avatar";
import type { FramePayload } from "@/lib/avatar/types";
import type { LipSyncShaping } from "@/lib/avatar/ExpressionController";
import {
  buildEmotionRuntimeState,
  createEmptyEmotionStateMap,
  type EmotionRuntimeState,
} from "@/lib/emotion";
import { analyseSpeechAudio } from "@/lib/lipsync/audio/features";
import { base64ToBytes } from "@/lib/lipsync/base64";
import { createLipSyncPlanner, type LipSyncPlan } from "@/lib/lipsync/planner";
import {
  phraseChunks,
  plannedGestureTimeline,
  plannedSegment,
  tagOverlayWeights,
} from "@/lib/lipsync/planned-segment";
import type { SpeechGestureTimeline } from "@/lib/speech/speech-gesture-timeline";
import { createSpeechTimingCollector } from "@/lib/speech/provider-speech-timing";
import type { TtsChunkRecord } from "@/lib/speech/tts-chunker";

/*
 * A recorded voice take spoken by the reel's Avatar, the way chat speaks a
 * reply (`stores/avatar-lipsync-bridge-store.ts`), on the reel's frame clock:
 * the app's lip-sync planner aligns the take's text and provider character
 * timing to its audio, the plan's `vowel5` segment drives the mouth, its tag
 * events show on the face while they sound, and its speech gesture timeline
 * schedules talking hands. Chat plans a reply progressively as its audio
 * streams in; a take is planned once, whole, as the planner's evaluation
 * reference does.
 */

export type ReelSpeechRequest = {
  /** Take time (s) the audio starts. */
  at: number;
  sampleRate: number;
  /** 16-bit little-endian mono PCM, base64. */
  pcm: string;
  /** The text sent to the voice, tags included; null uses the alignment's characters. */
  text: string | null;
  /**
   * The provider's character timing for the whole take, as ElevenLabs'
   * `with-timestamps` endpoint returns it: `characters`,
   * `character_start_times_seconds` and `character_end_times_seconds`.
   */
  alignment: unknown;
  /** How the mouth is shaped: viseme presets or ARKit mouth mixes. */
  shaping: LipSyncShaping;
  /** Seconds the mouth moves ahead of the sound. */
  lead: number;
  /** Scale on the mouth's openness (capped at fully open). */
  gain: number;
};

const RUN_ID = "reel-speech";

/** A `vowel5` mouth frame opened `gain` times as wide, capped at fully open. */
function widened(frame: FramePayload, gain: number): FramePayload {
  if (gain === 1 || !Array.isArray(frame.values)) return frame;
  return {
    ...frame,
    values: frame.values.map((value: number) => Math.min(1, value * gain)),
  };
}
/** The expression overlay owner tag events use, as in chat. */
const TAG_OVERLAY_OWNER = "lipsync-tags";

/** Neutral feelings: the planner then adds no emotion face or posture. */
export const NEUTRAL_FEELINGS = buildEmotionRuntimeState(
  createEmptyEmotionStateMap(),
);

export class ReelSpeech {
  readonly at: number;
  readonly durationSec: number;
  /** Why part of the mouth follows the audio alone, or null. */
  readonly fallback: LipSyncPlan["fallback"];
  readonly shaping: LipSyncShaping;
  private readonly lead: number;
  private readonly gain: number;
  private readonly plan: LipSyncPlan;
  private readonly timeline: SpeechGestureTimeline;
  private readonly chunks: TtsChunkRecord[];
  private handsOn = false;
  private overlayShown = false;

  private constructor(request: ReelSpeechRequest) {
    const bytes = base64ToBytes(request.pcm);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const pcm = new Int16Array(Math.floor(bytes.length / 2));
    for (let i = 0; i < pcm.length; i += 1) pcm[i] = view.getInt16(i * 2, true);
    const timing = createSpeechTimingCollector(
      request.sampleRate,
    ).acceptRunAlignment(request.alignment);
    if (timing.length === 0)
      throw new Error(
        "The speech alignment has no character timing: give characters, character_start_times_seconds and character_end_times_seconds of equal length.",
      );
    const text = request.text ?? timing.map(({ char }) => char).join("");
    this.at = request.at;
    this.shaping = request.shaping;
    this.lead = request.lead;
    this.gain = request.gain;
    this.durationSec = pcm.length / request.sampleRate;
    this.plan = createLipSyncPlanner({ text }).plan({
      features: analyseSpeechAudio(pcm, request.sampleRate),
      timing,
      complete: true,
    });
    this.fallback = this.plan.fallback;
    this.timeline = plannedGestureTimeline(
      this.plan.gestures,
      this.durationSec,
    );
    this.chunks = phraseChunks(RUN_ID, this.timeline.phrases ?? []);
  }

  /** Plan a take; throws when its timing cannot be read. */
  static plan(request: ReelSpeechRequest): ReelSpeech {
    return new ReelSpeech(request);
  }

  /**
   * Queue the take's mouth frames on `avatar`, with its audio starting at
   * take time `at` on `clock` (the session's frame clock), the mouth `lead`
   * seconds ahead of it and opened `gain` times as wide.
   *
   * @returns The mouth shaping in effect: ARKit falls back to visemes on an
   *   Avatar without every shape its mixes use.
   */
  attach(
    avatar: Avatar,
    clock: { readonly currentTime: number },
  ): LipSyncShaping {
    const segment = plannedSegment(RUN_ID, this.plan.track.frames);
    avatar.clearLipSync();
    const shaping = avatar.setLipSyncShaping(this.shaping);
    // The lip-sync player only reads `currentTime`.
    avatar.setAudioContext(clock as AudioContext);
    avatar.initLipSyncSegment(segment.meta);
    for (const frame of segment.frames)
      avatar.registerLipSyncFrame(widened(frame, this.gain));
    avatar.onSegmentAudioStarted(segment.segmentId, this.at - this.lead);
    return shaping;
  }

  /** Whether the take is sounding at take time `time`. */
  speaking(time: number): boolean {
    return time >= this.at && time < this.at + this.durationSec;
  }

  /**
   * Chat's per-frame speech inputs at take time `time`: the feelings chat
   * would report then, the planner's talking state while the take sounds
   * (so talking hands may play),
   * talking hands on while no Gesture plays (chat's Gestures take over from
   * them), the take's tag expressions, and the speech timing talking hands
   * schedule beats from.
   */
  frame(
    avatar: Avatar,
    time: number,
    feelings: EmotionRuntimeState = NEUTRAL_FEELINGS,
    gestureDue = false,
  ): AvatarUpdateOptions {
    const speaking = this.speaking(time);
    avatar.updateState(
      {
        emotionalState: feelings,
        signals: { interactionPhase: speaking ? "talking" : "idle" },
      },
      { nowMs: time * 1000, activeRunId: speaking ? RUN_ID : null },
    );
    // Talking hands finish their current group (up to 1.5 s) before they let
    // go, and layer over a Gesture that starts meanwhile; they also stay off
    // while a Gesture cue is due (`gestureDue`), so it starts from rest.
    const hands = speaking && !avatar.isClipActive() && !gestureDue;
    if (hands !== this.handsOn) {
      avatar.setProceduralAnimationLayerEnabled("talkingHands", hands);
      this.handsOn = hands;
    }
    this.showTags(avatar, time);
    if (time < this.at) return {};
    const elapsedSec = Math.min(time - this.at, this.durationSec);
    const timing: ProceduralSpeechTimingContext = {
      runId: RUN_ID,
      elapsedSec,
      utteranceDurationSec: this.durationSec,
      durationSec: this.durationSec,
      remainingSec: this.durationSec - elapsedSec,
      durationKnown: true,
      gestureTimeline: this.timeline,
      ttsChunks: this.chunks,
    };
    return { speechTiming: timing };
  }

  /** Laughs, sighs and gasps show briefly on the face while they sound. */
  private showTags(avatar: Avatar, time: number): void {
    const controller = avatar.expressionController;
    if (!controller) return;
    const weights =
      time >= this.at
        ? tagOverlayWeights(this.plan.track.events, time - this.at)
        : {};
    if (Object.keys(weights).length) {
      controller.setExpressionOverlay(TAG_OVERLAY_OWNER, weights);
      this.overlayShown = true;
    } else if (this.overlayShown) {
      controller.clearExpressionOverlay(TAG_OVERLAY_OWNER);
      this.overlayShown = false;
    }
  }
}

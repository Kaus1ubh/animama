import type * as THREE from "three";

import { parseAnimaPoseClip } from "@/lib/avatar/poses/animaPoseClip";

import { ReviewStage } from "../effect-render/reviewStage";
import {
  EffectSession,
  placeCamera,
  type PageClipMedia,
} from "../effect-render/session";
import {
  chatCameraFraming,
  createStage,
  type Framing,
} from "../effect-render/stage";

/**
 * Live preview for the tuning page: plays one Gesture or Reaction clip in
 * real time on an Included Avatar through the review stage
 * (`../effect-render`), with the chat's lighting, camera preset and Scene
 * layers, and plays each sound a clip event starts. A talking-scoped clip (a
 * Reaction) is held for `talk` seconds and its timed events, then stopped,
 * as chat stops it when the reply ends.
 */

/** Seconds a Reaction is held while "talking", as the reel holds it. */
export const TALK_SEC = 3;
/** Seconds of rest before the clip starts. */
const LEAD_SEC = 0.4;

export type PlayRequest = {
  avatarUrl: string;
  clip: unknown;
  clipMedia: PageClipMedia | null;
  /** The URL of the audio a cue plays, or null when it has none. */
  soundUrl: (cueId: string) => string | null;
  onState?: (state: PlayerState) => void;
  /** A frame failed after playback started; playback has stopped. */
  onError?: (error: unknown) => void;
};

export type PlayerState = "loading" | "playing" | "stopped" | "error";

/** When to stop a clip that doesn't end by itself, or null. */
function stopAfter(clip: ReturnType<typeof parseAnimaPoseClip>): number | null {
  if (clip.playback) {
    const eventsEnd = Math.max(
      0,
      ...(clip.events ?? []).map(
        (event) =>
          event.time + ("duration" in event ? (event.duration ?? 0) : 0),
      ),
    );
    return Math.max(TALK_SEC, clip.duration, eventsEnd);
  }
  return clip.loop === true ? clip.duration : null;
}

export class PreviewPlayer {
  private readonly review: ReviewStage;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private session: EffectSession | null = null;
  private framing: Framing | null = null;
  private frame: number | null = null;
  private generation = 0;
  private readonly audio = new Set<HTMLAudioElement>();

  constructor(host: HTMLElement, width: number, height: number) {
    this.review = new ReviewStage(width, height);
    host.replaceChildren(this.review.element);
    const stage = createStage(width, height, {
      pixelRatio: Math.min(window.devicePixelRatio, 2),
      preserveDrawingBuffer: false,
    });
    this.renderer = stage.renderer;
    this.scene = stage.scene;
    this.camera = stage.camera;
  }

  /** Open a fresh Avatar for `request` and play its clip in real time. */
  async play(request: PlayRequest): Promise<void> {
    this.stop();
    const generation = ++this.generation;
    request.onState?.("loading");
    let parsed: ReturnType<typeof parseAnimaPoseClip>;
    let session: EffectSession;
    try {
      parsed = parseAnimaPoseClip(request.clip);
      session = await EffectSession.open(
        request.avatarUrl,
        this.camera,
        this.renderer.domElement,
        {
          clip: request.clip,
          clipMedia: request.clipMedia,
          expression: null,
          clipPlayback: "avatar",
          onSound: ({ cueId, volume }) => this.sound(request, cueId, volume),
        },
        this.review,
      );
    } catch (error) {
      if (generation === this.generation) request.onState?.("error");
      throw error;
    }
    if (generation !== this.generation) {
      session.dispose();
      return;
    }
    this.session = session;
    this.review.attachCanvas(this.renderer.domElement, session.avatar);
    this.scene.add(session.avatar.scene!);
    this.framing = chatCameraFraming(session.avatar, "portrait");
    request.onState?.("playing");

    const limit = stopAfter(parsed);
    const startedAt = performance.now();
    let applied = false;
    let stopped = false;
    let busy = false;
    const tick = async () => {
      if (generation !== this.generation || busy) return;
      busy = true;
      try {
        if (await frame()) return;
      } catch (error) {
        if (generation === this.generation) {
          this.stop();
          request.onState?.("error");
          request.onError?.(error);
        }
        return;
      } finally {
        busy = false;
      }
      if (generation === this.generation)
        this.frame = requestAnimationFrame(() => void tick());
    };
    /** Draw one frame; true once playback has ended or was replaced. */
    const frame = async (): Promise<boolean> => {
      const time = (performance.now() - startedAt) / 1000;
      if (!applied && time >= LEAD_SEC) {
        await session.advanceTo(LEAD_SEC);
        await session.apply({ effects: [] });
        applied = true;
      }
      await session.advanceTo(time);
      if (generation !== this.generation) return true;
      if (applied && limit !== null && !stopped && time - LEAD_SEC >= limit) {
        session.avatar.stopClip();
        stopped = true;
      }
      placeCamera(this.camera, "front", session.avatar, this.framing!);
      this.renderer.render(this.scene, this.camera);
      await this.review.seek(session.time);
      const idle =
        applied &&
        !session.avatar.isClipActive() &&
        session.diagnostics("preview").activeEffectIds.length === 0;
      if (idle && time - LEAD_SEC > 1) {
        request.onState?.("stopped");
        return true;
      }
      return false;
    };
    this.frame = requestAnimationFrame(() => void tick());
  }

  private sound(request: PlayRequest, cueId: string, volume: number): void {
    const url = request.soundUrl(cueId);
    if (!url) return;
    const audio = new Audio(url);
    audio.volume = Math.max(0, Math.min(1, volume));
    this.audio.add(audio);
    audio.addEventListener("ended", () => this.audio.delete(audio));
    void audio.play().catch(() => this.audio.delete(audio));
  }

  /** Stop playback and release the Avatar; the stage stays for the next play. */
  stop(): void {
    this.generation += 1;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    for (const audio of this.audio) audio.pause();
    this.audio.clear();
    const session = this.session;
    this.session = null;
    if (!session) return;
    if (session.avatar.scene) this.scene.remove(session.avatar.scene);
    session.dispose();
    this.review.bands.clearScenes();
    this.review.bands.setAvatar(null);
  }

  dispose(): void {
    this.stop();
    this.renderer.dispose();
    this.review.dispose();
  }
}

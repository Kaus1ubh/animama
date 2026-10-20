import * as THREE from "three";
import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";

import type { Avatar } from "@/lib/avatar";
import type { AnimaPoseClipV2 } from "@/lib/avatar/poses/animaPoseClip/schemaV2";

/*
 * The hero's entrance: she walks in from the left side-on, at a constant
 * distance from the camera, slows to a stop, glances at the visitor, turns to face them
 * and waves (the stage plays the wave; this module only reports the phase).
 *
 * With walk clips (VRMA: a walk cycle from `WALK_VARIANTS`, then a stop and
 * a turn) she is already mid-stride as she crosses the screen edge; the
 * Avatar plays the clips while this module moves her root along her heading
 * at the cycle's own pace, measured from its motion, so the feet stay
 * planted. Without clips (the default), a procedural gait walks her on
 * from just past the screen edge.
 *
 * The procedural gait: leg swing with knee bend, arm swing,
 * shoulder and hip counter-rotation, a slight forward lean, head
 * stabilisation and a bob that drops as her legs spread, keyed to the
 * distance walked so the cadence slows with her. Feet are not pinned to the
 * floor, so they slide a little; a captured walk clip would fix that. The offsets are added to the
 * normalized bones just before three-vrm copies them to the model (as the
 * stage's look-back does) and removed afterwards, so the Avatar's own pose
 * layers are untouched. Lengths are in head heights, so another Avatar
 * keeps the same proportions.
 */

/**
 * `puzzled` is the scratch walk's clip playing (she is still walking);
 * `turning` is her turn to the camera; `waving` hands over to the stage.
 */
export type IntroPhase = "walking" | "puzzled" | "turning" | "waving" | "done";

/** A walk cycle to enter with: its file and pace. */
type WalkVariant = {
  file: string;
  /**
   * Walking speed per metre of hips height, measured from the clip: its
   * stance foot's backward slide (in-place clips) or its hips travel.
   */
  speedPerHips: number;
  /** The clip carries her forward itself; play it rooted (in place). */
  travels?: boolean;
  /** An `animaPoseClip/2.0` loop (`.clip.json`) rather than a VRMA. */
  pose?: boolean;
};

/**
 * Walk cycles to compare (`?walk=<id>`). Overte's are hand-animated
 * (Apache-2.0); the Mixamo ones are local experiments only.
 */
export const WALK_VARIANTS = {
  // Authored for the landing page: light, bouncy steps; pace estimated from
  // its stance-leg angles on Annie's leg lengths.
  cute: { file: "landing-cute-walk.clip.json", speedPerHips: 1.41, pose: true },
  overte: { file: "world-walk.vrma", speedPerHips: 1.46 },
  "overte-slow": { file: "world-walk-slow.vrma", speedPerHips: 0.352 },
  "overte-fast": { file: "world-walk-fast.vrma", speedPerHips: 1.92 },
  "mixamo-happy": {
    file: "mixamo_happy_walk.vrma",
    speedPerHips: 1.7,
    travels: true,
  },
  "mixamo-catwalk": {
    file: "mixamo_posture_cat_walk.vrma",
    speedPerHips: 0.985,
    travels: true,
  },
} satisfies Record<string, WalkVariant>;
export type WalkVariantId = keyof typeof WALK_VARIANTS;

/** The stop and turn every walk ends with. */
const STOP_FILE = "world-walk-stop.vrma";
const TURN_FILE = "world-turn-right.vrma";

/** Her slowing to a stop as the stop clip begins, and its settle before the turn. */
const CLIP_SLOW_SEC = 0.4;
const CLIP_SETTLE_SEC = 0.55;
/** The turn clip's length, over which her root turns to face the camera. */
const CLIP_TURN_SEC = 1;
/**
 * How far past the screen edge her centre starts, in metres: just enough
 * that she is already stepping into view on the first frame.
 */
const OFFSCREEN_MARGIN = 0.05;
/** Crossfades between the walk clips. */
const CLIP_FADE_SEC = 0.2;

const DEG = Math.PI / 180;

/**
 * Her heading while walking (0 faces the camera, 90 is profile toward the
 * screen's right): side-on, so she crosses the frame at a constant size.
 */
const WALK_HEADING = 90 * DEG;
/** Her walking pace, in head heights per second, before she slows. */
const CRUISE = 0.95;
/** Share of the walk spent slowing to a stop. */
const SLOW_SHARE = 0.4;
/** One full stride (two steps), and the bob at each step. */
const STRIDE = 0.95;
const BOB = 0.035;
/**
 * How much of her travel the camera follows: a tracking shot, so she
 * crosses the screen slowly enough for the scratch and double take.
 */
const CAMERA_PAN = 0.65;
/** The turn to face the camera, and the glance toward it that leads it. */
const TURN_SEC = 1.15;
/**
 * The procedural turn is a stepped pivot, not a spin: her head and chest
 * lead (turning this share of the way ahead of her body), then two small
 * steps carry her round, the right foot opening first and the left
 * following; each step turns her part of the way while that foot is up.
 * Windows are shares of `TURN_SEC`.
 */
const TURN_LEAD = 0.7;
/**
 * The scratch walk (procedural walk with the stage's clip): one continuous
 * motion on the clip's clock. She walks in scratching her head with her
 * camera-side hand, does a double take (the clip's head and eyes), and the
 * turn to face the camera starts with the take while she is still slowing,
 * her feet stepping round it. Times are clip seconds and match the clip's
 * beats (`landing-walk-scratch-take.clip.json`).
 */
const SCRATCH = {
  /** The walk comes to rest here. */
  stop: 2.35,
  /** Her body turns from side-on to the camera over this window. */
  turnFrom: 2.1,
  turnTo: 3.0,
  /** Her right arm leaves the walk's swing for her head, and returns. */
  armUp: [0.45, 0.93],
  armDown: [2.2, 2.8],
  /** Stepping in place while she turns: strength and pace (head heights/s). */
  turnGait: 0.5,
  turnStepPace: 0.5,
} as const;
const TURN_STEPS = [
  { from: 0.12, to: 0.55, share: 0.55, foot: 0 },
  { from: 0.5, to: 0.95, share: 0.45, foot: 1 },
] as const;
const GLANCE_SEC = 0.6;
const GLANCE = 0.45;

type Axis = "lateral" | "up" | "forward";
/** A leg's lift (radians) at step strength `lift` (0–1, peaking mid-step). */
type Step = [VRMHumanBoneName, Axis, (lift: number) => number];

/** One small turning step: thigh forward, knee bent, toes lifted. */
const stepOffsets = (side: "left" | "right"): Step[] => [
  [`${side}UpperLeg`, "lateral", (lift) => -16 * DEG * lift],
  [`${side}LowerLeg`, "lateral", (lift) => 32 * DEG * lift],
  [`${side}Foot`, "lateral", (lift) => -10 * DEG * lift],
];
/** A bone's gait offset (radians) at gait phase `phase` (one stride = 2π). */
type Gait = [VRMHumanBoneName, Axis, (phase: number) => number];

const GAIT: Gait[] = [
  // Legs swing opposite the arms; the knee folds as each leg swings through.
  ["leftUpperLeg", "lateral", (p) => Math.sin(p) * 20 * DEG],
  ["rightUpperLeg", "lateral", (p) => -Math.sin(p) * 20 * DEG],
  [
    "leftLowerLeg",
    "lateral",
    (p) => (4 + 38 * Math.max(0, -Math.cos(p))) * DEG,
  ],
  [
    "rightLowerLeg",
    "lateral",
    (p) => (4 + 38 * Math.max(0, Math.cos(p))) * DEG,
  ],
  ["leftFoot", "lateral", (p) => -Math.max(0, -Math.cos(p)) * 12 * DEG],
  ["rightFoot", "lateral", (p) => -Math.max(0, Math.cos(p)) * 12 * DEG],
  // Arms swing opposite each other, elbows a little bent.
  ["leftUpperArm", "lateral", (p) => -Math.sin(p) * 16 * DEG],
  ["rightUpperArm", "lateral", (p) => Math.sin(p) * 16 * DEG],
  [
    "leftLowerArm",
    "lateral",
    (p) => (-10 - 6 * Math.max(0, -Math.sin(p))) * DEG,
  ],
  [
    "rightLowerArm",
    "lateral",
    (p) => (-10 - 6 * Math.max(0, Math.sin(p))) * DEG,
  ],
  // Hips and shoulders counter-rotate; the hips roll onto each step.
  ["hips", "up", (p) => Math.sin(p) * 4 * DEG],
  ["hips", "forward", (p) => Math.cos(p) * 1.5 * DEG],
  ["spine", "up", (p) => -Math.sin(p) * 3 * DEG],
  ["spine", "lateral", () => 3 * DEG],
  ["chest", "up", (p) => -Math.sin(p) * 3 * DEG],
  // The head stays level and steady, nodding slightly with each step.
  ["head", "up", (p) => Math.sin(p) * 2 * DEG],
  ["head", "lateral", (p) => -2 * DEG + Math.cos(2 * p) * 1.2 * DEG],
];

const smoothstep = (t: number) => t * t * (3 - 2 * t);
const smootherstep = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

/** Names the intro's clips play under, so it can stop them. */
const CLIP_NAMES = {
  walk: "intro-walk",
  stop: "intro-walk-stop",
  turn: "intro-turn",
} as const;

/** The clip walk's timeline and the clips it plays. */
type ClipPlan = {
  urls: { walk: string; stop: string; turn: string };
  /** The walk cycle as a pose clip, when the variant is one. */
  poseWalk: AnimaPoseClipV2 | null;
  rooted: boolean;
  speed: number;
  distance: number;
  stopAt: number;
  turnAt: number;
  endAt: number;
};

export class Intro {
  phase: IntroPhase = "walking";
  private readonly avatar: Avatar;
  private readonly vrm: VRM;
  private readonly height: number;
  /** The clip walk, or null for the procedural gait. */
  private readonly plan: ClipPlan | null;
  private elapsed = 0;
  /** Distance walked (head heights) and the gait's strength (0–1). */
  private walked = 0;
  private gait = 1;
  /** Whether the procedural walk is the scratch walk (with its clip). */
  private readonly puzzle: boolean;
  /** Her walking pace (head heights/s), slower on a narrow screen. */
  private cruise = CRUISE;
  /** When the scratch walk's clip starts, in seconds from the intro's start. */
  private clipStart = 0;
  /** Gait cycle position (head heights walked, plus steps while turning). */
  private stride = 0;
  /** How free her right arm is to swing (0 while it scratches her head). */
  private rightArmSwing = 1;
  /** Her heading when the turn began (radians), which it turns from. */
  private turnFrom = WALK_HEADING;
  /** The glance when the turn began, which the turn leads on from. */
  private turnGlanceFrom = GLANCE;
  /** Lift of the right and left turning steps (0–1). */
  private stepLift: [number, number] = [0, 0];
  private glance = 0;
  /** Clip cues already played, by name. */
  private readonly played = new Set<string>();
  /** Procedural walk: start (head heights from her mark) and length (s). */
  private startX = 0;
  private walkSec = 0;

  /**
   * Prepare the entrance. `clipUrls` maps served VRMA file names to URLs;
   * with the variant's clips present she walks on with them (falling back to
   * the procedural gait if they fail to load). `edgeX` is the screen's left
   * edge at her depth, in metres from her mark, while the camera is still.
   * `headHeight` is in metres.
   */
  static async create(
    avatar: Avatar,
    headHeight: number,
    options: {
      clipUrls: Record<string, string> | null;
      variant: WalkVariantId;
      edgeX: number;
      /** Stop for the puzzled head scratch before turning (procedural walk). */
      puzzle: boolean;
    },
  ): Promise<Intro> {
    const variant: WalkVariant = WALK_VARIANTS[options.variant];
    const urls = options.clipUrls && {
      walk: options.clipUrls[variant.file],
      stop: options.clipUrls[STOP_FILE],
      turn: options.clipUrls[TURN_FILE],
    };
    let usable = urls && Object.values(urls).every(Boolean) ? urls : null;
    let poseWalk: AnimaPoseClipV2 | null = null;
    if (usable) {
      try {
        const vrma = variant.pose
          ? [usable.stop, usable.turn]
          : Object.values(usable);
        await Promise.all(
          vrma.map((url) => avatar.loadAnimationClip(url, { clipName: url })),
        );
        if (variant.pose) {
          const response = await fetch(usable.walk);
          if (!response.ok)
            throw new Error(`${usable.walk}: ${response.status}`);
          poseWalk = (await response.json()) as AnimaPoseClipV2;
        }
      } catch (error) {
        console.warn(
          "Walk clips failed to load; using the procedural walk.",
          error,
        );
        usable = null;
      }
    }
    return new Intro(
      avatar,
      headHeight,
      usable && { urls: usable, poseWalk },
      variant,
      options.edgeX,
      options.puzzle,
    );
  }

  private constructor(
    avatar: Avatar,
    headHeight: number,
    clips: Pick<ClipPlan, "urls" | "poseWalk"> | null,
    variant: WalkVariant,
    edgeX: number,
    puzzle: boolean,
  ) {
    this.avatar = avatar;
    this.puzzle = puzzle;
    this.vrm = avatar.vrm!;
    this.height = headHeight;
    this.plan = clips ? this.planClips(clips, variant, edgeX) : null;
    const scene = this.vrm.scene;
    scene.rotation.y = WALK_HEADING;
    if (this.plan) {
      this.gait = 0;
      // A travelling clip would carry her off her path; play it in place.
      if (this.plan.rooted) avatar.setVrmaRootedPlaybackEnabled(true);
      this.placeAlongHeading(-this.plan.distance);
    } else {
      // Start just past the screen edge, already at full pace.
      // She starts at the screen edge, already walking into view: no steps
      // are taken off screen.
      const fromEdge = (edgeX + OFFSCREEN_MARGIN) / (1 - CAMERA_PAN);
      this.startX = -fromEdge / headHeight;
      // The scratch walk needs its clip's walking time; on a narrow screen
      // she walks more slowly rather than starting out of view.
      if (puzzle)
        this.cruise = Math.min(
          CRUISE,
          -this.startX / (SCRATCH.stop * (1 - SLOW_SHARE / 2)),
        );
      this.walkSec = -this.startX / (this.cruise * (1 - SLOW_SHARE / 2));
      // The clip starts so that its walk ends when hers does.
      this.clipStart = puzzle ? this.walkSec - SCRATCH.stop : 0;
      scene.position.x = this.startX * headHeight;
      this.installGait();
    }
  }

  /** Whether the walk plays clips rather than the procedural gait. */
  get usesClips() {
    return this.plan !== null;
  }

  /** The camera's sideways follow (metres) while she walks in. */
  get cameraX() {
    return this.vrm.scene.position.x * CAMERA_PAN;
  }

  /**
   * The upper-body turn toward the camera (radians, about the vertical)
   * that leads her body round: her glance before and during the turn.
   */
  get glanceTurn() {
    return -this.vrm.scene.rotation.y * this.glance;
  }

  /** Advance the walk and turn; returns the phase (the stage plays the wave). */
  update(delta: number): IntroPhase {
    this.elapsed += delta;
    if (this.plan) this.updateClips(this.plan);
    else if (this.puzzle) this.updateScratchWalk(delta);
    else this.updateProcedural(delta);
    return this.phase;
  }

  /**
   * The scratch walk: walking in, slowing to her mark and turning to the
   * camera as one motion, timed to the clip the stage plays from `puzzled`.
   */
  private updateScratchWalk(delta: number) {
    const scene = this.vrm.scene;
    const t = this.elapsed;
    const c = t - this.clipStart;
    const clamp01 = (v: number) => THREE.MathUtils.clamp(v, 0, 1);
    // Along her path: full pace, then slowing to a stop on her mark.
    const before = this.walked;
    this.walked = this.distanceAt(Math.min(t, this.walkSec));
    scene.position.x = (this.startX + this.walked) * this.height;
    const speed = (this.walked - before) / Math.max(delta, 1e-4);
    // Turning: side-on to facing the camera, starting with the double take.
    const turn = clamp01(
      (c - SCRATCH.turnFrom) / (SCRATCH.turnTo - SCRATCH.turnFrom),
    );
    scene.rotation.y = WALK_HEADING * (1 - smootherstep(turn));
    // Her feet keep stepping through the turn, then settle.
    const turnGait = SCRATCH.turnGait * Math.sin(Math.PI * turn);
    this.gait = Math.max(Math.sqrt(Math.min(1, speed / this.cruise)), turnGait);
    this.stride +=
      this.walked - before + turnGait * SCRATCH.turnStepPace * delta;
    const phase = (this.stride / STRIDE) * Math.PI * 2;
    scene.position.y =
      -BOB * this.height * this.gait * (0.5 - 0.5 * Math.cos(2 * phase));
    // The scratching arm leaves the walk's swing, and rejoins it lowered.
    const [upFrom, upTo] = SCRATCH.armUp;
    const [downFrom, downTo] = SCRATCH.armDown;
    this.rightArmSwing =
      1 -
      smoothstep(clamp01((c - upFrom) / (upTo - upFrom))) *
        (1 - smoothstep(clamp01((c - downFrom) / (downTo - downFrom))));
    this.glance = 0;
    this.phase =
      c >= SCRATCH.turnTo
        ? "waving"
        : c >= SCRATCH.turnFrom
          ? "turning"
          : c >= 0
            ? "puzzled"
            : "walking";
  }

  /** Jump to the end: facing the camera on her mark, the walk gone. */
  finish() {
    const scene = this.vrm.scene;
    scene.position.set(0, 0, 0);
    scene.rotation.y = 0;
    this.gait = 0;
    this.stepLift = [0, 0];
    this.glance = 0;
    if (this.plan && this.phase !== "waving") {
      for (const name of Object.values(CLIP_NAMES))
        this.avatar.animationManager?.stopAction(name);
      if (this.plan.poseWalk && !this.played.has("pose-release"))
        this.avatar.stopClip();
    }
    this.unroot();
    this.phase = "done";
  }

  /**
   * Pace and cue times for the clip walk: she starts just past the screen
   * edge, already at full pace, and walks to her mark.
   */
  private planClips(
    { urls, poseWalk }: Pick<ClipPlan, "urls" | "poseWalk">,
    variant: WalkVariant,
    edgeX: number,
  ): ClipPlan {
    const hips = this.vrm.humanoid
      .getNormalizedBoneNode("hips")!
      .getWorldPosition(new THREE.Vector3()).y;
    const speed = variant.speedPerHips * hips;
    // The camera follows a share of her travel, so start further out.
    const distance = (edgeX + OFFSCREEN_MARGIN) / (1 - CAMERA_PAN);
    // Slowing down covers half its time at full pace.
    const stopAt = Math.max(0, distance / speed - CLIP_SLOW_SEC / 2);
    const turnAt = stopAt + CLIP_SETTLE_SEC;
    return {
      urls,
      poseWalk,
      rooted: variant.travels === true,
      speed,
      distance,
      stopAt,
      turnAt,
      endAt: turnAt + CLIP_TURN_SEC,
    };
  }

  /** Clip walk: cue the clips and move her root at the cycle's pace. */
  private updateClips(plan: ClipPlan) {
    const t = this.elapsed;
    if (plan.poseWalk) this.cuePose(plan.poseWalk, plan.stopAt);
    else this.cue(0, plan.urls.walk, CLIP_NAMES.walk, "repeat");
    this.cue(plan.stopAt, plan.urls.stop, CLIP_NAMES.stop, "once");
    this.cue(plan.turnAt, plan.urls.turn, CLIP_NAMES.turn, "once");

    // Full pace from the start, then slowing to a stop as the stop clip
    // begins; speed eases with smoothstep, whose integral is `rise`.
    const v = plan.speed;
    const rise = (s: number) => s ** 3 - s ** 4 / 2;
    const slowed = Math.min(1, Math.max(0, t - plan.stopAt) / CLIP_SLOW_SEC);
    const travelled =
      v * Math.min(t, plan.stopAt) +
      v * CLIP_SLOW_SEC * (slowed - rise(slowed));
    this.placeAlongHeading(travelled - plan.distance);

    // Glance at the visitor as she settles, then turn under it.
    this.glance =
      GLANCE *
      smoothstep(
        THREE.MathUtils.clamp(
          (t - (plan.turnAt - GLANCE_SEC)) / GLANCE_SEC,
          0,
          1,
        ),
      );
    if (t >= plan.turnAt) {
      this.phase = "turning";
      const eased = easeInOutCubic(
        Math.min(1, (t - plan.turnAt) / CLIP_TURN_SEC),
      );
      this.vrm.scene.rotation.y = WALK_HEADING * (1 - eased);
      this.glance = GLANCE * (1 - eased);
    }
    if (t >= plan.endAt) {
      // Back to her own pose layers before the wave.
      this.avatar.stopAnimation(CLIP_NAMES.turn);
      this.unroot();
      this.phase = "waving";
    }
  }

  /** Loop the pose-clip walk from the start, and release it at `stopAt`. */
  private cuePose(clip: AnimaPoseClipV2, stopAt: number) {
    if (!this.played.has(CLIP_NAMES.walk)) {
      this.played.add(CLIP_NAMES.walk);
      this.avatar.playAnimaPoseClip(clip, { preserveProceduralOffsets: true });
    } else if (this.elapsed >= stopAt && !this.played.has("pose-release")) {
      this.played.add("pose-release");
      this.avatar.stopClip({
        transition: { mode: "fadeOut", durationSec: CLIP_FADE_SEC },
      });
    }
  }

  /** Restore the Avatar's usual (unrooted) VRMA playback. */
  private unroot() {
    if (this.plan?.rooted && this.avatar.isVrmaRootedPlaybackEnabled())
      this.avatar.setVrmaRootedPlaybackEnabled(false);
  }

  /** Play a clip once its cue time arrives (each cue fires once). */
  private cue(
    at: number,
    url: string,
    name: string,
    loopType: "once" | "repeat",
  ) {
    if (this.elapsed < at || this.played.has(name)) return;
    this.played.add(name);
    // Through the manager directly: the Avatar's own helper would fade to the
    // rest pose whenever a one-shot finishes, between clips.
    void this.avatar.animationManager?.playAnimationWithName(url, name, {
      loopType,
      fadeDuration: name === CLIP_NAMES.walk ? 0 : CLIP_FADE_SEC,
    });
  }

  /** Put her `along` metres from her mark along her walking heading. */
  private placeAlongHeading(along: number) {
    const scene = this.vrm.scene;
    scene.position.set(
      Math.sin(WALK_HEADING) * along,
      0,
      Math.cos(WALK_HEADING) * along,
    );
  }

  /** Procedural walk: slide her across while the gait animates her. */
  private updateProcedural(delta: number) {
    const scene = this.vrm.scene;
    if (this.phase === "walking") {
      const t = Math.min(this.elapsed, this.walkSec);
      const before = this.walked;
      this.walked = this.distanceAt(t);
      const speed = (this.walked - before) / Math.max(delta, 1e-4);
      // Arms swing less as she slows; a little remains into the turn.
      this.gait = Math.sqrt(Math.min(1, speed / this.cruise));
      scene.position.x = (this.startX + this.walked) * this.height;
      // She glances at the visitor as she stops.
      this.glance =
        GLANCE *
        smoothstep(Math.max(0, (t - (this.walkSec - GLANCE_SEC)) / GLANCE_SEC));
      const phase = (this.walked / STRIDE) * Math.PI * 2;
      // Lowest as each foot lands (legs spread), highest as she passes over it.
      scene.position.y =
        -BOB * this.height * this.gait * (0.5 - 0.5 * Math.cos(2 * phase));
      if (this.elapsed >= this.walkSec) {
        this.phase = "turning";
        this.turnFrom = scene.rotation.y;
        this.turnGlanceFrom = this.glance;
        this.elapsed = 0;
      }
    } else if (this.phase === "turning") {
      const t = Math.min(1, this.elapsed / TURN_SEC);
      // Each step: the foot lifts and lands while her body turns its share.
      let turned = 0;
      TURN_STEPS.forEach(({ from, to, share, foot }) => {
        const s = THREE.MathUtils.clamp((t - from) / (to - from), 0, 1);
        this.stepLift[foot] = Math.sin(Math.PI * s);
        turned += share * smootherstep(s);
      });
      scene.rotation.y = this.turnFrom * (1 - turned);
      // Head and chest lead, turned ahead of her body, then settle over it.
      this.glance = THREE.MathUtils.lerp(
        this.turnGlanceFrom,
        TURN_LEAD,
        smoothstep(Math.min(1, t / 0.3)),
      );
      this.gait *= 1 - t;
      // She sinks a little into the turn and rises as she faces the camera.
      scene.position.y = -0.4 * BOB * this.height * Math.sin(Math.PI * t);
      if (t >= 1) this.phase = "waving";
    }
  }

  /** Distance walked by `t` seconds: a steady pace, then slowing to a stop. */
  private distanceAt(t: number) {
    const slowFrom = this.walkSec * (1 - SLOW_SHARE);
    if (t <= slowFrom) return this.cruise * t;
    const slowFor = this.walkSec * SLOW_SHARE;
    const s = Math.min(1, (t - slowFrom) / slowFor);
    return this.cruise * slowFrom + this.cruise * slowFor * (s - (s * s) / 2);
  }

  private installGait() {
    const vrm = this.vrm;
    type Driven = {
      node: THREE.Object3D;
      axis: Axis;
      angle: () => number;
    };
    const drive = (
      name: VRMHumanBoneName,
      axis: Axis,
      angle: () => number,
    ): Driven[] => {
      const node = vrm.humanoid.getNormalizedBoneNode(name);
      return node ? [{ node, axis, angle }] : [];
    };
    const phase = () =>
      ((this.puzzle ? this.stride : this.walked) / STRIDE) * Math.PI * 2;
    // The right arm's swing gives way while that hand scratches her head.
    const swing = (name: VRMHumanBoneName) =>
      name.startsWith("rightUpperArm") || name.startsWith("rightLowerArm")
        ? this.rightArmSwing
        : 1;
    const bones = [
      ...GAIT.flatMap(([name, axis, offset]) =>
        drive(name, axis, () => offset(phase()) * this.gait * swing(name)),
      ),
      ...(["right", "left"] as const).flatMap((side, index) =>
        stepOffsets(side).flatMap(([name, axis, offset]) =>
          drive(name, axis, () => offset(this.stepLift[index])),
        ),
      ),
    ];
    const nodes = [...new Set(bones.map(({ node }) => node))];
    const saved = nodes.map(() => new THREE.Quaternion());
    const axes: Record<Axis, THREE.Vector3> = {
      lateral: new THREE.Vector3(1, 0, 0),
      up: new THREE.Vector3(0, 1, 0),
      forward: new THREE.Vector3(0, 0, 1),
    };
    const worldAxis = new THREE.Vector3();
    const parentWorld = new THREE.Quaternion();
    const worldTurn = new THREE.Quaternion();
    const localTurn = new THREE.Quaternion();
    const update = vrm.update.bind(vrm);
    vrm.update = (delta: number) => {
      if (this.gait < 1e-3 && Math.max(...this.stepLift) < 1e-3)
        return update(delta);
      nodes.forEach((node, index) => saved[index].copy(node.quaternion));
      for (const { node, axis, angle } of bones) {
        // Her own axes (right, up, forward) as they point in the world now.
        worldAxis.copy(axes[axis]).applyQuaternion(vrm.scene.quaternion);
        node.parent!.getWorldQuaternion(parentWorld);
        worldTurn.setFromAxisAngle(worldAxis, angle());
        // Rotate about that axis through the bone's own pivot.
        localTurn
          .copy(parentWorld)
          .invert()
          .multiply(worldTurn)
          .multiply(parentWorld);
        node.quaternion.premultiply(localTurn);
      }
      update(delta);
      nodes.forEach((node, index) => node.quaternion.copy(saved[index]));
    };
  }
}

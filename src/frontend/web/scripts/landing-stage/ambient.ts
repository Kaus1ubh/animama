/*
 * The stage's ambient layer: a 2D canvas between the backdrop and the Avatar
 * with two moods a stop can ask for.
 *
 * - `sparkles`: pastel four-point sparkles and soft dots in the app's theme
 *   hues, for the light stops. Each lives a few seconds: it pops in, wanders
 *   and twinkles, then shrinks away while a new one appears elsewhere.
 * - `stars`: a twinkling star field with the odd shooting star, for night.
 *
 * Each mood has a weight (0–1) the stage blends between stops as the page
 * scrolls; a mood at weight 0 neither spawns nor draws. Positions are kept in
 * viewport units so a resize never reshuffles the scene, and sprites are
 * drawn once to offscreen canvases so a frame is mostly `drawImage` calls.
 * With reduced motion the layer is a still picture with no shooting stars.
 */

export type AmbientMood = "sparkles" | "stars";
export type AmbientWeights = Record<AmbientMood, number>;

/** Pastel theme hues (pink, sky, lime, lavender, peach), a touch richer than the tokens. */
export const SPARKLE_COLORS = [
  "#ff9db7",
  "#6fc4ee",
  "#acdf4f",
  "#b9a0ff",
  "#ffbd73",
];
/** Sparkles per million viewport pixels, and the bounds on their number. */
const SPARKLE_DENSITY = 28;
const SPARKLE_COUNT = [14, 42] as const;
/** Share of sparkles that are plain dots rather than four-point stars. */
const DOT_SHARE = 0.3;
/** A sparkle's lifetime, its pop-in and its fade-out, in seconds. */
const SPARKLE_LIFE = [2.5, 5] as const;
const SPARKLE_BIRTH_SEC = 0.35;
const SPARKLE_DEATH_SEC = 0.8;
const STAR_DENSITY = 70;
const STAR_COUNT = [40, 120] as const;
/** Seconds between shooting stars. */
const SHOOTING_GAP = [1.6, 4.2] as const;
/** Stars twinkle in the top share of the sky, where the backdrop is darkest. */
const SKY_DEPTH = 0.62;
/** Sprite resolution; sprites are scaled down when drawn. */
const SPRITE_PX = 64;

type Sparkle = {
  /** Home position in viewport units, around which it wanders. */
  x: number;
  y: number;
  /** Size as a share of the viewport's shorter side. */
  size: number;
  /** Wander reach (viewport units) and rate (radians per second) per axis. */
  reach: [number, number];
  rate: [number, number];
  phase: number;
  /** Tilt in radians; sparkles rock around it rather than spin. */
  angle: number;
  sprite: HTMLCanvasElement;
  /** Parallax depth: nearer sparkles are larger and move further on scroll. */
  depth: number;
  /** Seconds lived and seconds to live. */
  age: number;
  life: number;
};

type Star = {
  x: number;
  y: number;
  size: number;
  phase: number;
  rate: number;
};

type ShootingStar = {
  /** Head position in viewport units. */
  x: number;
  y: number;
  /** Direction (unit vector, in pixels so the angle is true on any aspect). */
  dx: number;
  dy: number;
  /** Speed in viewport widths per second. */
  speed: number;
  /** Tail length as a share of the viewport width. */
  tail: number;
  age: number;
  life: number;
};

const random = (min: number, max: number) => min + Math.random() * (max - min);
/** 0 → 1 with a small overshoot, for a playful pop. */
const easeOutBack = (t: number) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;

function spriteCanvas(draw: (context: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = SPRITE_PX;
  canvas.height = SPRITE_PX;
  const context = canvas.getContext("2d")!;
  context.translate(SPRITE_PX / 2, SPRITE_PX / 2);
  draw(context);
  return canvas;
}

/**
 * A soft glow, then an anime-style four-point sparkle (long vertical arms,
 * shorter horizontal ones, deeply pinched sides) with a light core.
 */
export function sparkleSprite(color: string) {
  return spriteCanvas((context) => {
    const r = SPRITE_PX / 2;
    const glow = context.createRadialGradient(0, 0, 0, 0, 0, r);
    glow.addColorStop(0, `${color}66`);
    glow.addColorStop(1, `${color}00`);
    context.fillStyle = glow;
    context.fillRect(-r, -r, SPRITE_PX, SPRITE_PX);
    const tall = r * 0.9;
    const wide = r * 0.62;
    const waist = r * 0.07;
    context.beginPath();
    context.moveTo(0, -tall);
    context.quadraticCurveTo(waist, -waist, wide, 0);
    context.quadraticCurveTo(waist, waist, 0, tall);
    context.quadraticCurveTo(-waist, waist, -wide, 0);
    context.quadraticCurveTo(-waist, -waist, 0, -tall);
    context.fillStyle = color;
    context.fill();
    const core = context.createRadialGradient(0, 0, 0, 0, 0, r * 0.2);
    core.addColorStop(0, "rgb(255 255 255 / 0.9)");
    core.addColorStop(1, "rgb(255 255 255 / 0)");
    context.fillStyle = core;
    context.fillRect(-r, -r, SPRITE_PX, SPRITE_PX);
  });
}

/** A round dot with a soft edge, for the sparkles' smaller companions. */
export function dotSprite(color: string) {
  return spriteCanvas((context) => {
    const r = SPRITE_PX / 2;
    const dot = context.createRadialGradient(0, 0, 0, 0, 0, r);
    dot.addColorStop(0, color);
    dot.addColorStop(0.45, `${color}cc`);
    dot.addColorStop(1, `${color}00`);
    context.fillStyle = dot;
    context.fillRect(-r, -r, SPRITE_PX, SPRITE_PX);
  });
}

/** A white star with a faint lavender halo. */
const starSprite = () =>
  spriteCanvas((context) => {
    const r = SPRITE_PX / 2;
    const glow = context.createRadialGradient(0, 0, 0, 0, 0, r);
    glow.addColorStop(0, "rgb(255 255 255 / 1)");
    glow.addColorStop(0.18, "rgb(255 255 255 / 0.85)");
    glow.addColorStop(0.4, "rgb(214 200 255 / 0.25)");
    glow.addColorStop(1, "rgb(214 200 255 / 0)");
    context.fillStyle = glow;
    context.fillRect(-r, -r, SPRITE_PX, SPRITE_PX);
  });

export class AmbientLayer {
  private readonly context: CanvasRenderingContext2D;
  private readonly still = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  private readonly sparkleSprites = SPARKLE_COLORS.map(sparkleSprite);
  private readonly dotSprites = SPARKLE_COLORS.map(dotSprite);
  private readonly star = starSprite();
  private sparkles: Sparkle[] = [];
  private stars: Star[] = [];
  private shooting: ShootingStar[] = [];
  private nextShot = random(...SHOOTING_GAP) * 0.4;
  private width = 0;
  private height = 0;
  private time = 0;
  /** Whether the canvas is collapsed while no stop shows the ambient layer. */
  private parked = true;

  /** Size the canvas's backing store to the screen (resetting its context). */
  private allocate() {
    const ratio = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d")!;
  }

  /** Match the viewport; reseeds only when the particle counts change. */
  setSize(width: number, height: number) {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    if (!this.parked) this.allocate();
    const megapixels = (width * height) / 1e6;
    const count = (density: number, [min, max]: readonly [number, number]) =>
      Math.round(Math.min(max, Math.max(min, density * megapixels)));
    const sparkles = count(SPARKLE_DENSITY, SPARKLE_COUNT);
    while (this.sparkles.length < sparkles)
      this.sparkles.push(this.newSparkle(true));
    this.sparkles.length = sparkles;
    const stars = count(STAR_DENSITY, STAR_COUNT);
    while (this.stars.length < stars) this.stars.push(this.newStar());
    this.stars.length = stars;
  }

  /**
   * Advance and draw one frame. `scroll` is the page position in stops, for
   * a gentle parallax on the sparkles.
   */
  frame(delta: number, weights: AmbientWeights, scroll: number) {
    // Park the full-screen canvas while nothing shows on it: a backing store
    // the size of the screen (20 MB on Retina) would otherwise be cleared and
    // composited every frame for nothing.
    if (weights.sparkles <= 0.002 && weights.stars <= 0.002) {
      if (!this.parked) {
        this.parked = true;
        this.canvas.width = 0;
        this.canvas.height = 0;
        this.shooting = [];
      }
      return;
    }
    if (this.parked) {
      this.parked = false;
      this.allocate();
    }
    const { context, width, height } = this;
    const still = this.still.matches;
    const step = still ? 0 : delta;
    this.time += step;
    context.clearRect(0, 0, width, height);
    if (weights.sparkles > 0.002)
      this.drawSparkles(step, weights.sparkles, scroll);
    if (weights.stars > 0.002) {
      this.drawStars(weights.stars);
      if (!still) this.drawShootingStars(delta, weights.stars);
    } else this.shooting = [];
  }

  /**
   * A new sparkle somewhere on screen. The first batch starts at random ages
   * so they do not all appear and fade together.
   */
  private newSparkle(seeded = false): Sparkle {
    const depth = random(0.35, 1);
    const dot = Math.random() < DOT_SHARE;
    const color = Math.floor(Math.random() * SPARKLE_COLORS.length);
    const life = random(...SPARKLE_LIFE);
    const age = seeded ? random(0, life) : 0;
    return {
      x: Math.random(),
      y: Math.random(),
      size: (dot ? random(0.0024, 0.0048) : random(0.0054, 0.012)) * depth,
      reach: [random(0.012, 0.035), random(0.012, 0.035)],
      rate: [random(0.05, 0.12), random(0.05, 0.12)],
      phase: random(0, Math.PI * 2),
      angle: dot ? 0 : random(-0.25, 0.25),
      sprite: (dot ? this.dotSprites : this.sparkleSprites)[color],
      depth,
      age,
      life,
    };
  }

  private newStar(): Star {
    return {
      x: Math.random(),
      // Denser near the top, thinning toward the horizon.
      y: Math.random() ** 1.6 * SKY_DEPTH,
      size: random(1.6, 4.2),
      phase: random(0, Math.PI * 2),
      rate: random(0.6, 1.8),
    };
  }

  private drawSparkles(delta: number, weight: number, scroll: number) {
    const { context, width, height, time } = this;
    const short = Math.min(width, height);
    for (const [index, current] of this.sparkles.entries()) {
      let sparkle = current;
      sparkle.age += delta;
      if (sparkle.age >= sparkle.life) {
        sparkle = this.sparkles[index] = this.newSparkle();
      }
      // Home: a slow wander, shifted by scroll for depth, wrapping vertically.
      const parallax = scroll * 0.12 * sparkle.depth;
      const fx =
        sparkle.x +
        Math.sin(time * sparkle.rate[0] + sparkle.phase) * sparkle.reach[0];
      const fy =
        ((((sparkle.y +
          Math.cos(time * sparkle.rate[1] + sparkle.phase * 1.3) *
            sparkle.reach[1] -
          parallax) %
          1.16) +
          1.16) %
          1.16) -
        0.08;
      const homeX = fx * width;
      const homeY = fy * height;
      const twinkle = 0.55 + 0.45 * Math.sin(time * 1.7 + sparkle.phase);
      // Pop in with a little overshoot, shrink and fade at the end.
      const birth = Math.min(1, sparkle.age / SPARKLE_BIRTH_SEC);
      const death = Math.min(
        1,
        (sparkle.life - sparkle.age) / SPARKLE_DEATH_SEC,
      );
      const pop = birth < 1 ? easeOutBack(birth) : 1;
      const life = Math.min(birth, death);
      const size =
        sparkle.size *
        short *
        pop *
        (0.55 + 0.45 * death) *
        (0.8 + 0.25 * twinkle) *
        2;
      const alpha = weight * life * (0.5 + 0.5 * twinkle) * sparkle.depth;
      const turn =
        sparkle.angle +
        Math.sin(time * 0.8 + sparkle.phase) * 0.12 +
        (1 - pop) * 0.8;
      context.globalAlpha = alpha;
      context.save();
      context.translate(homeX, homeY);
      context.rotate(turn);
      context.drawImage(sparkle.sprite, -size / 2, -size / 2, size, size);
      context.restore();
    }
    context.globalAlpha = 1;
  }

  private drawStars(weight: number) {
    const { context, width, height, time } = this;
    for (const star of this.stars) {
      const twinkle = 0.5 + 0.5 * Math.sin(time * star.rate + star.phase);
      const size = star.size * (0.7 + 0.5 * twinkle) * 2;
      context.globalAlpha = weight * (0.25 + 0.75 * twinkle);
      context.drawImage(
        this.star,
        star.x * width - size / 2,
        star.y * height - size / 2,
        size,
        size,
      );
    }
    context.globalAlpha = 1;
  }

  private drawShootingStars(delta: number, weight: number) {
    const { context, width, height } = this;
    this.nextShot -= delta;
    if (this.nextShot <= 0) {
      this.shooting.push(this.newShootingStar());
      this.nextShot = random(...SHOOTING_GAP);
    }
    this.shooting = this.shooting.filter((shot) => shot.age < shot.life);
    context.save();
    context.globalCompositeOperation = "lighter";
    context.lineCap = "round";
    for (const shot of this.shooting) {
      shot.age += delta;
      shot.x += shot.dx * shot.speed * delta;
      shot.y += ((shot.dy * shot.speed * width) / height) * delta;
      const t = shot.age / shot.life;
      // Quick to appear, slow to fade, and the tail grows as it speeds up.
      const fade = Math.min(1, t / 0.12) * Math.min(1, (1 - t) / 0.45);
      const alpha = weight * Math.max(0, fade);
      const length = shot.tail * width * Math.min(1, 0.35 + t * 1.6);
      const headX = shot.x * width;
      const headY = shot.y * height;
      const tailX = headX - shot.dx * length;
      const tailY = headY - shot.dy * length;
      // A wide, faint glow under a thin bright core, both fading to the tail.
      for (const [width, strength] of [
        [7, 0.22],
        [2.2, 1],
      ] as const) {
        const tail = context.createLinearGradient(headX, headY, tailX, tailY);
        tail.addColorStop(0, `rgb(255 255 255 / ${alpha * strength})`);
        tail.addColorStop(0.3, `rgb(226 214 255 / ${alpha * strength * 0.6})`);
        tail.addColorStop(1, "rgb(255 190 215 / 0)");
        context.strokeStyle = tail;
        context.lineWidth = width;
        context.beginPath();
        context.moveTo(headX, headY);
        context.lineTo(tailX, tailY);
        context.stroke();
      }
      const glow = 26;
      context.globalAlpha = alpha;
      context.drawImage(
        this.star,
        headX - glow / 2,
        headY - glow / 2,
        glow,
        glow,
      );
      context.globalAlpha = 1;
    }
    context.restore();
  }

  /** A star that crosses the upper sky, down and to one side. */
  private newShootingStar(): ShootingStar {
    const leftward = Math.random() < 0.5;
    const angle = random(0.32, 0.55); // radians below the horizontal
    return {
      x: leftward ? random(0.35, 0.95) : random(0.05, 0.65),
      y: random(0.02, 0.32),
      dx: (leftward ? -1 : 1) * Math.cos(angle),
      dy: Math.sin(angle),
      speed: random(0.45, 0.7),
      tail: random(0.14, 0.24),
      age: 0,
      life: random(0.75, 1.15),
    };
  }
}

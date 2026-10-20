import { SPARKLE_COLORS, dotSprite, sparkleSprite } from "./ambient";

/*
 * A sparkle trail behind the mouse cursor: as the pointer moves, small
 * pastel sparkles and dots are shed along its path. Each pops in, drifts
 * and settles a little, spins, then shrinks away within a second. Drawn on
 * its own canvas above the whole page (it never takes pointer events), and
 * idle while nothing is left to draw. Off for touch and reduced motion.
 */

/** Pixels the cursor travels between shed particles, and a cap per move. */
const SPACING_PX = 16;
const MAX_PER_MOVE = 4;
/** Particle lifetime in seconds. */
const LIFE = [0.55, 0.95] as const;
/** Drawn size in pixels, for star sparkles and the smaller dots. */
const STAR_PX = [10, 18] as const;
const DOT_PX = [4, 7] as const;
const DOT_SHARE = 0.35;
/** Downward pull (px/s²) and how much of the cursor's speed a particle keeps. */
const GRAVITY = 70;
const INHERIT = 0.08;

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  angle: number;
  spin: number;
  age: number;
  life: number;
  sprite: HTMLCanvasElement;
};

const random = (min: number, max: number) => min + Math.random() * (max - min);

export class CursorTrail {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly still = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  private readonly stars = SPARKLE_COLORS.map(sparkleSprite);
  private readonly dots = SPARKLE_COLORS.map(dotSprite);
  private particles: Particle[] = [];
  private last: { x: number; y: number; t: number } | null = null;
  /** Distance moved since the last shed particle. */
  private travel = 0;
  private frameId = 0;
  private previous = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d")!;
    window.addEventListener("pointermove", this.onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", () => {
      this.last = null;
    });
  }

  private onMove = (event: PointerEvent) => {
    if (event.pointerType !== "mouse" || this.still.matches) return;
    const now = performance.now();
    const { clientX: x, clientY: y } = event;
    const last = this.last;
    this.last = { x, y, t: now };
    if (!last) return;
    const dx = x - last.x;
    const dy = y - last.y;
    const distance = Math.hypot(dx, dy);
    const seconds = Math.max(0.008, (now - last.t) / 1000);
    this.travel += distance;
    let shed = 0;
    while (this.travel >= SPACING_PX && shed < MAX_PER_MOVE) {
      this.travel -= SPACING_PX;
      // Spread the batch back along the segment just travelled.
      const back = (shed * SPACING_PX) / Math.max(distance, 1);
      this.spawn(
        x - dx * back,
        y - dy * back,
        (dx / seconds) * INHERIT,
        (dy / seconds) * INHERIT,
      );
      shed += 1;
    }
    if (shed === MAX_PER_MOVE) this.travel = 0;
    this.wake();
  };

  private spawn(x: number, y: number, vx: number, vy: number) {
    const dot = Math.random() < DOT_SHARE;
    const color = Math.floor(Math.random() * SPARKLE_COLORS.length);
    this.particles.push({
      x: x + random(-4, 4),
      y: y + random(-4, 4),
      vx: vx + random(-28, 28),
      vy: vy + random(-36, 12),
      size: dot ? random(...DOT_PX) : random(...STAR_PX),
      angle: random(-0.4, 0.4),
      spin: random(-3, 3),
      age: 0,
      life: random(...LIFE),
      sprite: (dot ? this.dots : this.stars)[color],
    });
  }

  private wake() {
    if (this.frameId) return;
    this.previous = performance.now();
    this.frameId = requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    const delta = Math.min(0.05, (now - this.previous) / 1000);
    this.previous = now;
    const { canvas, context } = this;
    const ratio = Math.min(window.devicePixelRatio, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (canvas.width !== Math.round(width * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    this.particles = this.particles.filter((p) => p.age < p.life);
    for (const particle of this.particles) {
      particle.age += delta;
      particle.vy += GRAVITY * delta;
      particle.vx *= Math.exp(-2.5 * delta);
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
      particle.angle += particle.spin * delta;
      const t = particle.age / particle.life;
      // Quick pop, then shrink and fade over the rest of its life.
      const grow = Math.min(1, t / 0.15);
      const fade = 1 - Math.max(0, (t - 0.35) / 0.65);
      const size = particle.size * grow * (0.4 + 0.6 * fade);
      context.globalAlpha = fade;
      context.save();
      context.translate(particle.x, particle.y);
      context.rotate(particle.angle);
      context.drawImage(particle.sprite, -size / 2, -size / 2, size, size);
      context.restore();
    }
    context.globalAlpha = 1;
    this.frameId = this.particles.length
      ? requestAnimationFrame(this.frame)
      : 0;
  };
}

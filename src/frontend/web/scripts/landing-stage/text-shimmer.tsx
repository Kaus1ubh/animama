import React, { useMemo, type JSX } from "react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

/*
 * Text Shimmer from Motion Primitives (MIT,
 * https://motion-primitives.com/docs/text-shimmer), adapted for the landing
 * page:
 * - children may contain elements (a title's bouncing letters); `text`
 *   sizes the band;
 * - colours default to the theme's muted and foreground text, so light and
 *   dark mode need no extra classes; `style` may set `--base-color` and
 *   `--base-gradient-color` to a value computed at runtime;
 * - the text is clipped to the moving band only while `play` is on, and is
 *   plain `--base-color` text otherwise, so a bounce never runs under the
 *   clip (moving text inside clipped text is not drawn);
 * - it can sweep a set number of times after a delay, then calls
 *   `onComplete`; turning `play` off and on again starts afresh;
 * - the motion element is created once per tag, so a re-render never
 *   remounts the text under the pointer;
 * - it holds still for visitors who prefer reduced motion.
 */

export type TextShimmerProps = {
  children: React.ReactNode;
  /** The plain text, when `children` is not a string; sizes the band. */
  text?: string;
  as?: React.ElementType;
  className?: string;
  /** Extra inline styles, including the colour variables. */
  style?: Record<string, string>;
  /** Seconds per sweep. */
  duration?: number;
  /** Band width, in pixels per character of text either side of its centre. */
  spread?: number;
  /** Whether to sweep; plain text until then. */
  play?: boolean;
  /** Seconds before the first sweep. */
  delay?: number;
  /** Sweeps after the first (Infinity keeps sweeping), and the pause between. */
  repeat?: number;
  repeatDelay?: number;
  /** Called once a finite run of sweeps has finished. */
  onComplete?: () => void;
};

/** The band and the text clipped to it, while a sweep plays. */
const SWEEP_CLASSES = cn(
  "bg-[length:250%_100%,auto] bg-clip-text text-transparent",
  "[background-repeat:no-repeat,padding-box] [--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--base-gradient-color),#0000_calc(50%+var(--spread)))]",
);

function TextShimmerComponent({
  children,
  text,
  as: Component = "p",
  className,
  duration = 2,
  spread = 2,
  play = true,
  delay = 0,
  repeat = Infinity,
  repeatDelay = 0,
  style,
  onComplete,
}: TextShimmerProps) {
  const MotionComponent = useMemo(
    () => motion.create(Component as keyof JSX.IntrinsicElements),
    [Component],
  );
  const still = useReducedMotion();
  const sweeping = play && !still;
  const length =
    text?.length ?? (typeof children === "string" ? children.length : 0);
  const dynamicSpread = useMemo(() => length * spread, [length, spread]);

  return (
    <MotionComponent
      className={cn(
        "relative inline-block [--base-color:var(--muted-foreground)] [--base-gradient-color:var(--foreground)]",
        sweeping ? SWEEP_CLASSES : "[color:var(--base-color)]",
        className,
      )}
      initial={{ backgroundPosition: "100% center" }}
      // Out of play the band jumps back to its start, so the next play
      // begins a fresh sweep.
      animate={{ backgroundPosition: sweeping ? "0% center" : "100% center" }}
      transition={
        sweeping
          ? { repeat, repeatDelay, delay, duration, ease: "linear" }
          : { duration: 0 }
      }
      onAnimationComplete={sweeping ? onComplete : undefined}
      style={
        {
          ...style,
          "--spread": `${dynamicSpread}px`,
          ...(sweeping
            ? {
                backgroundImage: `var(--bg), linear-gradient(var(--base-color), var(--base-color))`,
              }
            : {}),
        } as React.CSSProperties
      }
    >
      {children}
    </MotionComponent>
  );
}

export const TextShimmer = React.memo(TextShimmerComponent);

import { Sparkles } from "lucide-react";

import type { AnimaRosterLayout } from "@/lib/animas/anima-roster-layout";

export type AnimaShowcaseCamera = {
  position: [number, number, number];
  fov: number;
};

/**
 * Breakpoint-specific framing. Lower a preset's Z value to move closer to the
 * avatar and raise it to pull back while preserving the perspective.
 */
export const ANIMA_SHOWCASE_CAMERAS: Record<
  AnimaRosterLayout,
  AnimaShowcaseCamera
> = {
  phone: { position: [0, 0.85, 6.3], fov: 28 },
  tablet: { position: [0, 0.85, 5], fov: 28 },
  desktop: { position: [0, 0.85, 4.5], fov: 28 },
};

export const ANIMA_SHOWCASE_ORBIT_TARGET: [number, number, number] = [
  0, 0.65, 0,
];

export function AnimaPageBackdrop() {
  return <div className="bg-background absolute inset-0" />;
}

export function AnimaStageEffects() {
  return (
    <>
      <div className="absolute top-[-13%] left-1/2 aspect-square w-[78vmin] max-w-[54rem] -translate-x-1/2 rounded-full border border-amber-200/45 shadow-[0_0_90px_rgba(217,180,112,0.13)] dark:border-amber-200/15" />
      <div className="absolute top-[-5%] left-1/2 aspect-square w-[66vmin] max-w-[46rem] -translate-x-1/2 rounded-full border border-amber-200/40 dark:border-amber-100/10" />
      <div className="absolute top-[7%] left-1/2 aspect-square w-[48vmin] max-w-[34rem] -translate-x-1/2 rounded-full border border-amber-200/30 dark:border-amber-100/10" />

      <Sparkles
        aria-hidden="true"
        className="absolute top-[12%] left-[24%] size-9 text-amber-200/65 dark:text-amber-200/25"
        strokeWidth={1.2}
      />
      <Sparkles
        aria-hidden="true"
        className="absolute top-[20%] right-[21%] size-6 text-amber-200/65 dark:text-amber-200/25"
        strokeWidth={1.25}
      />
      <Sparkles
        aria-hidden="true"
        className="absolute top-[35%] left-[18%] size-5 text-amber-200/55 dark:text-amber-200/20"
        strokeWidth={1.25}
      />
      <Sparkles
        aria-hidden="true"
        className="absolute top-[42%] right-[17%] size-10 text-amber-200/55 dark:text-amber-200/20"
        strokeWidth={1}
      />

      <div className="absolute right-[30%] bottom-[37%] size-2 rounded-full bg-amber-200/55 shadow-[0_0_18px_rgba(217,180,112,0.4)]" />
      <div className="absolute bottom-[44%] left-[31%] size-1.5 rounded-full bg-amber-100/80 shadow-[0_0_14px_rgba(217,180,112,0.36)]" />

      <div className="absolute bottom-[5.5rem] left-1/2 h-52 w-[96%] -translate-x-1/2 rounded-[50%] border border-amber-100/65 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.94)_0%,rgba(247,237,217,0.5)_45%,transparent_72%)] shadow-[inset_0_18px_45px_rgba(255,255,255,0.68)] dark:border-amber-100/10 dark:bg-[radial-gradient(ellipse_at_center,rgba(102,84,54,0.3)_0%,rgba(31,27,21,0.12)_55%,transparent_75%)]" />
      <div className="absolute bottom-[7.25rem] left-1/2 h-28 w-[78%] -translate-x-1/2 rounded-[50%] border border-amber-200/45 dark:border-amber-100/10" />
      <div className="absolute bottom-[9.2rem] left-1/2 h-12 w-[44%] -translate-x-1/2 rounded-[50%] bg-black/9 blur-xl dark:bg-black/35" />
    </>
  );
}

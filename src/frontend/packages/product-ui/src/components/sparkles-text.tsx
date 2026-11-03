// Adapted from Magic UI (MIT): apps/www/registry/magicui/sparkles-text.tsx.
// See licenses/third-party/adapted-code.md.
import type { JSX, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";

import { cn } from "../lib/utils";

interface SparkleRect {
  height: number;
  left: number;
  top: number;
  width: number;
}

interface Sparkle {
  id: string;
  x: number;
  y: number;
  color: string;
  delay: number;
  scale: number;
  duration: number;
}

interface SparkleLayout {
  height: number;
  rects: SparkleRect[];
  width: number;
}

type SparklesTextProps = {
  as?: keyof JSX.IntrinsicElements;
  className?: string;
  children: ReactNode;
  sparklesCount?: number;
  sparkleSize?: number;
  colors?: {
    first: string;
    second: string;
  };
  duration?: number;
  onAnimationComplete?: () => void;
};

const Sparkle = ({
  color,
  delay,
  duration,
  id,
  onAnimationComplete,
  scale,
  size,
  x,
  y,
}: Sparkle & { onAnimationComplete?: () => void; size: number }) => (
  <motion.svg
    animate={{
      opacity: [0, 1, 0],
      rotate: [75, 120, 150],
      scale: [0, scale, 0],
    }}
    className="pointer-events-none absolute z-20"
    initial={{ left: x, opacity: 0, top: y }}
    key={id}
    onAnimationComplete={onAnimationComplete}
    transition={{ delay, duration, ease: "easeOut" }}
    viewBox="0 0 21 21"
    width={size}
    height={size}
  >
    <path
      d="M9.82531 0.843845C10.0553 0.215178 10.9446 0.215178 11.1746 0.843845L11.8618 2.72026C12.4006 4.19229 12.3916 6.39157 13.5 7.5C14.6084 8.60843 16.8077 8.59935 18.2797 9.13822L20.1561 9.82534C20.7858 10.0553 20.7858 10.9447 20.1561 11.1747L18.2797 11.8618C16.8077 12.4007 14.6084 12.3916 13.5 13.5C12.3916 14.6084 12.4006 16.8077 11.8618 18.2798L11.1746 20.1562C10.9446 20.7858 10.0553 20.7858 9.82531 20.1562L9.13819 18.2798C8.59932 16.8077 8.60843 14.6084 7.5 13.5C6.39157 12.3916 4.19225 12.4007 2.72023 11.8618L0.843814 11.1747C0.215148 10.9447 0.215148 10.0553 0.843814 9.82534L2.72023 9.13822C4.19225 8.59935 6.39157 8.60843 7.5 7.5C8.60843 6.39157 8.59932 4.19229 9.13819 2.72026L9.82531 0.843845Z"
      fill={color}
    />
  </motion.svg>
);

const defaultColors = {
  first: "var(--color-primary)",
  second: "var(--color-foreground)",
};

const defaultSparkleSize = 14;

const layoutsEqual = (current: SparkleLayout | null, next: SparkleLayout) => {
  if (!current) return false;
  if (current.width !== next.width || current.height !== next.height) {
    return false;
  }
  if (current.rects.length !== next.rects.length) return false;
  return current.rects.every((rect, index) => {
    const nextRect = next.rects[index];
    return (
      rect.left === nextRect?.left &&
      rect.top === nextRect?.top &&
      rect.width === nextRect?.width &&
      rect.height === nextRect?.height
    );
  });
};

const measureLayout = (node: HTMLSpanElement): SparkleLayout => {
  const bounds = node.getBoundingClientRect();
  const rects = Array.from(node.getClientRects())
    .map((rect) => ({
      height: Math.max(rect.height, 1),
      left: rect.left - bounds.left,
      top: rect.top - bounds.top,
      width: Math.max(rect.width, 1),
    }))
    .filter((rect) => rect.width > 0 && rect.height > 0);

  return {
    height: Math.max(bounds.height, 1),
    rects,
    width: Math.max(bounds.width, 1),
  };
};

const randomBetween = (min: number, max: number) => {
  if (max <= min) return min;
  return min + Math.random() * (max - min);
};

const createSparkles = (
  sparklesCount: number,
  colors: typeof defaultColors,
  duration: number,
  layout: SparkleLayout | null,
  sparkleSize: number,
): Sparkle[] => {
  if (!layout || layout.rects.length === 0) return [];

  const sparkleDuration = Math.min(duration * 0.75, 0.7);
  const maxDelay = Math.max(duration * 0.1, 0);
  const sparkleRadius = sparkleSize / 2;

  return Array.from({ length: sparklesCount }, (_, index) => {
    const rect =
      layout.rects[Math.floor(Math.random() * layout.rects.length)] ??
      layout.rects[0];
    const horizontalInset = Math.min(
      Math.max(rect.width * 0.15, sparkleRadius * 0.35),
      rect.width / 3,
    );
    const verticalInset = Math.min(
      Math.max(rect.height * 0.18, sparkleRadius * 0.2),
      rect.height / 3,
    );
    const xMin = rect.left + horizontalInset;
    const xMax = rect.left + rect.width - horizontalInset;
    const middleBandHeight = Math.max(rect.height * 0.35, 1);
    const lineCenterY = rect.top + rect.height / 2;
    const yMin = Math.max(
      rect.top + verticalInset,
      lineCenterY - middleBandHeight / 2,
    );
    const yMax = Math.min(
      rect.top + rect.height - verticalInset,
      lineCenterY + middleBandHeight / 2,
    );
    const centerX = randomBetween(xMin, xMax);
    const centerY = randomBetween(yMin, yMax);
    const x = centerX - sparkleRadius;
    const y = centerY - sparkleRadius;
    const color = Math.random() > 0.5 ? colors.first : colors.second;
    const delay = index === 0 ? 0 : Math.random() * maxDelay;
    const scale = 0.4 + Math.random() * 0.8;

    return {
      color,
      delay,
      duration: sparkleDuration,
      id: `sparkle-${index}-${x}-${y}`,
      scale,
      x,
      y,
    };
  });
};

export const SparklesText = ({
  as = "div",
  children,
  className,
  colors = defaultColors,
  duration = 1,
  onAnimationComplete,
  sparklesCount = 6,
  sparkleSize = defaultSparkleSize,
}: SparklesTextProps) => {
  const MotionTag = motion[as as keyof typeof motion] as typeof motion.div;
  const contentRef = useRef<HTMLSpanElement | null>(null);
  const [layout, setLayout] = useState<SparkleLayout | null>(null);
  const updateLayout = useCallback((node: HTMLSpanElement | null) => {
    if (!node) return;
    const nextLayout = measureLayout(node);
    setLayout((current) =>
      layoutsEqual(current, nextLayout) ? current : nextLayout,
    );
  }, []);
  const handleContentRef = useCallback(
    (node: HTMLSpanElement | null) => {
      contentRef.current = node;
      updateLayout(node);
    },
    [updateLayout],
  );

  useEffect(() => {
    const node = contentRef.current;
    if (!node) return;
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      updateLayout(node);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [updateLayout]);

  const sparkles = useMemo(
    () => createSparkles(sparklesCount, colors, duration, layout, sparkleSize),
    [colors, duration, layout, sparkleSize, sparklesCount],
  );
  const finalSparkleId = useMemo(() => {
    if (sparkles.length === 0) return null;

    return sparkles.reduce((latest, sparkle) => {
      const latestEndTime = latest.delay + latest.duration;
      const sparkleEndTime = sparkle.delay + sparkle.duration;
      return sparkleEndTime >= latestEndTime ? sparkle : latest;
    }).id;
  }, [sparkles]);

  return (
    <MotionTag className={cn("relative isolate", className)}>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-visible"
      >
        {sparkles.map((sparkle) => (
          <Sparkle
            key={sparkle.id}
            onAnimationComplete={
              sparkle.id === finalSparkleId ? onAnimationComplete : undefined
            }
            size={sparkleSize}
            {...sparkle}
          />
        ))}
      </span>
      <span className="relative z-10" ref={handleContentRef}>
        {children}
      </span>
    </MotionTag>
  );
};

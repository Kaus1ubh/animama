import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "../lib/utils";
import { SparklesText } from "./sparkles-text";
import { TextEffect } from "./text-effect";

type ResponseProps = {
  children: string;
  className?: string;
};
type StreamingResponseProps = {
  segments: string[];
  className?: string;
  completionPending?: boolean;
  onQueueComplete?: () => void;
};

const responseClassName = "size-full break-words whitespace-pre-wrap";
const segmentSparklesDurationSeconds = 4;
const segmentSparklesColors = {
  first: "#fff8db",
  second: "#fff8db",
  // second: "#facc15",
};

const isSparkleEligible = (segment: string) => /\S/.test(segment);

export const Response = memo(
  ({ children, className }: ResponseProps) => (
    <div className={cn(responseClassName, className)}>{children}</div>
  ),
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    prevProps.className === nextProps.className,
);

Response.displayName = "Response";

export const StreamingResponse = memo(
  ({
    segments,
    className,
    completionPending = false,
    onQueueComplete,
  }: StreamingResponseProps) => {
    const [completedCount, setCompletedCount] = useState(0);
    const [sparkledIndexes, setSparkledIndexes] = useState<number[]>([]);
    const effectiveCompletedCount = Math.min(completedCount, segments.length);
    const activeIndex =
      effectiveCompletedCount < segments.length
        ? effectiveCompletedCount
        : null;
    const reportedCompleteRef = useRef(false);
    const finalSparkleIndex = useMemo(() => {
      for (let index = segments.length - 1; index >= 0; index -= 1) {
        if (isSparkleEligible(segments[index] ?? "")) return index;
      }
      return null;
    }, [segments]);

    useEffect(() => {
      if (!completionPending || effectiveCompletedCount < segments.length) {
        reportedCompleteRef.current = false;
      }
    }, [completionPending, effectiveCompletedCount, segments.length]);

    useEffect(() => {
      if (!completionPending || effectiveCompletedCount < segments.length) {
        return;
      }
      if (reportedCompleteRef.current) return;
      if (
        finalSparkleIndex === null ||
        sparkledIndexes.includes(finalSparkleIndex)
      ) {
        reportedCompleteRef.current = true;
        onQueueComplete?.();
      }
    }, [
      completionPending,
      effectiveCompletedCount,
      finalSparkleIndex,
      onQueueComplete,
      segments.length,
      sparkledIndexes,
    ]);

    const handleAnimationComplete = useCallback(() => {
      setCompletedCount((prev) => {
        if (activeIndex === null) return prev;
        return Math.max(prev, activeIndex + 1);
      });
    }, [activeIndex]);
    const handleSegmentSparklesComplete = useCallback((index: number) => {
      setSparkledIndexes((prev) => {
        if (prev.includes(index)) return prev;
        return prev.concat(index);
      });
    }, []);

    const settledSegments = segments.slice(
      0,
      activeIndex ?? effectiveCompletedCount,
    );
    const activeSegment =
      activeIndex !== null ? (segments[activeIndex] ?? null) : null;

    return (
      <div className={cn(responseClassName, className)}>
        {settledSegments.map((segment, index) =>
          isSparkleEligible(segment) ? (
            <SparklesText
              as="span"
              className="whitespace-pre-wrap"
              colors={segmentSparklesColors}
              duration={segmentSparklesDurationSeconds}
              key={`settled-${index}`}
              onAnimationComplete={() => handleSegmentSparklesComplete(index)}
              sparkleSize={9}
              sparklesCount={5}
            >
              {segment}
            </SparklesText>
          ) : (
            <span className="whitespace-pre-wrap" key={`settled-${index}`}>
              {segment}
            </span>
          ),
        )}
        {activeSegment ? (
          <TextEffect
            as="span"
            className="inline"
            key={`segment-${activeIndex}`}
            onAnimationComplete={handleAnimationComplete}
            per="char"
            preset="fade"
            speedReveal={4}
            speedSegment={4}
          >
            {activeSegment}
          </TextEffect>
        ) : null}
      </div>
    );
  },
  (prevProps, nextProps) =>
    prevProps.segments === nextProps.segments &&
    prevProps.className === nextProps.className &&
    prevProps.completionPending === nextProps.completionPending &&
    prevProps.onQueueComplete === nextProps.onQueueComplete,
);

StreamingResponse.displayName = "StreamingResponse";

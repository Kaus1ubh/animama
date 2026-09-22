"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  contentPreviewPreparationError,
  prepareContentPreview,
  resolveContentPreviewEntry,
  type PreparedContentPreview,
} from "@/lib/content-preview/preparation";
import { resolvePosePreviewTarget } from "@/lib/content-preview/posePreviewTarget";
import type { ContentPreviewTarget } from "@/lib/content-preview/types";
import {
  logContentPreviewLifecycle,
  type ContentPreviewRendererOwner,
} from "@/lib/content-preview/lifecycle";

/** Resolve an exact preview target while leaving renderer ownership to callers. */
export function usePreparedContentPreview(
  target: ContentPreviewTarget | null,
  options?: { enabled?: boolean; owner?: ContentPreviewRendererOwner },
): {
  prepared: PreparedContentPreview | null;
  isPending: boolean;
  error: string | null;
  retry: () => Promise<void>;
} {
  const enabled = options?.enabled ?? true;
  const owner = options?.owner ?? "dock";
  const lastResolutionRef = useRef<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [resolvedPose, setResolvedPose] = useState<{
    target: ContentPreviewTarget;
    attempt: number;
    prepared: PreparedContentPreview | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    if (!target || !enabled || target.sourceType !== "pose_content") return;
    const controller = new AbortController();
    void resolvePosePreviewTarget(target, controller.signal)
      .then((resolved) => prepareContentPreview(resolved, resolved.entry))
      .then(
        (prepared) => {
          if (controller.signal.aborted) return;
          setResolvedPose({ target, attempt, prepared, error: null });
        },
        (error: unknown) => {
          if (controller.signal.aborted) return;
          setResolvedPose({
            target,
            attempt,
            prepared: null,
            error: contentPreviewPreparationError(error),
          });
        },
      );
    // Closing, replacing, or handing off the dock makes every pending result obsolete.
    return () => controller.abort();
  }, [attempt, enabled, target]);
  const result = useMemo(() => {
    if (!target || !enabled) {
      return { prepared: null, error: null };
    }
    if (target.sourceType === "pose_content") {
      return resolvedPose?.target === target && resolvedPose.attempt === attempt
        ? resolvedPose
        : { prepared: null, error: null };
    }
    try {
      const entry = resolveContentPreviewEntry(target, null);
      const prepared = entry ? prepareContentPreview(target, entry) : null;
      return {
        prepared: prepared
          ? {
              ...prepared,
              entryKey: `${prepared.entryKey}:attempt:${attempt}`,
            }
          : null,
        error: null,
      };
    } catch (error) {
      return {
        prepared: null,
        error: contentPreviewPreparationError(error),
      };
    }
  }, [attempt, enabled, target, resolvedPose]);
  const retry = useCallback(async () => {
    setAttempt((current) => current + 1);
  }, []);
  const isPending = Boolean(
    target &&
    enabled &&
    target.sourceType === "pose_content" &&
    !result.prepared &&
    !result.error,
  );

  useEffect(() => {
    if (!target || !enabled) return;
    const outcome = result.prepared
      ? "source_resolve_success"
      : result.error
        ? "source_resolve_failure"
        : null;
    if (!outcome) return;
    const resolutionKey = `${target.key}:${outcome}:${attempt}`;
    if (lastResolutionRef.current === resolutionKey) return;
    lastResolutionRef.current = resolutionKey;
    logContentPreviewLifecycle(outcome, owner, {
      kind: target.kind,
      slot: target.slot,
      sourceType: target.sourceType,
    });
  }, [attempt, enabled, owner, result.error, result.prepared, target]);

  return {
    prepared: result.prepared,
    isPending,
    error: result.error,
    retry,
  };
}

import { useBlocker } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { getI18n } from "react-i18next";
import { toast } from "sonner";

import { failureLine } from "@/lib/errors/apiError";

/** The parts of a router location the leave guard compares. */
export type CreatorLeaveLocation = {
  pathname: string;
  search?: unknown;
};

/**
 * Block leaving a dirty or saving creator. Navigation within the same route is
 * allowed, except on a `/new` route whose search parameters select what the
 * new draft starts from (for example `?template=`): a different value there
 * replaces the draft, so it is guarded like leaving.
 */
export function shouldBlockCreatorNavigation(args: {
  dirty: boolean;
  busy: boolean;
  current: CreatorLeaveLocation;
  next: CreatorLeaveLocation;
}): boolean {
  if (!args.dirty && !args.busy) return false;
  if (args.current.pathname !== args.next.pathname) return true;
  return (
    isNewCreatorRoute(args.current.pathname) &&
    searchKey(args.current.search) !== searchKey(args.next.search)
  );
}

function isNewCreatorRoute(pathname: string): boolean {
  return /\/new\/?$/.test(pathname);
}

/** Order-independent comparison key for parsed search parameters. */
function searchKey(search: unknown): string {
  if (!search || typeof search !== "object") return "";
  const entries = Object.entries(search as Record<string, unknown>)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(entries);
}

/**
 * Why a creator draft could not be discarded: the failure's own text in
 * English (browser storage failures are already worded), otherwise a
 * translated message with that text as detail.
 */
export function creatorDiscardFailureText(error: unknown): string {
  const t = getI18n().getFixedT(null, "creator");
  return failureLine(error, t("leave.discardFailed"));
}

export type CreatorLeaveGuard = {
  /** A navigation is waiting for the user's choice. */
  blocked: boolean;
  discarding: boolean;
  busy: boolean;
  stay: () => void;
  /** Discard the draft, then continue; while saving, continue and keep recovery. */
  leave: () => Promise<void>;
};

/**
 * Router and unload guard for an effect creator. Leaving discards the draft
 * and its browser recovery through `discard`; if that fails, the user stays
 * and sees why.
 */
export function useCreatorLeaveGuard({
  dirty,
  busy,
  discard,
}: {
  dirty: boolean;
  busy: boolean;
  /** Resolve false to stay; reject to stay with an error message. */
  discard: () => Promise<boolean>;
}): CreatorLeaveGuard {
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) =>
      shouldBlockCreatorNavigation({ dirty, busy, current, next }),
    enableBeforeUnload: () => dirty || busy,
    withResolver: true,
  });
  const [discarding, setDiscarding] = useState(false);
  const { proceed, reset } = blocker;

  const leave = useCallback(async () => {
    if (discarding) return;
    // Leaving during Save pauses it; recovery keeps the draft for Retry.
    if (busy) {
      proceed?.();
      return;
    }
    setDiscarding(true);
    try {
      if (await discard()) proceed?.();
    } catch (error) {
      toast.error(creatorDiscardFailureText(error));
    } finally {
      setDiscarding(false);
    }
  }, [busy, discard, discarding, proceed]);

  const stay = useCallback(() => reset?.(), [reset]);

  return {
    blocked: blocker.status === "blocked",
    discarding,
    busy,
    stay,
    leave,
  };
}

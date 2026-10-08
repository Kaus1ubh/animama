"use client";

import {
  type RefObject,
  useCallback,
  useEffect,
  useEffectEvent,
  useState,
} from "react";
import { toast } from "sonner";

/**
 * Browser recovery key for a new draft started from a template. A plain `/new`
 * draft keeps the key `new`, so starting from a template never replaces it,
 * and each template's draft is restored only on its own `?template=` route.
 */
export function creatorTemplateRecoveryKey(templateId: string): string {
  return `new:template:${templateId}`;
}

/**
 * Dirty baseline of a draft started from a template. No document fingerprint
 * equals it, so the draft shows Unsaved until its first Save, even unedited.
 */
export const CREATOR_TEMPLATE_DRAFT_BASELINE = "__template_draft__";

/** The creator's load state, as the template start reports it. */
export type CreatorTemplateHydration = {
  state: "ready" | "error";
  message: string | null;
};

type SeedState<TSnapshot> =
  | { status: "loading" }
  | { status: "ready"; snapshot: TSnapshot }
  | { status: "error"; message: string };

export type CreatorTemplateStartStatus =
  /** The route has no template. */
  | "inactive"
  | "loading"
  /** An unsaved draft for this template exists; the user chooses. */
  | "choosing"
  | "ready"
  | "error";

/**
 * Seed a `/new` creator from `?template=` as a new, unsaved Local draft.
 *
 * The creator's `useCreatorSave` keeps restoring recovery itself; on a template
 * route its `onRestore` hands the record here as `recoveredDraft` instead of
 * installing it. Once recovery and the template are both loaded:
 *
 * - no draft: the template is installed;
 * - a draft identical to the template: it is installed silently, keeping its
 *   Save operation;
 * - a different draft: the user chooses to continue it or to discard it and
 *   start from the template (`resetSession`).
 *
 * Starting installs the document (`install`), marks it unsaved
 * (`baselineRef`) and reports the creator ready (`setHydration`); a template
 * that cannot be loaded, with no draft to continue, reports an error.
 */
export function useCreatorTemplateStart<TSnapshot>({
  templateId,
  loadSeed,
  fingerprint,
  recoveryReady,
  recoveredDraft,
  resetSession,
  install,
  baselineRef,
  setHydration,
}: {
  templateId: string | undefined;
  /** Build the template's starting document. A new identity does not restart a load. */
  loadSeed: (templateId: string, signal: AbortSignal) => Promise<TSnapshot>;
  fingerprint: (snapshot: TSnapshot) => string;
  recoveryReady: boolean;
  recoveredDraft: TSnapshot | null;
  /** `useCreatorSave().resetSession`: discard the draft and its recovery. */
  resetSession: (next: TSnapshot) => Promise<boolean>;
  /** Put the starting document into the editor (a stable callback). */
  install: (snapshot: TSnapshot) => void;
  /** The creator's clean-document fingerprint; set to the template baseline. */
  baselineRef: RefObject<string>;
  /** The creator's hydration setter (a state setter). */
  setHydration: (hydration: CreatorTemplateHydration) => void;
}) {
  const onStart = useCallback(
    (snapshot: TSnapshot, source: "template" | "draft") => {
      install(snapshot);
      baselineRef.current = CREATOR_TEMPLATE_DRAFT_BASELINE;
      setHydration({
        state: "ready",
        message: source === "draft" ? "Recovered local draft" : null,
      });
    },
    [baselineRef, install, setHydration],
  );
  const [seed, setSeed] = useState<SeedState<TSnapshot>>({
    status: "loading",
  });
  const [decision, setDecision] = useState<"pending" | "choosing" | "done">(
    "pending",
  );
  const [starting, setStarting] = useState(false);

  // Read the latest loader without restarting the load when its identity changes.
  const loadTemplateSeed = useEffectEvent((id: string, signal: AbortSignal) =>
    loadSeed(id, signal),
  );

  useEffect(() => {
    if (!templateId) return;
    const controller = new AbortController();
    void loadTemplateSeed(templateId, controller.signal).then(
      (snapshot) => {
        if (!controller.signal.aborted) setSeed({ status: "ready", snapshot });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setSeed({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "The template could not be opened.",
        });
      },
    );
    return () => controller.abort();
  }, [templateId]);

  useEffect(() => {
    if (!templateId || decision !== "pending" || !recoveryReady) return;
    if (seed.status === "loading") return;
    if (recoveredDraft) {
      if (
        seed.status === "ready" &&
        fingerprint(recoveredDraft) === fingerprint(seed.snapshot)
      ) {
        onStart(recoveredDraft, "draft");
        setDecision("done");
      } else {
        setDecision("choosing");
      }
      return;
    }
    if (seed.status === "ready") {
      onStart(seed.snapshot, "template");
      setDecision("done");
    } else {
      setHydration({ state: "error", message: seed.message });
      setDecision("done");
    }
  }, [
    decision,
    fingerprint,
    onStart,
    recoveredDraft,
    recoveryReady,
    seed,
    setHydration,
    templateId,
  ]);

  /** Keep the unsaved draft (and its recovery) instead of the template. */
  const continueDraft = useCallback(() => {
    if (decision !== "choosing" || !recoveredDraft) return;
    onStart(recoveredDraft, "draft");
    setDecision("done");
  }, [decision, onStart, recoveredDraft]);

  /** Discard the unsaved draft and its recovery, then install the template. */
  const startFromTemplate = useCallback(async () => {
    if (decision !== "choosing" || seed.status !== "ready" || starting) return;
    setStarting(true);
    try {
      if (!(await resetSession(seed.snapshot))) return;
      onStart(seed.snapshot, "template");
      setDecision("done");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The draft could not be discarded.",
      );
    } finally {
      setStarting(false);
    }
  }, [decision, onStart, resetSession, seed, starting]);

  const status: CreatorTemplateStartStatus = !templateId
    ? "inactive"
    : decision === "choosing"
      ? "choosing"
      : decision === "done"
        ? seed.status === "error" && !recoveredDraft
          ? "error"
          : "ready"
        : "loading";

  return {
    status,
    /** Why the template could not be loaded, if it failed. */
    seedError: seed.status === "error" ? seed.message : null,
    starting,
    continueDraft,
    startFromTemplate,
  };
}

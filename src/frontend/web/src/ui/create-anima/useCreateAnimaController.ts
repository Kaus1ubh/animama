import { useCallback, useEffect, useRef, useState } from "react";
import { getI18n, useTranslation } from "react-i18next";

import type {
  AnimaCreationDiagnostic,
  AnimaCreationOptions,
  AnimaSpecInput,
  ItemRevisionRef,
  PyTypedContentPreview,
} from "@animama/runtime-contracts/sdk";
import {
  AnimaCreationApiError,
  creationEvidence,
  useAnimaCreationOperations,
  useAnimaCreationSources,
} from "@/query/hooks/useAnimaCreation";
import { apiErrorLine, type ApiErrorText } from "@/lib/errors/apiError";
import { creationFailureText } from "@/lib/errors/creationErrors";
import { itemReference } from "./createAnimaContent";
import {
  canonicalJson,
  createAnimaDraftReducer,
  creationRoots,
  draftIssues,
  INTENSITIES,
  issueStep,
  newCreateAnimaDraft,
  reconcileCreationIssues,
  submissionLocksEditing,
  type CreateAnimaDraft,
  type CreateAnimaDraftAction,
  type CreationStep,
  type DraftEdit,
} from "./createAnimaDraft";
import {
  CreateAnimaDraftStorage,
  CreationDraftConflict,
  creationStorageKey,
  type CreationRecord,
} from "./createAnimaDraftStorage";
import {
  CreatorError,
  creatorErrorText,
  libraryAvatarFailureText,
} from "./createAnimaErrors";
import {
  classifyCreationFailure,
  freezeCreation,
} from "./createAnimaSubmission";

type Recovery = "loading" | "resume" | "appearance" | "corrupt" | "ready";
type Validation = {
  signature: string;
  spec: AnimaSpecInput;
  warnings: AnimaCreationDiagnostic[];
};
type Repair =
  | { kind: "source"; preview: PyTypedContentPreview }
  | { kind: "policy"; options: AnimaCreationOptions };

/** Navigation and fresh evidence cannot invalidate a form revision; actual inputs can. */
export function creationDraftSignature(draft: CreateAnimaDraft): string {
  const inputs = Object.fromEntries(
    Object.entries(draft).filter(
      ([key]) =>
        ![
          "step",
          "furthest_step",
          "meaningful",
          "evidence",
          "submission",
        ].includes(key),
    ),
  );
  return canonicalJson(inputs);
}

/** Own recovery and dispatch independently of rendering. No effect ever sends a creation POST. */
export function useCreateAnimaController(
  owner: string,
  avatarHandoff?: string,
) {
  const { t } = useTranslation("create");
  const [draft, setDraft] = useState(newCreateAnimaDraft);
  const latest = useRef(draft);
  latest.current = draft;
  const store = useRef<CreateAnimaDraftStorage | null>(null);
  const saved = useRef<CreationRecord | null>(null);
  const [recovery, setRecovery] = useState<Recovery>("loading");
  const [storageError, setStorageError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  // A status line, or a worded failure with optional secondary detail.
  const [message, setMessage] = useState<string | ApiErrorText | null>(null);
  const [issues, setIssues] = useState<AnimaCreationDiagnostic[]>([]);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [completedId, setCompletedId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [working, setWorking] = useState(false);
  const [repair, setRepair] = useState<Repair | null>(null);
  const [returnToReview, setReturnToReview] = useState(false);
  const [focus, setFocus] = useState<{
    target: string;
    sequence: number;
  } | null>(null);
  const [focusErrors, setFocusErrors] = useState(0);
  const inFlight = useRef(false);
  // The last draft signature sent for validation, so Review rechecks each edit once.
  const recheckedSignature = useRef<string | null>(null);
  const handoffApplied = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const locked = submissionLocksEditing(draft);
  const sources = useAnimaCreationSources(
    recovery === "ready" && !locked && !completedId && !conflict,
  );
  const operations = useAnimaCreationOperations();
  const resolve = operations.resolve;
  const busy =
    working ||
    operations.validate.isPending ||
    operations.create.isPending ||
    operations.saveAvatar.isPending;
  const identityLimit = Math.min(
    32768,
    sources.options.data?.limits.identity_max_bytes ?? 32768,
  );
  const displayNameLimit = Math.min(
    40,
    sources.options.data?.limits.display_name_max_characters ?? 40,
  );

  const storageFailure = useCallback((error: unknown) => {
    setStorageError(apiErrorLine(creatorErrorText(error)));
    if (error instanceof CreationDraftConflict) setConflict(true);
  }, []);
  // Stable across a UI Locale change: the draft-seeding effect depends on it
  // through `update` and `dispatch`, and must not save the draft again.
  const persist = useCallback((next: CreateAnimaDraft) => {
    if (!store.current) {
      const t = getI18n().getFixedT(null, "create");
      throw new CreatorError(t("storage.unavailable"));
    }
    store.current.save(next);
    setStorageError(null);
  }, []);
  const update = useCallback(
    (next: CreateAnimaDraft, save = true) => {
      const previous = latest.current;
      latest.current = next;
      setDraft(next);
      if (creationDraftSignature(previous) !== creationDraftSignature(next))
        setIssues((current) =>
          reconcileCreationIssues(
            current,
            previous,
            next,
            identityLimit,
            displayNameLimit,
          ),
        );
      if (save && (next.meaningful || next.submission)) {
        try {
          persist(next);
        } catch (error) {
          storageFailure(error);
        }
      }
    },
    [displayNameLimit, identityLimit, persist, storageFailure],
  );
  const dispatch = useCallback(
    (action: CreateAnimaDraftAction) => {
      if (inFlight.current || conflict) return;
      update(createAnimaDraftReducer(latest.current, action));
    },
    [conflict, update],
  );
  const edit = useCallback(
    (patch: DraftEdit) => {
      dispatch({ type: "edit", patch });
      setMessage(null);
    },
    [dispatch],
  );

  useEffect(() => {
    try {
      const storage = new CreateAnimaDraftStorage(
        creationStorageKey(owner, window.location.origin),
        window.localStorage,
      );
      store.current = storage;
      const record = storage.read();
      saved.current = record;
      if (record?.kind === "complete") {
        setCompletedId(record.anima_id);
        setRecovery("ready");
      } else if (
        record?.kind === "draft" &&
        submissionLocksEditing(record.draft)
      ) {
        // Restore the exact command before any mutable-source queries can run.
        latest.current = record.draft;
        setDraft(record.draft);
        setRecovery("ready");
      } else setRecovery(record ? "resume" : "ready");
    } catch (error) {
      storageFailure(error);
      setRecovery(store.current ? "corrupt" : "ready");
    }
  }, [owner, storageFailure]);

  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (
        event.key === store.current?.key &&
        store.current?.changedElsewhere()
      ) {
        setConflict(true);
        setStorageError(t("storage.changedElsewhere"));
      }
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [t]);

  useEffect(() => {
    if (
      recovery === "ready" &&
      !locked &&
      !conflict &&
      !completedId &&
      sources.options.data &&
      !draft.starter_pack
    )
      dispatch({ type: "seed", options: sources.options.data });
  }, [
    completedId,
    conflict,
    dispatch,
    draft.starter_pack,
    locked,
    recovery,
    sources.options.data,
  ]);

  const chooseAvatar = useCallback(
    async (source: ItemRevisionRef, meaningful = true) => {
      const preview = await resolve("avatar", source, { fresh: true });
      if (!alive.current || submissionLocksEditing(latest.current)) return;
      if (preview.item.kind !== "avatar")
        throw new CreatorError(t("controller.notAvatar"));
      const next = createAnimaDraftReducer(latest.current, {
        type: "avatar",
        source,
        evidence: creationEvidence(preview),
        meaningful,
      });
      update(next);
    },
    [resolve, t, update],
  );

  useEffect(() => {
    if (
      handoffApplied.current ||
      !avatarHandoff ||
      recovery !== "ready" ||
      locked ||
      completedId ||
      conflict
    )
      return;
    // A saved draft always wins over a new Library URL hint.
    handoffApplied.current = true;
    if (latest.current.meaningful || latest.current.avatar) return;
    setWorking(true);
    void resolve(
      "avatar",
      { item_id: avatarHandoff, revision_sha256: "0".repeat(64) },
      { fresh: true, acceptCurrent: true },
    )
      .then((preview) => chooseAvatar(itemReference(preview.item), false))
      .catch((error) => {
        if (alive.current) setMessage(libraryAvatarFailureText(error));
      })
      .finally(() => {
        if (alive.current) setWorking(false);
      });
  }, [
    avatarHandoff,
    chooseAvatar,
    completedId,
    conflict,
    locked,
    recovery,
    resolve,
  ]);

  const showIssues = (next: AnimaCreationDiagnostic[]) => {
    setIssues(next);
    setFocusErrors((value) => value + 1);
  };
  const validate = async (advance = false) => {
    if (busy || inFlight.current || locked || conflict) return;
    const snapshot = latest.current;
    const errors = draftIssues(snapshot, 3, identityLimit, displayNameLimit);
    if (errors.length) {
      showIssues(errors);
      return;
    }
    const signature = creationDraftSignature(snapshot);
    recheckedSignature.current = signature;
    setMessage(null);
    setValidation(null);
    try {
      const result = await operations.validate.mutateAsync(snapshot);
      if (
        !alive.current ||
        signature !== creationDraftSignature(latest.current) ||
        submissionLocksEditing(latest.current)
      )
        return;
      let next = createAnimaDraftReducer(latest.current, {
        type: "evidence",
        evidence: result.draft.evidence,
      });
      if (advance)
        next = createAnimaDraftReducer(next, { type: "step", step: 4 });
      update(next);
      setIssues([]);
      setValidation({
        signature,
        spec: result.result.spec,
        warnings: result.result.warnings,
      });
      setReturnToReview(false);
    } catch (error) {
      if (
        !alive.current ||
        signature !== creationDraftSignature(latest.current)
      )
        return;
      if (error instanceof AnimaCreationApiError)
        showIssues(
          error.failure.detail.issues.length
            ? error.failure.detail.issues
            : [
                {
                  code: error.failure.detail.code,
                  path: "/starter_pack",
                  // The backend detail, worded from its code when shown.
                  message: error.failure.detail.message,
                },
              ],
        );
      else
        showIssues([
          {
            code: "validation_unavailable",
            path: "/expected_source_revisions",
            message: apiErrorLine(creatorErrorText(error)),
          },
        ]);
    }
  };
  const go = (step: CreationStep, fromReview = false) => {
    if (busy || locked || conflict) return;
    if (step > latest.current.step) {
      const errors = draftIssues(
        latest.current,
        Math.min(step - 1, 3) as CreationStep,
        identityLimit,
        displayNameLimit,
      );
      if (errors.length) {
        showIssues(errors);
        return;
      }
      if (step === 4) {
        void validate(true);
        return;
      }
    }
    if (fromReview) setReturnToReview(true);
    dispatch({ type: "step", step });
  };
  const resume = () => {
    const record = saved.current;
    if (record?.kind !== "draft") return;
    handoffApplied.current = true;
    update(record.draft);
    setRecovery(
      record.draft.appearance_migration === "confirmation_required"
        ? "appearance"
        : "ready",
    );
    if (
      record.draft.step === 4 &&
      record.draft.appearance_migration !== "confirmation_required"
    )
      void validate(false);
  };
  const continueWithoutImages = () => {
    const next = {
      ...latest.current,
      appearance_migration: "none" as const,
    };
    update(next);
    setRecovery("ready");
    if (next.step === 4) void validate(false);
  };
  const discard = (acknowledgeDeleted = false) => {
    try {
      store.current?.discard({
        acknowledgeDeleted,
        corruptConfirmed: recovery === "corrupt",
      });
      const next = newCreateAnimaDraft();
      latest.current = next;
      setDraft(next);
      saved.current = null;
      setFile(null);
      setValidation(null);
      setIssues([]);
      setStorageError(null);
      setRecovery("ready");
      setCompletedId(null);
      // An explicit Start over may apply the current URL hint to a clean draft.
      handoffApplied.current = false;
      return true;
    } catch (error) {
      storageFailure(error);
      return false;
    }
  };
  const reviewOtherTab = () => {
    try {
      const record = store.current?.read() ?? null;
      saved.current = record;
      setConflict(false);
      setStorageError(null);
      setFile(null);
      setValidation(null);
      setIssues([]);
      if (record?.kind === "complete") {
        setCompletedId(record.anima_id);
        setRecovery("ready");
      } else if (
        record?.kind === "draft" &&
        submissionLocksEditing(record.draft)
      ) {
        update(record.draft, false);
        setRecovery("ready");
      } else if (record?.kind === "draft") {
        setRecovery("resume");
      } else {
        update(newCreateAnimaDraft(), false);
        setRecovery("ready");
      }
    } catch (error) {
      storageFailure(error);
    }
  };
  const retrySave = () => {
    try {
      if (!store.current) {
        store.current = new CreateAnimaDraftStorage(
          creationStorageKey(owner, window.location.origin),
          window.localStorage,
        );
        const record = store.current.read();
        if (record) throw new CreationDraftConflict();
      }
      if (completedId) {
        store.current.complete(completedId);
        setStorageError(null);
      } else persist(latest.current);
    } catch (error) {
      storageFailure(error);
    }
  };

  const signature = creationDraftSignature(draft);
  const valid = validation?.signature === signature ? validation : null;
  const validateLatest = useRef(validate);
  validateLatest.current = validate;
  // An edit on Review, such as renaming on the name plate, stales the checked
  // spec that Create needs. Recheck each edited draft once typing settles; a
  // failed check shows its issues and waits for the next edit.
  const reviewStale =
    draft.step === 4 &&
    recovery === "ready" &&
    !valid &&
    !busy &&
    !locked &&
    !conflict &&
    !completedId;
  useEffect(() => {
    if (!reviewStale || recheckedSignature.current === signature) return;
    const timer = window.setTimeout(
      () => void validateLatest.current(false),
      400,
    );
    return () => window.clearTimeout(timer);
  }, [reviewStale, signature]);
  const submit = async (replay = false) => {
    if (inFlight.current || busy || conflict || completedId) return;
    if (!replay && (!valid || locked)) {
      await validate(false);
      return;
    }
    const prior = latest.current.submission;
    if (replay && (!prior || !["pending", "unknown"].includes(prior.state)))
      return;
    inFlight.current = true;
    setWorking(true);
    setMessage(null);
    try {
      if (!navigator.locks)
        throw new CreatorError(t("controller.locksUnavailable"));
      await navigator.locks.request(
        `${store.current?.key ?? owner}:submit`,
        { ifAvailable: true },
        async (lock) => {
          if (!lock) throw new CreatorError(t("controller.lockBusy"));
          const request = replay
            ? prior!.request
            : freezeCreation(latest.current, valid!.spec);
          const pending = {
            ...latest.current,
            submission: { request, state: "pending" as const },
          };
          // No POST can escape before durable, owner-scoped recovery succeeds.
          persist(pending);
          update(pending, false);
          try {
            const result = await operations.create.mutateAsync(request);
            try {
              store.current!.complete(result.anima_id);
              setStorageError(null);
            } catch (error) {
              storageFailure(error);
            }
            if (!alive.current) return;
            setCompletedId(result.anima_id);
            setFile(null);
            setValidation(null);
            setIssues([]);
            update(newCreateAnimaDraft(), false);
          } catch (error) {
            if (!alive.current) return;
            const failure =
              error instanceof AnimaCreationApiError
                ? error.failure
                : classifyCreationFailure(error);
            const next = {
              ...pending,
              submission: { request, state: failure.state },
            };
            update(next);
            setMessage(creationFailureText(failure.detail));
            if (failure.state === "rejected") {
              setValidation(null);
              showIssues(failure.detail.issues);
              if (next.appearance_migration === "confirmation_required")
                setRecovery("appearance");
            }
          }
        },
      );
    } catch (error) {
      if (alive.current) {
        storageFailure(error);
        setMessage(creatorErrorText(error));
      }
    } finally {
      inFlight.current = false;
      if (alive.current) setWorking(false);
    }
  };

  const proposeRepair = async (issue: AnimaCreationDiagnostic) => {
    if (busy || locked) return;
    setWorking(true);
    setMessage(null);
    try {
      const current = latest.current;
      const root =
        creationRoots(current).find(
          (candidate) =>
            candidate.source.item_id ===
            (issue.declaring_action_item_id ?? issue.item_id),
        ) ??
        creationRoots(current).find((candidate) =>
          Boolean(
            issue.item_id &&
            current.evidence[candidate.source.item_id]?.revisions[
              issue.item_id
            ],
          ),
        );
      if (root)
        setRepair({
          kind: "source",
          preview: await resolve(root.kind, root.source, {
            fresh: true,
            acceptCurrent: true,
          }),
        });
      else {
        const response = await sources.options.refetch();
        if (!response.data || response.error)
          throw new CreatorError(t("controller.defaultsUnavailable"));
        setRepair({ kind: "policy", options: response.data });
      }
    } catch (error) {
      setMessage(creatorErrorText(error));
    } finally {
      setWorking(false);
    }
  };
  const acceptRepair = async () => {
    if (!repair || locked || busy) return;
    setWorking(true);
    try {
      if (repair.kind === "policy") {
        // Explicitly rebase fixed policy only; never reseed the user's Actions.
        update({
          ...latest.current,
          starter_pack: repair.options.starter_pack,
          meaningful: true,
        });
      } else {
        const preview = repair.preview;
        const ref = itemReference(preview.item);
        const current = latest.current;
        if (current.avatar?.item_id === ref.item_id) {
          await chooseAvatar(ref);
        } else {
          const reactions = structuredClone(current.reactions);
          for (const row of Object.values(reactions))
            for (const intensity of INTENSITIES)
              row[intensity] = row[intensity].map((member) =>
                member.item_id === ref.item_id ? ref : member,
              );
          edit({
            ...(current.voice?.pocket.type === "clone" &&
            current.voice.pocket.source.item_id === ref.item_id
              ? {
                  voice: {
                    ...current.voice,
                    pocket: { type: "clone", source: ref },
                  },
                }
              : {}),
            reactions,
            gestures: current.gestures.map((gesture) =>
              gesture.source.item_id === ref.item_id
                ? { ...gesture, source: ref }
                : gesture,
            ),
            evidence: {
              ...current.evidence,
              [ref.item_id]: creationEvidence(preview),
            },
          });
        }
      }
      setRepair(null);
      setValidation(null);
      setMessage(t("controller.revisionsAccepted"));
    } catch (error) {
      if (alive.current) setMessage(creatorErrorText(error));
    } finally {
      if (alive.current) setWorking(false);
    }
  };

  const completeHandoff = useCallback((animaId: string) => {
    try {
      const record = store.current?.read();
      if (record?.kind === "complete" && record.anima_id === animaId)
        store.current!.discard();
    } catch {
      /* The completion marker remains a safe route back to the existing Anima. */
    }
  }, []);

  return {
    draft,
    sources,
    operations,
    recovery,
    storageError,
    conflict,
    message: typeof message === "string" ? message : (message?.message ?? null),
    /** Secondary technical detail for `message`, when it has one. */
    messageDetail:
      typeof message === "string" ? null : (message?.detail ?? null),
    issues,
    valid,
    completedId,
    file,
    busy,
    locked,
    working,
    setWorking,
    repair,
    setRepair,
    focus,
    focusErrors,
    identityLimit,
    displayNameLimit,
    returnToReview,
    edit,
    dispatch,
    go,
    resume,
    continueWithoutImages,
    discard,
    reviewOtherTab,
    retrySave,
    validate,
    submit,
    chooseAvatar,
    proposeRepair,
    acceptRepair,
    setFile: (next: File | null) => {
      setFile(next);
      edit({ needs_file_reselection: Boolean(next) });
    },
    resetActions: async () => {
      if (busy || locked || conflict) return;
      setWorking(true);
      try {
        const response = await sources.options.refetch();
        if (response.error || !response.data)
          throw new CreatorError(t("controller.starterPackRefreshFailed"));
        if (alive.current)
          dispatch({ type: "reset-actions", options: response.data });
      } catch (error) {
        if (alive.current) setMessage(creatorErrorText(error));
      } finally {
        if (alive.current) setWorking(false);
      }
    },
    focusIssue: (issue: AnimaCreationDiagnostic, target: string) => {
      const step = issueStep(issue.path);
      if (step !== null) dispatch({ type: "step", step });
      setFocus((value) => ({
        target: step === null ? "creation-display-name" : target,
        sequence: (value?.sequence ?? 0) + 1,
      }));
    },
    saveForLeave: () => persist(latest.current),
    completeHandoff,
  };
}

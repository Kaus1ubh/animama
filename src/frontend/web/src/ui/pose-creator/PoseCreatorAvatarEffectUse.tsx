import { RotateCcwIcon } from "lucide-react";
import { useCallback, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { AnimaPoseClipEvent } from "@/lib/avatar/poses/animaPoseClip";
import {
  avatarEffectFieldLabel,
  avatarEffectSettingProblem,
  type AvatarEffectEditorAction,
  type AvatarEffectEditorDocument,
} from "@/lib/avatar/vfx/editor";
import { AvatarEffectInspector } from "@/ui/avatar-effect-creator/AvatarEffectInspector";
import { AttachmentFields } from "@/ui/avatar-effect-creator/AvatarEffectSetupFields";
import { Button } from "@/ui/components/button";
import {
  avatarEffectUseDocument,
  avatarEffectUseErrorField,
  avatarEffectUseSource,
  editAvatarEffectUse,
  sameAvatarEffectOverride,
  type AvatarEffectUseSource,
} from "./avatarEffectUse";
import type { PoseCreatorClipEventDraftPatch } from "./poseCreatorClipAuthoring";
import { usePoseCreatorPreview } from "./PoseCreatorPreviewProvider";
import { usePoseCreatorClipUndoGrouping } from "./usePoseCreatorUndoGrouping";

/** One `avatar_vfx` event's use of its effect, as the Action creator edits it. */
export type AvatarEffectUse = {
  source: AvatarEffectUseSource;
  /** The use as an effect-creator document; null when its override cannot play. */
  document: AvatarEffectEditorDocument | null;
  /** Why the stored override cannot play, when `document` is null. */
  openError: unknown;
  /** Why the last edit was refused, while the use is unchanged since. */
  refusal: unknown;
  /** Whether the event overrides its effect. */
  overridden: boolean;
  /** The sound this use plays: its chosen one or the effect's. */
  soundAlias: string | undefined;
  dispatch: (action: AvatarEffectEditorAction) => void;
  chooseSound: (alias: string) => void;
  /** Remove the override, so the event plays the effect as it is. */
  reset: () => void;
};

/** The effect the event names in the mounted preview runtime, if available. */
export function useAvatarEffectUseSource(
  event: AnimaPoseClipEvent | null,
): AvatarEffectUseSource | null {
  const { runtime } = usePoseCreatorPreview();
  const effectId = event?.kind === "avatar_vfx" ? event.effectId : null;
  return useMemo(
    () => (effectId ? avatarEffectUseSource(runtime, effectId) : null),
    [effectId, runtime],
  );
}

/**
 * Edit an `avatar_vfx` event's override with the Avatar Effect creator's
 * controls: each change is applied to the use's document and saved as the
 * smallest override that plays it (none when it matches the effect). Null for
 * other events, or while the effect's definition is unavailable.
 */
export function useAvatarEffectUse(
  event: AnimaPoseClipEvent | null,
  source: AvatarEffectUseSource | null,
  onUpdate: (patch: PoseCreatorClipEventDraftPatch) => void,
): AvatarEffectUse | null {
  const override = event?.kind === "avatar_vfx" ? event.override : undefined;
  const eventId = event?.id ?? null;
  // A refusal is shown only while the same event keeps the same override.
  const refusalKey = `${eventId}:${JSON.stringify(override ?? null)}`;
  // Quick successive edits (a colour picker's stream of changes) build on
  // the override just written, before the store's update re-renders this hook.
  const overrideRef = useRef(override);
  overrideRef.current = override;
  const [refusal, setRefusal] = useState<{
    key: string;
    error: unknown;
  } | null>(null);
  const opened = useMemo(() => {
    if (!source) return null;
    try {
      return { document: avatarEffectUseDocument(source.definition, override) };
    } catch (error) {
      return { document: null, error };
    }
  }, [override, source]);

  const apply = useCallback(
    (change: Parameters<typeof editAvatarEffectUse>[2]) => {
      if (!source) return;
      const current = overrideRef.current;
      const result = editAvatarEffectUse(source.definition, current, change);
      if ("error" in result) {
        setRefusal({
          key: `${eventId}:${JSON.stringify(current ?? null)}`,
          error: result.error,
        });
        return;
      }
      setRefusal(null);
      if (sameAvatarEffectOverride(result.override, current)) return;
      overrideRef.current = result.override;
      onUpdate({ override: result.override ?? null });
    },
    [eventId, onUpdate, source],
  );
  const dispatch = useCallback(
    (action: AvatarEffectEditorAction) => apply({ action }),
    [apply],
  );
  const chooseSound = useCallback(
    (soundAlias: string) => apply({ soundAlias }),
    [apply],
  );
  const reset = useCallback(() => {
    setRefusal(null);
    overrideRef.current = undefined;
    onUpdate({ override: null });
  }, [onUpdate]);

  if (event?.kind !== "avatar_vfx" || !source || !opened) return null;
  return {
    source,
    document: opened.document,
    openError: "error" in opened ? opened.error : null,
    refusal: refusal?.key === refusalKey ? refusal.error : null,
    overridden: Boolean(override),
    soundAlias:
      override?.soundAlias ?? source.definition.soundAlias ?? undefined,
    dispatch,
    chooseSound,
    reset,
  };
}

/**
 * A refused change in the effect creator's words: the setting and, in
 * English, the validator's explanation (secondary detail elsewhere).
 */
function useUseProblem(error: unknown): string | null {
  // Re-render with the language, as the creator's wording follows it.
  useTranslation("effects");
  if (!error) return null;
  const detail =
    error instanceof Error
      ? error.message.replace(/^Avatar Effect definition is invalid: /, "")
      : null;
  return avatarEffectSettingProblem(
    avatarEffectFieldLabel(avatarEffectUseErrorField(error) ?? ""),
    detail,
  );
}

/**
 * The event inspector's "This use" section: the Avatar Effect creator's
 * placement, look and motion controls for this event only, and Reset to
 * effect while the event overrides its effect.
 */
export function PoseCreatorAvatarEffectUseSection({
  use,
  disabled,
}: {
  use: AvatarEffectUse;
  disabled: boolean;
}) {
  const { t } = useTranslation("pose");
  const headingId = useId();
  const { beginUndoGroup, endUndoGroup } = usePoseCreatorClipUndoGrouping();
  const openProblem = useUseProblem(use.openError);
  const refusalProblem = useUseProblem(use.refusal);
  return (
    <section aria-labelledby={headingId} className="border-t pt-3">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <h3 id={headingId} className="text-foreground text-xs font-semibold">
          {t("clip.event.use.title")}
        </h3>
        {use.overridden ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-mr-2 h-7 px-2 text-xs"
            disabled={disabled}
            onClick={use.reset}
          >
            <RotateCcwIcon className="size-3.5" />
            {t("clip.event.use.reset")}
          </Button>
        ) : null}
      </div>
      <p className="text-muted-foreground mt-1 text-xs">
        {t("clip.event.use.help")}
      </p>
      {use.document ? (
        // One focus visit to a control is one Undo step, as elsewhere in
        // the inspector; the controls themselves come from the effect creator.
        <fieldset
          disabled={disabled}
          className="mt-3 min-w-0 space-y-3"
          onFocus={beginUndoGroup}
          onBlur={endUndoGroup}
        >
          <AttachmentFields
            attachment={use.document.attachment}
            invalid={() => false}
            onDispatch={use.dispatch}
          />
          <AvatarEffectInspector
            document={use.document}
            invalidField={null}
            onDispatch={use.dispatch}
          />
        </fieldset>
      ) : (
        <div role="alert" className="text-destructive mt-3 space-y-1 text-xs">
          <p>{t("clip.event.use.unplayable")}</p>
          {openProblem ? <p>{openProblem}</p> : null}
        </div>
      )}
      {refusalProblem ? (
        <div role="alert" className="text-destructive mt-3 space-y-1 text-xs">
          <p className="font-medium">{t("clip.event.use.refused")}</p>
          <p>{refusalProblem}</p>
        </div>
      ) : null}
    </section>
  );
}

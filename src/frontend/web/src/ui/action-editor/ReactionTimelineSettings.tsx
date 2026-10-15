"use client";

import { useTranslation } from "react-i18next";

import {
  REACTION_INTENSITIES,
  type EmotionReactionIntensity,
} from "@/lib/avatar/reactionPools";
import { TRACKED_EMOTIONS } from "@/lib/emotion";
import { emotionLabel } from "@/lib/emotion/presentation";
import { reactionIntensityLabel } from "@/ui/animas/ActionLoadoutRows";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select";
import { InspectorRow } from "@/ui/pose-creator/PoseCreatorClipWorkspaceInspector";
import { useActionEditorWorkspace } from "./ActionEditorWorkspaceContext";

const NO_SUGGESTION = "__none__";

/** Reaction-only controls share the timeline's compact settings rows. */
export function ReactionTimelineSettings() {
  return (
    <>
      <ReactionEmotionSettings />
    </>
  );
}

/** Optional placement is editable for both timeline and existing VRMA reactions. */
export function ReactionEmotionSettings() {
  const { t } = useTranslation("actionEditor");
  const { document, setDocument } = useActionEditorWorkspace();
  return (
    <section className="border-t pt-3">
      <h2 className="text-foreground text-sm font-semibold">
        {t("reactionSettings.title")}
      </h2>
      <div className="mt-3 space-y-3">
        <InspectorRow label={t("reactionSettings.emotion")}>
          <Select
            value={document.suggestedEmotion || NO_SUGGESTION}
            onValueChange={(emotion) =>
              setDocument((current) => ({
                ...current,
                suggestedEmotion: emotion === NO_SUGGESTION ? "" : emotion,
              }))
            }
          >
            <SelectTrigger
              className="h-9 w-[176px]"
              aria-label={t("reactionSettings.suggestedEmotion")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_SUGGESTION}>
                {t("reactionSettings.none")}
              </SelectItem>
              {TRACKED_EMOTIONS.map((emotion) => (
                <SelectItem key={emotion} value={emotion}>
                  {emotionLabel(emotion)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </InspectorRow>
        <InspectorRow label={t("reactionSettings.intensity")}>
          <Select
            value={String(document.suggestedIntensity)}
            disabled={!document.suggestedEmotion}
            onValueChange={(intensity) =>
              setDocument((current) => ({
                ...current,
                suggestedIntensity: Number(
                  intensity,
                ) as EmotionReactionIntensity,
              }))
            }
          >
            <SelectTrigger
              className="h-9 w-[176px]"
              aria-label={t("reactionSettings.suggestedIntensity")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REACTION_INTENSITIES.map((intensity) => (
                <SelectItem key={intensity} value={String(intensity)}>
                  {reactionIntensityLabel(intensity)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </InspectorRow>
      </div>
      <p className="text-muted-foreground mt-3 text-xs">
        {t("reactionSettings.hint")}
      </p>
    </section>
  );
}

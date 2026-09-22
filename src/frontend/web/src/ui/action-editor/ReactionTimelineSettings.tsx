"use client";

import { TRACKED_EMOTIONS } from "@/lib/emotion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select";
import {
  InspectorRow,
  PoseCreatorClipWorkspaceInspector,
} from "@/ui/pose-creator/PoseCreatorClipWorkspaceInspector";
import { useActionEditorWorkspace } from "./ActionEditorWorkspaceContext";

const NO_SUGGESTION = "__none__";

/** Reaction-only controls share the timeline's compact settings rows. */
export function ReactionTimelineSettings() {
  return (
    <>
      <PoseCreatorClipWorkspaceInspector
        section="inspector"
        allowHumanoid={false}
        embedded
      />
      <ReactionEmotionSettings />
    </>
  );
}

/** Optional placement is editable for both timeline and existing VRMA reactions. */
export function ReactionEmotionSettings() {
  const { document, setDocument } = useActionEditorWorkspace();
  return (
    <section className="border-t pt-3">
      <h2 className="text-foreground text-sm font-semibold">
        Emotion suggestion
      </h2>
      <div className="mt-3 space-y-3">
        <InspectorRow label="Emotion">
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
              aria-label="Suggested emotion"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_SUGGESTION}>None</SelectItem>
              {TRACKED_EMOTIONS.map((emotion) => (
                <SelectItem key={emotion} value={emotion}>
                  {emotion[0]!.toUpperCase() + emotion.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </InspectorRow>
        <InspectorRow label="Intensity">
          <Select
            value={String(document.suggestedIntensity)}
            disabled={!document.suggestedEmotion}
            onValueChange={(intensity) =>
              setDocument((current) => ({
                ...current,
                suggestedIntensity: Number(intensity) as 1 | 2 | 3,
              }))
            }
          >
            <SelectTrigger
              className="h-9 w-[176px]"
              aria-label="Suggested intensity"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Mild</SelectItem>
              <SelectItem value="2">Medium</SelectItem>
              <SelectItem value="3">Strong</SelectItem>
            </SelectContent>
          </Select>
        </InspectorRow>
      </div>
      <p className="text-muted-foreground mt-3 text-xs">
        Optional. Choose the actual emotion slot when equipping.
      </p>
    </section>
  );
}

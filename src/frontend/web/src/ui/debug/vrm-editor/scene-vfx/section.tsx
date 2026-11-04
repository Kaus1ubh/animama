import { EmptyState, KeyValueGrid, Panel } from "../controls";
import { SceneBackgroundPanel } from "./background-panel";
import { formatSceneVFXDuration } from "./helpers";
import { SceneFocusLinesPanel } from "./focus-lines-panel";
import type { SceneVFXDraftControllers } from "./useSceneVFXDrafts";

export function SceneVFXSection({
  drafts,
}: {
  drafts: SceneVFXDraftControllers;
}) {
  const { background, focusLines } = drafts;

  if (!background.draft || !focusLines.draft) {
    return (
      <EmptyState
        title="Scene VFX draft unavailable"
        description="Open the modal with an active avatar to seed the scene-VFX editor."
      />
    );
  }

  return (
    <div className="space-y-4">
      <Panel
        title="Runtime status"
        description="The Scene VFX editor writes modal-local drafts per kind and applies them to the shared scene-vfx runtime only through Preview or Apply."
      >
        <KeyValueGrid
          rows={[
            {
              label: "Live background",
              value: background.activeRuntime
                ? background.activeRuntime.entry.label
                : "None",
            },
            {
              label: "Background preview",
              value: background.previewActive ? "Active" : "Inactive",
            },
            {
              label: "Background preset",
              value:
                background.presetId === "custom"
                  ? "Custom"
                  : background.presetId,
            },
            {
              label: "Background duration",
              value: background.activeRuntime
                ? background.activeRuntime.expiresAtMs === null
                  ? formatSceneVFXDuration(null)
                  : "Timed"
                : "-",
            },
            {
              label: "Live focus lines",
              value: focusLines.activeRuntime
                ? focusLines.activeRuntime.entry.label
                : "None",
            },
            {
              label: "Focus preview",
              value: focusLines.previewActive ? "Active" : "Inactive",
            },
            {
              label: "Focus preset",
              value:
                focusLines.presetId === "custom"
                  ? "Custom"
                  : focusLines.presetId,
            },
            {
              label: "Focus placement",
              value: focusLines.activeRuntime
                ? focusLines.activeRuntime.entry.renderPlacement
                : focusLines.draft.renderPlacement,
            },
            {
              label: "Focus duration",
              value: focusLines.activeRuntime
                ? focusLines.activeRuntime.expiresAtMs === null
                  ? formatSceneVFXDuration(null)
                  : "Timed"
                : "-",
            },
          ]}
        />
      </Panel>
      <SceneBackgroundPanel controller={background} />
      <SceneFocusLinesPanel controller={focusLines} />
    </div>
  );
}

"use client";

import type {
  AvatarFaceLandmarksSnapshot,
  AvatarFaceTextureAnchorsSnapshot,
  AvatarVFXAppliedEffectSnapshot,
  AvatarVFXSnapshot,
  AvatarVFXTargetBindingSnapshot,
  VRMEditorSession,
} from "@/lib/avatar";
import type { VRMInspectionTexture } from "@/lib/avatar/vrm-editor-types";
import { Switch } from "@/ui/components/switch";
import { EmptyState, KeyValueGrid, Panel, WarningList } from "../controls";
import {
  FaceTextureAnchorUvPreview,
  LandmarkEyeCard,
  TextureAnchorCard,
} from "../face-preview";
import { formatMaybeText, formatVector3 } from "../formatting";
import { CatalogEffectCard } from "./catalog-effect-card";
import type { VFXCatalogDraftController } from "./use-vfx-catalog-drafts";

export function EffectsSection({
  status,
  vfx,
  faceLandmarks,
  faceTextureAnchors,
  faceTexturePreview,
  effectWarnings,
  session,
  onOpenTexturePreview,
  playSfxCue,
  vfxBindingByKey,
  vfxActiveEffectsByEffectId,
  drafts,
}: {
  status: string;
  vfx: AvatarVFXSnapshot | null;
  faceLandmarks: AvatarFaceLandmarksSnapshot | null;
  faceTextureAnchors: AvatarFaceTextureAnchorsSnapshot | null;
  faceTexturePreview: VRMInspectionTexture | null;
  effectWarnings: string[];
  session: VRMEditorSession | null;
  onOpenTexturePreview: (index: number) => void;
  playSfxCue: (cue: string) => void;
  vfxBindingByKey: Map<string, AvatarVFXTargetBindingSnapshot>;
  vfxActiveEffectsByEffectId: Map<string, AvatarVFXAppliedEffectSnapshot[]>;
  drafts: VFXCatalogDraftController;
}) {
  if (!vfx && status === "loading") {
    return (
      <EmptyState
        title="Loading VFX targets"
        description="Discovering live eye and face material usages on the active avatar."
      />
    );
  }

  if (!vfx) {
    return (
      <EmptyState
        title="VFX controls unavailable"
        description="The active avatar does not expose VFX target bindings."
      />
    );
  }

  return (
    <div className="space-y-4">
      <WarningList warnings={effectWarnings} />
      <Panel
        title="Face landmarks"
        description="Face-box-relative eye anchors derived from the iris primitive geometry."
      >
        {faceLandmarks?.status === "ready" ? (
          <div className="space-y-4">
            <KeyValueGrid
              rows={[
                {
                  label: "Anchor",
                  value:
                    faceLandmarks.anchorName || faceLandmarks.anchorType || "-",
                },
                {
                  label: "Face binding",
                  value: (
                    <div className="space-y-1">
                      <div className="font-mono text-xs break-all">
                        {faceLandmarks.faceBindingKey ?? "-"}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {formatMaybeText(faceLandmarks.faceMaterialName)}
                      </div>
                    </div>
                  ),
                },
                {
                  label: "Face box size",
                  value: formatVector3(
                    faceLandmarks.faceBoundsLocal?.size ?? null,
                  ),
                },
                {
                  label: "Front z",
                  value:
                    typeof faceLandmarks.frontZLocal === "number"
                      ? faceLandmarks.frontZLocal.toFixed(4)
                      : "-",
                },
                {
                  label: "Box hover clearance",
                  value:
                    typeof faceLandmarks.boxHoverClearanceLocal === "number"
                      ? faceLandmarks.boxHoverClearanceLocal.toFixed(4)
                      : "-",
                },
                {
                  label: "Box hover front z",
                  value:
                    typeof faceLandmarks.boxHoverFrontZLocal === "number"
                      ? faceLandmarks.boxHoverFrontZLocal.toFixed(4)
                      : "-",
                },
              ]}
            />
            <div className="grid gap-3 xl:grid-cols-2">
              <LandmarkEyeCard label="Left eye" eye={faceLandmarks.eyes.left} />
              <LandmarkEyeCard
                label="Right eye"
                eye={faceLandmarks.eyes.right}
              />
            </div>
          </div>
        ) : (
          <EmptyState
            title="Face landmarks unavailable"
            description={
              faceLandmarks?.warnings[0] ??
              "Face or iris bindings could not be resolved on the active avatar."
            }
          />
        )}
      </Panel>
      <Panel
        title="Face texture anchors"
        description="Cached UV anchors used by anchored face-skin texture decals."
      >
        {faceTextureAnchors?.status === "ready" ? (
          <div className="space-y-4">
            <KeyValueGrid
              rows={[
                {
                  label: "Face binding",
                  value: (
                    <div className="space-y-1">
                      <div className="font-mono text-xs break-all">
                        {faceTextureAnchors.faceBindingKey ?? "-"}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {formatMaybeText(faceTextureAnchors.faceMaterialName)}
                      </div>
                    </div>
                  ),
                },
                {
                  label: "Flatten status",
                  value:
                    vfx.flatten.status === "ready" ? "Ready" : "Unavailable",
                },
                {
                  label: "Flatten auto",
                  value: `${vfx.flatten.autoEyes ? "Eyes" : "-"} / ${vfx.flatten.autoMouth ? "Mouth" : "-"}`,
                },
                {
                  label: "Flatten active",
                  value: `${vfx.flatten.activeEyes ? "Eyes" : "-"} / ${vfx.flatten.activeMouth ? "Mouth" : "-"}`,
                },
                {
                  label: "Sampled color",
                  value: vfx.flatten.sampledColor ? (
                    <div className="inline-flex items-center gap-2">
                      <span
                        className="border-border/60 h-4 w-4 rounded border"
                        style={{
                          backgroundColor: vfx.flatten.sampledColor.cssColor,
                        }}
                      />
                      <span className="font-mono text-xs">
                        {vfx.flatten.sampledColor.cssColor}
                      </span>
                    </div>
                  ) : (
                    "-"
                  ),
                },
              ]}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="border-border/60 bg-background/70 text-foreground inline-flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
                <div>
                  <div className="font-medium">Flatten eyes</div>
                  <div className="text-muted-foreground text-xs">
                    Debug preview plus auto eye-hover flatten.
                  </div>
                </div>
                <Switch
                  checked={vfx.flatten.previewEyes}
                  onCheckedChange={(checked) =>
                    session?.setFaceFlattenPreview({ previewEyes: checked })
                  }
                  aria-label="Toggle eye flatten preview"
                  disabled={!session || vfx.flatten.status !== "ready"}
                />
              </label>
              <label className="border-border/60 bg-background/70 text-foreground inline-flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
                <div>
                  <div className="font-medium">Flatten mouth</div>
                  <div className="text-muted-foreground text-xs">
                    Debug preview plus auto mouth decal and mouth-hover flatten.
                  </div>
                </div>
                <Switch
                  checked={vfx.flatten.previewMouth}
                  onCheckedChange={(checked) =>
                    session?.setFaceFlattenPreview({ previewMouth: checked })
                  }
                  aria-label="Toggle mouth flatten preview"
                  disabled={!session || vfx.flatten.status !== "ready"}
                />
              </label>
            </div>
            {vfx.flatten.warning ? (
              <p className="text-muted-foreground text-xs">
                {vfx.flatten.warning}
              </p>
            ) : null}
            <FaceTextureAnchorUvPreview
              faceTextureAnchors={faceTextureAnchors}
              flattenState={vfx.flatten}
              previewTexture={faceTexturePreview}
              onOpenPreview={
                faceTexturePreview
                  ? () => onOpenTexturePreview(faceTexturePreview.index)
                  : null
              }
            />
            <div className="grid gap-3 xl:grid-cols-2">
              <TextureAnchorCard
                label="Undereye left"
                anchor={faceTextureAnchors.anchors.undereye.left}
              />
              <TextureAnchorCard
                label="Undereye right"
                anchor={faceTextureAnchors.anchors.undereye.right}
              />
              <TextureAnchorCard
                label="Blush left"
                anchor={faceTextureAnchors.anchors.blush.left}
              />
              <TextureAnchorCard
                label="Blush right"
                anchor={faceTextureAnchors.anchors.blush.right}
              />
              <TextureAnchorCard
                label="Mouth"
                anchor={faceTextureAnchors.anchors.mouth.center}
              />
            </div>
          </div>
        ) : (
          <EmptyState
            title="Face texture anchors unavailable"
            description={
              faceTextureAnchors?.warnings[0] ??
              "Face texture anchors could not be resolved on the active avatar."
            }
          />
        )}
      </Panel>
      <Panel
        title="Effect catalog"
        description="Bundled PNG effects grouped by target role, including texture overlays and hover-plane placements."
      >
        {vfx.catalog.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {vfx.catalog.map((effect) => (
              <CatalogEffectCard
                key={effect.id}
                effect={effect}
                session={session}
                drafts={drafts}
                targetBindings={vfx.targetBindings}
                activeEffectsByEffectId={vfxActiveEffectsByEffectId}
                bindingByKey={vfxBindingByKey}
                playSfxCue={playSfxCue}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title="No VFX catalog entries"
            description="No bundled VFX catalog entries are currently available."
          />
        )}
      </Panel>
    </div>
  );
}

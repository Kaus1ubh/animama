"use client";

import { useMemo } from "react";

import type {
  AvatarFaceLandmarksSnapshot,
  AvatarFaceTextureAnchorsSnapshot,
  AvatarFaceTextureFlattenRegionSnapshot,
  AvatarVFXFaceFlattenSnapshot,
  AvatarVFXTexturePivot,
} from "@/lib/avatar";
import type {
  VRMInspectionSnapshot,
  VRMInspectionTexture,
} from "@/lib/avatar/vrm-editor-types";
import { cn } from "@/lib/utils";
import { AppImage } from "@/platform/image/AppImage";
import { Button } from "@/ui/components/button";
import { formatBoxCoord, formatMaybeText, formatVector3 } from "./formatting";

export function LandmarkEyeCard({
  label,
  eye,
}: {
  label: string;
  eye: AvatarFaceLandmarksSnapshot["eyes"]["left"];
}) {
  if (!eye) {
    return (
      <div className="border-border/60 bg-background/70 rounded-lg border p-3">
        <p className="text-foreground text-sm font-semibold">{label}</p>
        <p className="text-muted-foreground mt-1 text-xs">
          No iris landmark was resolved for this side.
        </p>
      </div>
    );
  }

  return (
    <div className="border-border/60 bg-background/70 rounded-lg border p-3">
      <p className="text-foreground text-sm font-semibold">{label}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-muted-foreground text-2xs font-medium tracking-wide uppercase">
            Binding
          </p>
          <p className="text-foreground mt-1 font-mono text-xs break-all">
            {eye.bindingKey}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            {formatMaybeText(eye.materialName)} • {eye.vertexCount} verts
          </p>
        </div>
        <div>
          <p className="text-muted-foreground text-2xs font-medium tracking-wide uppercase">
            Center Local
          </p>
          <p className="text-foreground mt-1 font-mono text-xs">
            {formatVector3(eye.centerLocal)}
          </p>
          <p className="text-muted-foreground text-2xs mt-2 font-medium tracking-wide uppercase">
            Projected Front
          </p>
          <p className="text-foreground mt-1 font-mono text-xs">
            {formatVector3(eye.projectedFrontLocal)}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground text-2xs font-medium tracking-wide uppercase">
            Box Coord
          </p>
          <p className="text-foreground mt-1 font-mono text-xs">
            {formatBoxCoord(eye.normalizedBoxCoord)}
          </p>
          <p className="text-muted-foreground text-2xs mt-2 font-medium tracking-wide uppercase">
            Projected Box Coord
          </p>
          <p className="text-foreground mt-1 font-mono text-xs">
            {formatBoxCoord(eye.projectedBoxCoord)}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground text-2xs font-medium tracking-wide uppercase">
            Island Bounds Size
          </p>
          <p className="text-foreground mt-1 font-mono text-xs">
            {formatVector3(eye.boundsLocal.size)}
          </p>
          <p className="text-muted-foreground text-2xs mt-2 font-medium tracking-wide uppercase">
            Bounds Center
          </p>
          <p className="text-foreground mt-1 font-mono text-xs">
            {formatVector3(eye.boundsLocal.center)}
          </p>
        </div>
      </div>
    </div>
  );
}

export function TextureAnchorCard({
  label,
  anchor,
}: {
  label: string;
  anchor: AvatarFaceTextureAnchorsSnapshot["anchors"]["undereye"]["left"];
}) {
  if (!anchor) {
    return (
      <div className="border-border/60 bg-background/70 rounded-lg border p-3">
        <p className="text-foreground text-sm font-semibold">{label}</p>
        <p className="text-muted-foreground mt-1 text-xs">
          No texture anchor was resolved for this placement.
        </p>
      </div>
    );
  }

  return (
    <div className="border-border/60 bg-background/70 rounded-lg border p-3">
      <p className="text-foreground text-sm font-semibold">{label}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-muted-foreground text-2xs font-medium tracking-wide uppercase">
            Source
          </p>
          <p className="text-foreground mt-1 text-xs">
            {anchor.source}
            {anchor.side ? ` • ${anchor.side}` : ""}
          </p>
          <p className="text-muted-foreground text-2xs mt-2 font-medium tracking-wide uppercase">
            UV
          </p>
          <p className="text-foreground mt-1 font-mono text-xs">
            {anchor.uv.u.toFixed(4)}, {anchor.uv.v.toFixed(4)}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground text-2xs font-medium tracking-wide uppercase">
            Local Point
          </p>
          <p className="text-foreground mt-1 font-mono text-xs">
            {formatVector3(anchor.localPoint)}
          </p>
          <p className="text-muted-foreground text-2xs mt-2 font-medium tracking-wide uppercase">
            Ref Size UV
          </p>
          <p className="text-foreground mt-1 font-mono text-xs">
            {anchor.referenceSizeUv.width.toFixed(4)},{" "}
            {anchor.referenceSizeUv.height.toFixed(4)}
          </p>
        </div>
      </div>
    </div>
  );
}

type FaceTextureAnchorPreviewItem = {
  key: string;
  label: string;
  color: string;
  anchor: NonNullable<
    AvatarFaceTextureAnchorsSnapshot["anchors"]["mouth"]["center"]
  >;
};

type FaceTextureFlattenPreviewItem = {
  key: string;
  label: string;
  color: string;
  region: AvatarFaceTextureFlattenRegionSnapshot;
  shape: "ellipse" | "rect";
  isActive: boolean;
};

const texturePivotPreviewPoints: Array<{
  key: AvatarVFXTexturePivot;
  x: number;
  y: number;
}> = [
  { key: "top-left", x: 0, y: 0 },
  { key: "top-center", x: 0.5, y: 0 },
  { key: "top-right", x: 1, y: 0 },
  { key: "center-left", x: 0, y: 0.5 },
  { key: "center", x: 0.5, y: 0.5 },
  { key: "center-right", x: 1, y: 0.5 },
  { key: "bottom-left", x: 0, y: 1 },
  { key: "bottom-center", x: 0.5, y: 1 },
  { key: "bottom-right", x: 1, y: 1 },
];

function getFaceTextureAnchorPreviewItems(
  snapshot: AvatarFaceTextureAnchorsSnapshot,
): FaceTextureAnchorPreviewItem[] {
  return [
    {
      key: "undereye-left",
      label: "Undereye L",
      color: "#38bdf8",
      anchor: snapshot.anchors.undereye.left,
    },
    {
      key: "undereye-right",
      label: "Undereye R",
      color: "#0ea5e9",
      anchor: snapshot.anchors.undereye.right,
    },
    {
      key: "blush-left",
      label: "Blush L",
      color: "#f97316",
      anchor: snapshot.anchors.blush.left,
    },
    {
      key: "blush-right",
      label: "Blush R",
      color: "#ea580c",
      anchor: snapshot.anchors.blush.right,
    },
    {
      key: "mouth",
      label: "Mouth",
      color: "#a855f7",
      anchor: snapshot.anchors.mouth.center,
    },
  ].filter(
    (
      item,
    ): item is FaceTextureAnchorPreviewItem & {
      anchor: NonNullable<typeof item.anchor>;
    } => item.anchor !== null,
  );
}

function getFaceTextureFlattenPreviewItems(args: {
  anchors: AvatarFaceTextureAnchorsSnapshot;
  flatten: AvatarVFXFaceFlattenSnapshot | null;
}): FaceTextureFlattenPreviewItem[] {
  const { anchors, flatten } = args;
  return [
    {
      key: "flatten-sample",
      label: "Skin sample",
      color: "#10b981",
      region: anchors.flatten.sample.center,
      shape: "rect",
      isActive: false,
    },
    {
      key: "flatten-eye-left",
      label: "Flatten eye L",
      color: "#f43f5e",
      region: anchors.flatten.eyes.left,
      shape: "ellipse",
      isActive: Boolean(flatten?.activeEyes),
    },
    {
      key: "flatten-eye-right",
      label: "Flatten eye R",
      color: "#e11d48",
      region: anchors.flatten.eyes.right,
      shape: "ellipse",
      isActive: Boolean(flatten?.activeEyes),
    },
    {
      key: "flatten-mouth",
      label: "Flatten mouth",
      color: "#f59e0b",
      region: anchors.flatten.mouth.center,
      shape: "ellipse",
      isActive: Boolean(flatten?.activeMouth),
    },
  ].filter(
    (
      item,
    ): item is FaceTextureFlattenPreviewItem & {
      region: AvatarFaceTextureFlattenRegionSnapshot;
    } => item.region !== null,
  );
}

export function resolveFaceTexturePreview(args: {
  inspection: VRMInspectionSnapshot | null;
  faceTextureAnchors: AvatarFaceTextureAnchorsSnapshot | null;
}): VRMInspectionTexture | null {
  const { inspection, faceTextureAnchors } = args;
  if (!inspection || faceTextureAnchors?.status !== "ready") {
    return null;
  }

  const primitiveUsage =
    inspection.primitiveUsages.find(
      (usage) => usage.bindingKey === faceTextureAnchors.faceBindingKey,
    ) ?? null;
  const materialIndex =
    primitiveUsage?.materialIndex ??
    inspection.materials.find(
      (material) => material.name === faceTextureAnchors.faceMaterialName,
    )?.index ??
    null;
  if (materialIndex === null || materialIndex < 0) {
    return null;
  }

  const material =
    inspection.materials.find((entry) => entry.index === materialIndex) ?? null;
  if (!material || material.textureSlots.length === 0) {
    return null;
  }

  const preferredTextureSlot =
    material.textureSlots.find((slot) => /basecolor|main/i.test(slot.slot)) ??
    material.textureSlots[0];
  return (
    inspection.textures.find(
      (texture) => texture.index === preferredTextureSlot.textureIndex,
    ) ?? null
  );
}

export function FaceTextureAnchorUvPreview({
  faceTextureAnchors,
  flattenState,
  previewTexture,
  onOpenPreview,
}: {
  faceTextureAnchors: AvatarFaceTextureAnchorsSnapshot;
  flattenState: AvatarVFXFaceFlattenSnapshot | null;
  previewTexture: VRMInspectionTexture | null;
  onOpenPreview?: (() => void) | null;
}) {
  const anchorItems = useMemo(
    () => getFaceTextureAnchorPreviewItems(faceTextureAnchors),
    [faceTextureAnchors],
  );
  const flattenItems = useMemo(
    () =>
      getFaceTextureFlattenPreviewItems({
        anchors: faceTextureAnchors,
        flatten: flattenState,
      }),
    [faceTextureAnchors, flattenState],
  );
  if (anchorItems.length === 0 && flattenItems.length === 0) {
    return null;
  }

  const aspectRatio =
    typeof previewTexture?.pixelWidth === "number" &&
    previewTexture.pixelWidth > 0 &&
    typeof previewTexture?.pixelHeight === "number" &&
    previewTexture.pixelHeight > 0
      ? previewTexture.pixelWidth / previewTexture.pixelHeight
      : 1;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-foreground text-sm font-semibold">UV preview</p>
          <p className="text-muted-foreground text-xs">
            Point = anchor UV. Box = cached reference size used as the decal
            placement basis. Dashed sample/ellipse overlays = flatten regions.
            Small dots = selectable pivot positions within decal boxes.
          </p>
        </div>
        {previewTexture?.previewUrl && onOpenPreview ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onOpenPreview}
          >
            Open texture
          </Button>
        ) : null}
      </div>
      <div
        className="border-border/60 bg-muted/20 relative w-full overflow-hidden rounded-lg border"
        style={{ aspectRatio }}
      >
        {previewTexture?.previewUrl ? (
          <AppImage
            src={previewTexture.previewUrl}
            alt={previewTexture.name ?? "Face texture UV preview"}
            fill
            unoptimized
            className="object-contain"
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{
              backgroundColor: "rgba(255,255,255,0.02)",
              backgroundImage: [
                "linear-gradient(to right, rgba(255,255,255,0.08) 1px, transparent 1px)",
                "linear-gradient(to bottom, rgba(255,255,255,0.08) 1px, transparent 1px)",
                "linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px)",
                "linear-gradient(to bottom, rgba(255,255,255,0.05) 1px, transparent 1px)",
              ].join(", "),
              backgroundSize: "25% 100%, 100% 25%, 10% 100%, 100% 10%",
            }}
          />
        )}
        <div className="absolute inset-0">
          {anchorItems.map((item) => {
            const { anchor } = item;
            const rectLeft = anchor.uv.u - anchor.referenceSizeUv.width * 0.5;
            const rectTop = anchor.uv.v - anchor.referenceSizeUv.height * 0.5;
            return (
              <div key={item.key}>
                <div
                  className="absolute rounded-sm border"
                  style={{
                    left: `${rectLeft * 100}%`,
                    top: `${rectTop * 100}%`,
                    width: `${anchor.referenceSizeUv.width * 100}%`,
                    height: `${anchor.referenceSizeUv.height * 100}%`,
                    borderColor: item.color,
                    backgroundColor: `${item.color}12`,
                  }}
                />
                {texturePivotPreviewPoints.map((pivot) => (
                  <div
                    key={`${item.key}:${pivot.key}`}
                    className="border-background/80 absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full border"
                    title={`${item.label} • ${pivot.key}`}
                    style={{
                      left: `${(rectLeft + anchor.referenceSizeUv.width * pivot.x) * 100}%`,
                      top: `${(rectTop + anchor.referenceSizeUv.height * pivot.y) * 100}%`,
                      backgroundColor:
                        pivot.key === "center" ? item.color : `${item.color}99`,
                    }}
                  />
                ))}
                <div
                  className="border-background absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-sm"
                  style={{
                    left: `${anchor.uv.u * 100}%`,
                    top: `${anchor.uv.v * 100}%`,
                    backgroundColor: item.color,
                  }}
                />
                <div
                  className="bg-background/90 text-2xs absolute -translate-x-1/2 rounded px-1.5 py-0.5 font-mono font-medium shadow-sm"
                  style={{
                    left: `${anchor.uv.u * 100}%`,
                    top: `calc(${anchor.uv.v * 100}% + 10px)`,
                    color: item.color,
                  }}
                >
                  {item.label}
                </div>
              </div>
            );
          })}
          {flattenItems.map((item) => {
            const rectLeft =
              item.region.uv.u - item.region.referenceSizeUv.width * 0.5;
            const rectTop =
              item.region.uv.v - item.region.referenceSizeUv.height * 0.5;
            return (
              <div key={item.key}>
                <div
                  className={cn(
                    "absolute border-2",
                    item.shape === "ellipse"
                      ? "rounded-full"
                      : "rounded-sm border-dashed",
                  )}
                  style={{
                    left: `${rectLeft * 100}%`,
                    top: `${rectTop * 100}%`,
                    width: `${item.region.referenceSizeUv.width * 100}%`,
                    height: `${item.region.referenceSizeUv.height * 100}%`,
                    borderColor: item.color,
                    backgroundColor: item.isActive
                      ? `${item.color}26`
                      : `${item.color}10`,
                    opacity: item.isActive ? 1 : 0.72,
                  }}
                />
                <div
                  className="bg-background/90 text-2xs absolute -translate-x-1/2 rounded px-1.5 py-0.5 font-mono font-medium shadow-sm"
                  style={{
                    left: `${item.region.uv.u * 100}%`,
                    top: `calc(${(rectTop + item.region.referenceSizeUv.height) * 100}% + 8px)`,
                    color: item.color,
                  }}
                >
                  {item.label}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {anchorItems.map((item) => (
          <div
            key={item.key}
            className="border-border/60 bg-background/70 inline-flex items-center gap-2 rounded-full border px-2.5 py-1"
          >
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-foreground text-2xs font-medium">
              {item.label}
            </span>
          </div>
        ))}
        {flattenItems.map((item) => (
          <div
            key={item.key}
            className="border-border/60 bg-background/70 inline-flex items-center gap-2 rounded-full border px-2.5 py-1"
          >
            <span
              className={cn(
                "h-2.5 w-2.5",
                item.shape === "ellipse" ? "rounded-full" : "rounded-sm",
              )}
              style={{ backgroundColor: item.color }}
            />
            <span className="text-foreground text-2xs font-medium">
              {item.label}
              {item.isActive ? " • active" : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

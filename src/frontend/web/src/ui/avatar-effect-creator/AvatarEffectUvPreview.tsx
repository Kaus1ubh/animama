import { ScanFaceIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { Avatar } from "@/lib/avatar";
import type { AvatarVFXController } from "@/lib/avatar/vfx/AvatarVFXController";
import type { AvatarVFXGuideSurface } from "@/lib/avatar/vfx/placement-guide-types";
import type { AvatarVFXCatalogEntry } from "@/lib/avatar/vfx/types";
import { Button } from "@/ui/components/button";
import { Checkbox } from "@/ui/components/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/ui/components/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select";
import { startAvatarEffectUvPreview } from "./avatarEffectUvDrawing";

type AvatarEffectUvPreviewProps = {
  avatar: Avatar | null;
  effect: AvatarVFXCatalogEntry | null;
  appliedId: string;
};

/** Independent, read-only texture view; live drawing runs only while the popover is open. */
export function AvatarEffectUvPreview({
  avatar,
  effect,
  appliedId,
}: AvatarEffectUvPreviewProps) {
  const controller = avatar?.vfxController;
  if (!controller || !effect) return null;
  return (
    <AvailableUvPreview
      controller={controller}
      effect={effect}
      appliedId={appliedId}
    />
  );
}

function surfaceLabel(surface: AvatarVFXGuideSurface): string {
  const slot = surface.slot === "map" ? "Base color" : "Shade color";
  return `${surface.materialName || "Material"} · ${slot}`;
}

function AvailableUvPreview({
  controller,
  effect,
  appliedId,
}: {
  controller: AvatarVFXController;
  effect: AvatarVFXCatalogEntry;
  appliedId: string;
}) {
  const [open, setOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [showCoverage, setShowCoverage] = useState(false);
  const headingId = useId();
  const descriptionId = useId();
  const coverageId = useId();
  const subscribe = useCallback(
    (listener: () => void) => controller.subscribe(listener),
    [controller],
  );
  const getSnapshot = useCallback(() => controller.getSnapshot(), [controller]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const projection = useMemo(
    () => controller.getPlacementGuides(effect, appliedId),
    // Snapshot identity versions mutable controller state without tracking animation ticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controller, effect, appliedId, snapshot],
  );
  const surface =
    projection.surfaces.find((item) => item.key === selectedKey) ??
    projection.surfaces[0];
  const key = surface?.key;
  const readSurface = useCallback(
    () =>
      controller
        .getPlacementGuides(effect, appliedId)
        .surfaces.find((item) => item.key === key),
    [controller, effect, appliedId, key],
  );
  if (!surface) return null;
  const hasCoverage = surface.guides.some(
    (guide) => guide.kind === "flatten" || guide.kind === "sample",
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="UV preview"
          title="UV preview"
        >
          <ScanFaceIcon className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        avoidSidebar
        className="max-h-[min(32rem,var(--radix-popover-content-available-height))] w-80 max-w-[calc(100vw-1rem)] space-y-3 overflow-y-auto p-3"
        aria-labelledby={headingId}
        aria-describedby={descriptionId}
      >
        <div>
          <p id={headingId} className="text-sm font-medium">
            UV preview
          </p>
          <p id={descriptionId} className="text-muted-foreground mt-1 text-xs">
            Reference areas guide placement; they do not clip artwork. Left and
            right follow the avatar.
          </p>
        </div>
        {projection.surfaces.length > 1 ? (
          <Select value={surface.key} onValueChange={setSelectedKey}>
            <SelectTrigger
              className="h-8 w-full text-xs"
              aria-label="UV preview material and texture"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {projection.surfaces.map((item) => (
                <SelectItem key={item.key} value={item.key}>
                  {surfaceLabel(item)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="text-muted-foreground text-xs break-words">
            {surfaceLabel(surface)}
          </p>
        )}
        {open ? (
          <UvCanvas
            readSurface={readSurface}
            surface={surface}
            showCoverage={showCoverage}
          />
        ) : null}
        <div
          className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-2xs"
          aria-label="UV guide legend"
        >
          <span>
            <span className="mr-1 inline-block w-3 border-t border-dashed border-sky-600 align-middle" />
            Reference
          </span>
          <span>
            <span className="mr-1 inline-block w-3 border-t-2 border-pink-600 align-middle" />
            Artwork
          </span>
          <span>◇ Pivot</span>
        </div>
        {hasCoverage ? (
          <label
            htmlFor={coverageId}
            className="flex items-center gap-2 text-xs"
          >
            <Checkbox
              id={coverageId}
              checked={showCoverage}
              onCheckedChange={(checked) => setShowCoverage(checked === true)}
            />
            Skin coverage
          </label>
        ) : null}
        {!projection.active ? (
          <p className="text-muted-foreground text-xs">
            No live artwork while the effect is inactive.
          </p>
        ) : null}
        {projection.messages.length > 0 ? (
          <p className="text-muted-foreground text-xs" role="status">
            {projection.messages.join(" ")}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function UvCanvas({
  readSurface,
  surface,
  showCoverage,
}: {
  readSurface: () => AvatarVFXGuideSurface | undefined;
  surface: AvatarVFXGuideSurface;
  showCoverage: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return startAvatarEffectUvPreview(canvas, readSurface, showCoverage, {
      request: (callback) => requestAnimationFrame(callback),
      cancel: (handle) => cancelAnimationFrame(handle),
    });
  }, [readSurface, showCoverage]);
  return (
    <canvas
      ref={canvasRef}
      className="border-border bg-muted/30 block h-auto w-full rounded-md border"
      style={{ aspectRatio: `${surface.width} / ${surface.height}` }}
      aria-label={`${surfaceLabel(surface)} texture with selected placement guides`}
      role="img"
    />
  );
}

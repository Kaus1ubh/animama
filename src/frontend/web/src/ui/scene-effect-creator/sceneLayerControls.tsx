import {
  AlertTriangleIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  FileImageIcon,
  GripVerticalIcon,
  ImagePlusIcon,
  LoaderCircleIcon,
  PlusIcon,
  ShuffleIcon,
  Trash2Icon,
} from "lucide-react";
import {
  defaultSceneLinesScreen,
  defaultSceneRaysScreen,
  SCENE_EFFECT_IMAGE_TYPES,
  type SceneEffectEditorBackground,
  type SceneEffectEditorMarqueeItem,
  type SceneEffectEditorScatter,
} from "@/lib/scene-vfx/editor";
import { SCENE_EFFECT_LIMITS } from "@/lib/scene-vfx/limits";
import {
  sceneStickerFamilies,
  type SceneSticker,
} from "@/lib/scene-vfx/stickers";
import {
  SCENE_BACKGROUND_DIRECTIONS,
  SCENE_BACKGROUND_GRADIENT_TYPES,
  SCENE_BACKGROUND_SCATTER_PULSES,
  SCENE_BACKGROUND_SCREEN_KINDS,
  type SceneBackgroundDirection,
} from "@/lib/scene-vfx/types";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";
import { Label } from "@/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select";
import {
  CreatorField as Field,
  CreatorNumberField as NumberField,
  CreatorToggleRow as ToggleRow,
} from "@/ui/content-creator";

/**
 * Scene creator controls for the background layers: the item list shared by
 * the marquee and the scatter layers, and the inspectors of the optional
 * layers (C1–C6). Ranges follow `SCENE_EFFECT_LIMITS`, the limits the
 * creator's checks and the backend apply.
 */

const L = SCENE_EFFECT_LIMITS;

export function humanize(value: string): string {
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      <div className="grid grid-cols-[44px_1fr] gap-2">
        <Input
          type="color"
          className="p-1"
          value={value}
          aria-label={`${label} picker`}
          onChange={(event) => onChange(event.target.value)}
        />
        <Input
          value={value}
          maxLength={7}
          aria-label={label}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </Field>
  );
}

function SelectField<T extends string>({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: T;
  values: readonly T[];
  onChange: (value: T) => void;
}) {
  return (
    <Field label={label}>
      <Select value={value} onValueChange={(next) => onChange(next as T)}>
        <SelectTrigger size="sm" className="w-full text-xs" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {values.map((option) => (
            <SelectItem key={option} value={option}>
              {humanize(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

/** A minimum and a maximum side by side. */
function RangeFields({
  label,
  low,
  high,
  range,
  step,
  onChange,
}: {
  label: string;
  low: number;
  high: number;
  range: readonly [number, number];
  step: number;
  onChange: (low: number, high: number) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <NumberField
        label={`${label} min`}
        value={low}
        min={range[0]}
        max={range[1]}
        step={step}
        onChange={(value) => onChange(value, Math.max(value, high))}
      />
      <NumberField
        label={`${label} max`}
        value={high}
        min={range[0]}
        max={range[1]}
        step={step}
        onChange={(value) => onChange(Math.min(low, value), value)}
      />
    </div>
  );
}

function SeedField({
  value,
  onChange,
}: {
  value: number;
  onChange: (seed: number) => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-end gap-2">
      <NumberField
        label="Seed"
        value={value}
        min={0}
        max={L.seed[1]}
        step={1}
        onChange={onChange}
      />
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        aria-label="New random seed"
        onClick={() => onChange(Math.floor(Math.random() * 1_000_000))}
      >
        <ShuffleIcon />
      </Button>
    </div>
  );
}

/** Choose a private image (PNG, JPEG, WebP or static SVG). */
function ImageInput({
  label,
  busy,
  invalid,
  onChooseImage,
}: {
  label: string;
  busy: boolean;
  invalid?: boolean;
  onChooseImage: (file: File) => void;
}) {
  return (
    <label
      className={cn(
        "border-border/70 bg-background/55 hover:bg-accent/50 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed p-3 text-sm transition",
        invalid &&
          "border-destructive bg-destructive/5 text-destructive ring-destructive/40 ring-1",
      )}
    >
      {busy ? (
        <LoaderCircleIcon className="size-4 animate-spin" />
      ) : (
        <ImagePlusIcon className="size-4" />
      )}
      {label}
      <input
        className="sr-only"
        type="file"
        accept={[...SCENE_EFFECT_IMAGE_TYPES].join(",")}
        aria-invalid={invalid}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onChooseImage(file);
          event.currentTarget.value = "";
        }}
      />
    </label>
  );
}

export type SceneImageControls = {
  imageBusy: boolean;
  imageError: string | null;
  imageUrls: ReadonlyMap<string, string>;
  /** Whether a Save refused the image files. */
  filesInvalid: boolean;
  onChooseImage: (file: File) => void;
  /** Add a built-in sticker as the effect's own image. */
  onChooseSticker: (sticker: SceneSticker) => void;
};

function SceneItemRow({
  item,
  imageUrl,
  first,
  last,
  onMove,
  onRemove,
}: {
  item: SceneEffectEditorMarqueeItem;
  imageUrl?: string;
  first: boolean;
  last: boolean;
  onMove: (offset: -1 | 1) => void;
  onRemove: () => void;
}) {
  // A Twemoji item from before the sticker set: shown as missing.
  const missing = item.kind === "emoji";
  return (
    <div
      className={cn(
        "border-border/70 bg-background/55 flex items-center gap-2 rounded-lg border p-2",
        missing && "border-destructive bg-destructive/5",
      )}
    >
      <GripVerticalIcon className="text-muted-foreground size-4" />
      <div className="bg-muted flex size-8 items-center justify-center overflow-hidden rounded-md">
        {missing ? (
          <AlertTriangleIcon className="text-destructive size-4" />
        ) : imageUrl ? (
          <img src={imageUrl} alt="" className="size-full object-contain" />
        ) : (
          <FileImageIcon className="text-muted-foreground size-4" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{item.label}</div>
        <div className="text-muted-foreground text-2xs truncate">
          {item.kind === "image" ? item.image.logicalName : "Missing emoji"}
        </div>
      </div>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        disabled={first}
        aria-label={`Move ${item.label} up`}
        onClick={() => onMove(-1)}
      >
        <ArrowUpIcon />
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        disabled={last}
        aria-label={`Move ${item.label} down`}
        onClick={() => onMove(1)}
      >
        <ArrowDownIcon />
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={`Remove ${item.label}`}
        onClick={onRemove}
      >
        <Trash2Icon />
      </Button>
    </div>
  );
}

/**
 * The items of a marquee or scatter layer: Animama stickers and private
 * images, each the effect's own image. A legacy emoji item is shown as
 * missing until it is replaced or removed.
 */
export function SceneItemsEditor({
  items,
  maxItems,
  images,
  onItemsChange,
}: {
  items: SceneEffectEditorMarqueeItem[];
  maxItems: number;
  images: SceneImageControls;
  onItemsChange: (items: SceneEffectEditorMarqueeItem[]) => void;
}) {
  const full = items.length >= maxItems;
  const missing = items.some((item) => item.kind === "emoji");
  return (
    <div className="space-y-3">
      <Label>Items</Label>
      {items.length ? (
        <div className="space-y-2">
          {items.map((item, index) => (
            <SceneItemRow
              key={item.id}
              item={item}
              imageUrl={
                item.kind === "image"
                  ? images.imageUrls.get(item.image.logicalName)
                  : undefined
              }
              first={index === 0}
              last={index === items.length - 1}
              onMove={(offset) =>
                onItemsChange(moveItem(items, index, index + offset))
              }
              onRemove={() =>
                onItemsChange(items.filter((_, other) => other !== index))
              }
            />
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          Add a sticker or private image.
        </p>
      )}
      {missing ? (
        <p role="alert" className="text-destructive text-xs">
          Animama no longer provides emoji items. Replace each with a sticker or
          image, or remove it, before saving.
        </p>
      ) : null}
      <StickerPicker
        disabled={full || images.imageBusy}
        onChoose={images.onChooseSticker}
      />
      {full ? null : (
        <ImageInput
          label="Add private image"
          busy={images.imageBusy}
          invalid={images.filesInvalid}
          onChooseImage={images.onChooseImage}
        />
      )}
      {images.imageError ? (
        <p className="text-destructive text-xs">{images.imageError}</p>
      ) : null}
    </div>
  );
}

/** Animama's built-in stickers, grouped by family, as thumbnail buttons. */
function StickerPicker({
  disabled,
  onChoose,
}: {
  disabled: boolean;
  onChoose: (sticker: SceneSticker) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>Add a sticker</Label>
      {sceneStickerFamilies().map(({ family, stickers }) => (
        <section key={family} className="space-y-1">
          <div className="text-muted-foreground text-2xs font-semibold uppercase">
            {family}
          </div>
          <div className="grid grid-cols-6 gap-1.5">
            {stickers.map((sticker) => (
              <button
                key={sticker.id}
                type="button"
                disabled={disabled}
                aria-label={`Add ${sticker.label} sticker`}
                title={sticker.label}
                className="border-border/70 bg-background/55 hover:bg-accent/50 flex aspect-square items-center justify-center rounded-md border p-1 transition disabled:pointer-events-none disabled:opacity-50"
                onClick={() => onChoose(sticker)}
              >
                <img
                  src={sticker.url}
                  alt=""
                  loading="lazy"
                  className="size-full object-contain"
                />
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

type BackgroundProps = {
  background: SceneEffectEditorBackground;
  onBackground: (patch: Partial<SceneEffectEditorBackground>) => void;
};

/** C1: a linear or radial gradient of 2–4 stops over the solid fill. */
export function GradientInspector({
  background,
  onBackground,
}: BackgroundProps) {
  const gradient = background.gradient;
  const patch = (change: Partial<typeof gradient>) =>
    onBackground({ gradient: { ...gradient, ...change } });
  return (
    <div className="space-y-3">
      <ToggleRow
        label="Gradient enabled"
        checked={gradient.enabled}
        onChecked={(enabled) => patch({ enabled })}
      />
      <SelectField
        label="Gradient type"
        value={gradient.type}
        values={SCENE_BACKGROUND_GRADIENT_TYPES}
        onChange={(type) => patch({ type })}
      />
      {gradient.type === "linear" ? (
        <NumberField
          label="Angle (deg)"
          value={gradient.angleDeg}
          min={L.gradient.angleDeg[0]}
          max={L.gradient.angleDeg[1]}
          step={1}
          onChange={(angleDeg) => patch({ angleDeg })}
        />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Centre X"
            value={gradient.centerX}
            min={0}
            max={1}
            step={0.01}
            onChange={(centerX) => patch({ centerX })}
          />
          <NumberField
            label="Centre Y"
            value={gradient.centerY}
            min={0}
            max={1}
            step={0.01}
            onChange={(centerY) => patch({ centerY })}
          />
        </div>
      )}
      <Label>Stops</Label>
      {gradient.stops.map((stop, index) => (
        <div
          key={index}
          className="grid grid-cols-[1fr_88px_auto] items-end gap-2"
        >
          <ColorField
            label={`Stop ${index + 1} colour`}
            value={stop.color}
            onChange={(color) =>
              patch({
                stops: gradient.stops.map((other, at) =>
                  at === index ? { ...other, color } : other,
                ),
              })
            }
          />
          <NumberField
            label="At"
            value={stop.position}
            min={0}
            max={1}
            step={0.01}
            onChange={(position) =>
              patch({
                stops: gradient.stops.map((other, at) =>
                  at === index ? { ...other, position } : other,
                ),
              })
            }
          />
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={gradient.stops.length <= L.gradient.stops[0]}
            aria-label={`Remove stop ${index + 1}`}
            onClick={() =>
              patch({ stops: gradient.stops.filter((_, at) => at !== index) })
            }
          >
            <Trash2Icon />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={gradient.stops.length >= L.gradient.stops[1]}
        onClick={() =>
          patch({
            stops: [
              ...gradient.stops,
              { color: gradient.stops.at(-1)?.color ?? "#ffffff", position: 1 },
            ],
          })
        }
      >
        <PlusIcon /> Add stop
      </Button>
    </div>
  );
}

function MotionFields({
  direction,
  speed,
  maxSpeed,
  onChange,
}: {
  direction: SceneBackgroundDirection;
  speed: number;
  maxSpeed: number;
  onChange: (change: {
    direction?: SceneBackgroundDirection;
    speedPxPerSec?: number;
  }) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <SelectField
        label="Direction"
        value={direction}
        values={SCENE_BACKGROUND_DIRECTIONS}
        onChange={(next) => onChange({ direction: next })}
      />
      <NumberField
        label="Speed (px/s)"
        value={speed}
        min={0}
        max={maxSpeed}
        step={1}
        onChange={(speedPxPerSec) => onChange({ speedPxPerSec })}
      />
    </div>
  );
}

/** C2: one private image tiled over the view, drifting. */
export function TileInspector({
  background,
  onBackground,
  images,
}: BackgroundProps & { images: SceneImageControls }) {
  const tile = background.tile;
  const patch = (change: Partial<typeof tile>) =>
    onBackground({ tile: { ...tile, ...change } });
  const url = tile.image ? images.imageUrls.get(tile.image.logicalName) : null;
  return (
    <div className="space-y-3">
      <ToggleRow
        label="Tile enabled"
        checked={tile.enabled}
        onChecked={(enabled) => patch({ enabled })}
      />
      {tile.image ? (
        <div className="border-border/70 bg-background/55 flex items-center gap-2 rounded-lg border p-2">
          <div className="bg-muted flex size-8 items-center justify-center overflow-hidden rounded-md">
            {url ? (
              <img src={url} alt="" className="size-full object-contain" />
            ) : (
              <FileImageIcon className="text-muted-foreground size-4" />
            )}
          </div>
          <div className="min-w-0 flex-1 truncate text-sm">
            {tile.image.logicalName}
          </div>
        </div>
      ) : null}
      <ImageInput
        label={tile.image ? "Replace tile image" : "Choose tile image"}
        busy={images.imageBusy}
        invalid={images.filesInvalid}
        onChooseImage={images.onChooseImage}
      />
      {images.imageError ? (
        <p className="text-destructive text-xs">{images.imageError}</p>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label="Tile size (px)"
          value={tile.size}
          min={L.tile.size[0]}
          max={L.tile.size[1]}
          step={1}
          onChange={(size) => patch({ size })}
        />
        <NumberField
          label="Opacity"
          value={tile.opacity}
          min={0}
          max={1}
          step={0.05}
          onChange={(opacity) => patch({ opacity })}
        />
      </div>
      <MotionFields
        direction={tile.direction}
        speed={tile.speedPxPerSec}
        maxSpeed={L.tile.speedPxPerSec[1]}
        onChange={patch}
      />
    </div>
  );
}

/** C3: procedural rays or lines. */
export function ScreenInspector({ background, onBackground }: BackgroundProps) {
  const screen = background.screen;
  const patch = (change: Partial<typeof screen>) =>
    onBackground({ screen: { ...screen, ...change } as typeof screen });
  const limits = screen.kind === "rays" ? L.rays : L.lines;
  return (
    <div className="space-y-3">
      <ToggleRow
        label="Screen enabled"
        checked={screen.enabled}
        onChecked={(enabled) => patch({ enabled })}
      />
      <SelectField
        label="Screen kind"
        value={screen.kind}
        values={SCENE_BACKGROUND_SCREEN_KINDS}
        onChange={(kind) =>
          onBackground({
            screen:
              kind === "rays"
                ? defaultSceneRaysScreen(screen.enabled)
                : defaultSceneLinesScreen(screen.enabled),
          })
        }
      />
      <ColorField
        label="Screen colour"
        value={screen.color}
        onChange={(color) => patch({ color })}
      />
      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label={screen.kind === "rays" ? "Rays" : "Lines"}
          value={screen.count}
          min={limits.count[0]}
          max={limits.count[1]}
          step={1}
          onChange={(count) => patch({ count })}
        />
        <NumberField
          label="Opacity"
          value={screen.opacity}
          min={0}
          max={1}
          step={0.05}
          onChange={(opacity) => patch({ opacity })}
        />
      </div>
      {screen.kind === "rays" ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Centre X"
              value={screen.centerX}
              min={0}
              max={1}
              step={0.01}
              onChange={(centerX) => patch({ centerX })}
            />
            <NumberField
              label="Centre Y"
              value={screen.centerY}
              min={0}
              max={1}
              step={0.01}
              onChange={(centerY) => patch({ centerY })}
            />
            <NumberField
              label="Seconds per turn (0 still)"
              value={screen.turnSeconds}
              min={-L.rays.turnSeconds[1]}
              max={L.rays.turnSeconds[1]}
              step={1}
              onChange={(turnSeconds) => patch({ turnSeconds })}
            />
            <NumberField
              label="Throbs per second"
              value={screen.throbPerSec}
              min={0}
              max={L.rays.throbPerSec[1]}
              step={0.1}
              onChange={(throbPerSec) => patch({ throbPerSec })}
            />
          </div>
          <ToggleRow
            label="Spiky starburst"
            checked={screen.spiky}
            onChecked={(spiky) => patch({ spiky })}
          />
        </>
      ) : (
        <>
          <RangeFields
            label="Length"
            low={screen.minLength}
            high={screen.maxLength}
            range={L.lines.length}
            step={0.05}
            onChange={(minLength, maxLength) => patch({ minLength, maxLength })}
          />
          <RangeFields
            label="Width (px)"
            low={screen.minWidthPx}
            high={screen.maxWidthPx}
            range={L.lines.widthPx}
            step={0.5}
            onChange={(minWidthPx, maxWidthPx) =>
              patch({ minWidthPx, maxWidthPx })
            }
          />
          <NumberField
            label="Seconds per sway (0 still)"
            value={screen.swaySeconds}
            min={0}
            max={L.lines.swaySeconds[1]}
            step={1}
            onChange={(swaySeconds) => patch({ swaySeconds })}
          />
        </>
      )}
      <SeedField value={screen.seed} onChange={(seed) => patch({ seed })} />
    </div>
  );
}

/** C4 and C5: one scatter layer's items, variation and motion. */
export function ScatterInspector({
  layer,
  index,
  images,
  onLayer,
  onItemsChange,
  onRemove,
}: {
  layer: SceneEffectEditorScatter;
  index: number;
  images: SceneImageControls;
  onLayer: (layer: SceneEffectEditorScatter) => void;
  onItemsChange: (items: SceneEffectEditorMarqueeItem[]) => void;
  onRemove: () => void;
}) {
  const S = L.scatter;
  const patch = (change: Partial<SceneEffectEditorScatter>) =>
    onLayer({ ...layer, ...change });
  return (
    <div className="space-y-3">
      <ToggleRow
        label={`Scatter ${index + 1} enabled`}
        checked={layer.enabled}
        onChecked={(enabled) => patch({ enabled })}
      />
      <SceneItemsEditor
        items={layer.items}
        maxItems={S.items[1]}
        images={images}
        onItemsChange={onItemsChange}
      />
      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label="Items shown"
          value={layer.count}
          min={S.count[0]}
          max={S.count[1]}
          step={1}
          onChange={(count) => patch({ count })}
        />
        <SelectField
          label="Pulse"
          value={layer.pulse}
          values={SCENE_BACKGROUND_SCATTER_PULSES}
          onChange={(pulse) => patch({ pulse })}
        />
      </div>
      <RangeFields
        label="Size (px)"
        low={layer.minSize}
        high={layer.maxSize}
        range={S.sizePx}
        step={1}
        onChange={(minSize, maxSize) => patch({ minSize, maxSize })}
      />
      <RangeFields
        label="Rotation (deg)"
        low={layer.minRotationDeg}
        high={layer.maxRotationDeg}
        range={S.rotationDeg}
        step={1}
        onChange={(minRotationDeg, maxRotationDeg) =>
          patch({ minRotationDeg, maxRotationDeg })
        }
      />
      <RangeFields
        label="Opacity"
        low={layer.minOpacity}
        high={layer.maxOpacity}
        range={S.opacity}
        step={0.05}
        onChange={(minOpacity, maxOpacity) => patch({ minOpacity, maxOpacity })}
      />
      <RangeFields
        label="Region (top to bottom)"
        low={layer.regionTop}
        high={layer.regionBottom}
        range={S.region}
        step={0.05}
        onChange={(regionTop, regionBottom) =>
          patch({ regionTop, regionBottom })
        }
      />
      <ToggleRow
        label="Keep the face clear"
        description="Still items, and items drifting up or down, stay out of the column behind the head."
        checked={layer.keepFaceClear}
        onChecked={(keepFaceClear) => patch({ keepFaceClear })}
      />
      <MotionFields
        direction={layer.direction}
        speed={layer.speedPxPerSec}
        maxSpeed={S.speedPxPerSec[1]}
        onChange={patch}
      />
      <RangeFields
        label="Spin (deg/s)"
        low={layer.minSpinDegPerSec}
        high={layer.maxSpinDegPerSec}
        range={S.spinDegPerSec}
        step={1}
        onChange={(minSpinDegPerSec, maxSpinDegPerSec) =>
          patch({ minSpinDegPerSec, maxSpinDegPerSec })
        }
      />
      <ToggleRow
        label="Alternate spin"
        checked={layer.alternateSpin}
        onChecked={(alternateSpin) => patch({ alternateSpin })}
      />
      <SeedField value={layer.seed} onChange={(seed) => patch({ seed })} />
      <Button type="button" variant="outline" size="sm" onClick={onRemove}>
        <Trash2Icon /> Remove scatter layer
      </Button>
    </div>
  );
}

/** C6: one fade from a colour when the Scene starts. */
export function FlashInspector({ background, onBackground }: BackgroundProps) {
  const flash = background.flash;
  const patch = (change: Partial<typeof flash>) =>
    onBackground({ flash: { ...flash, ...change } });
  return (
    <div className="space-y-3">
      <ToggleRow
        label="Entry flash enabled"
        checked={flash.enabled}
        onChecked={(enabled) => patch({ enabled })}
      />
      <ColorField
        label="Flash colour"
        value={flash.color}
        onChange={(color) => patch({ color })}
      />
      <NumberField
        label="Fade (ms)"
        value={flash.durationMs}
        min={L.flash.durationMs[0]}
        max={L.flash.durationMs[1]}
        step={10}
        onChange={(durationMs) => patch({ durationMs })}
      />
    </div>
  );
}

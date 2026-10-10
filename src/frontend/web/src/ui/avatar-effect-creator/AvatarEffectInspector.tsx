import { XIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";

import type {
  AvatarEffectEditorAction,
  AvatarEffectEditorDocument,
} from "@/lib/avatar/vfx/editor";
import { cn } from "@/lib/utils";
import {
  CreatorField as Field,
  CreatorNumberField as NumberField,
} from "@/ui/content-creator";
import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/components/tabs";
import { AvatarEffectAnimationControls } from "./AvatarEffectAnimationControls";
import {
  placementOffsetPatch,
  placementRotationPatch,
  placementScalePatch,
  placementUnitLabel,
  positionHint,
  positionUnit,
  resolvedPlacement,
  sizeUnit,
} from "./avatarEffectPlacement";

type Dispatch = (action: AvatarEffectEditorAction) => void;

export type AvatarEffectInspectorTab = "placement" | "look" | "motion";

/** The Inspector tab that holds the control for a definition path. */
export function inspectorTabForField(
  field: string | null,
): AvatarEffectInspectorTab | null {
  if (!field) return null;
  const path = field.replace(/^definition\.?/, "");
  if (/^attachment\.(offset|scale|size|rotationDeg)/.test(path))
    return "placement";
  if (path.startsWith("appearance")) return "look";
  if (path.startsWith("motion")) return "motion";
  return null;
}

/**
 * Inspector: the numeric equivalents of dragging, scaling and turning the art
 * on the preview, plus its look and motion.
 */
export function AvatarEffectInspector({
  document,
  invalidField,
  onDispatch,
}: {
  document: AvatarEffectEditorDocument;
  invalidField: string | null;
  onDispatch: Dispatch;
}) {
  const { t } = useTranslation("effects");
  const [tab, setTab] = useState<AvatarEffectInspectorTab>("placement");
  // A failed Save opens the tab that holds the named setting.
  const fieldTab = inspectorTabForField(invalidField);
  useEffect(() => {
    if (fieldTab) setTab(fieldTab);
  }, [fieldTab, invalidField]);
  const hasPlacement = document.attachment.kind !== "silhouette";
  const current = !hasPlacement && tab === "placement" ? "look" : tab;
  return (
    <Tabs
      value={current}
      onValueChange={(value) => setTab(value as AvatarEffectInspectorTab)}
    >
      <TabsList className="grid h-9 w-full grid-cols-3">
        <TabsTrigger
          value="placement"
          disabled={!hasPlacement}
          className="min-w-0 px-1 text-xs"
        >
          {t("avatar.inspector.tabs.placement")}
        </TabsTrigger>
        <TabsTrigger value="look" className="min-w-0 px-1 text-xs">
          {t("avatar.inspector.tabs.look")}
        </TabsTrigger>
        <TabsTrigger value="motion" className="min-w-0 px-1 text-xs">
          {t("avatar.inspector.tabs.motion")}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="placement" className="mt-3 space-y-3">
        <PlacementFields
          document={document}
          invalidField={invalidField}
          onDispatch={onDispatch}
        />
      </TabsContent>
      <TabsContent value="look" className="mt-3 space-y-3">
        <LookFields
          document={document}
          invalidField={invalidField}
          onDispatch={onDispatch}
        />
      </TabsContent>
      <TabsContent value="motion" className="mt-3 space-y-3">
        <AvatarEffectAnimationControls
          motion={document.motion}
          offsetUnit={positionUnit(document.attachment.kind)}
          invalidField={invalidField?.replace(/^definition\.?/, "") ?? null}
          onChange={(motion) => onDispatch({ type: "set-motion", motion })}
        />
      </TabsContent>
    </Tabs>
  );
}

function PlacementFields({
  document,
  invalidField,
  onDispatch,
}: {
  document: AvatarEffectEditorDocument;
  invalidField: string | null;
  onDispatch: Dispatch;
}) {
  const { t } = useTranslation("effects");
  const attachment = document.attachment;
  const placement = resolvedPlacement(attachment);
  if (!placement) return null;
  const path = invalidField?.replace(/^definition\.?/, "") ?? "";
  const unit = positionUnit(attachment.kind);
  const sizeUnits =
    attachment.kind === "body" || attachment.kind === "sticker"
      ? sizeUnit(attachment.kind)
      : null;
  const has3d =
    attachment.kind === "face_landmark" || attachment.kind === "body";
  const patch = (value: Parameters<typeof placementOffsetPatch>[1]) =>
    onDispatch({
      type: "patch-attachment",
      patch: placementOffsetPatch(attachment, value),
    });
  // Floating, body and sticker offsets are in the viewer's frame on every
  // model. Painted offsets follow the texture's axes, so they are named
  // neutrally (texture y grows downward).
  const viewerFrame = attachment.kind !== "face_surface";
  const axes = [
    [
      "x",
      viewerFrame
        ? t("avatar.inspector.axes.right")
        : t("avatar.inspector.axes.sideways"),
    ],
    [
      "y",
      viewerFrame
        ? t("avatar.inspector.axes.up")
        : t("avatar.inspector.axes.down"),
    ],
    ...(has3d ? ([["z", t("avatar.inspector.axes.forward")]] as const) : []),
  ] as const;
  return (
    <>
      <p className="text-muted-foreground text-xs">
        {t("avatar.inspector.placementHelp")}
      </p>
      <fieldset
        className={cn(
          "space-y-2",
          path.startsWith("attachment.offset") &&
            "ring-destructive/40 rounded-lg p-2 ring-1",
        )}
      >
        <legend className="mb-2 text-sm leading-none font-medium">
          {t("avatar.inspector.position", {
            unit: placementUnitLabel(t, unit),
          })}
        </legend>
        <div
          className={cn("grid gap-2", has3d ? "grid-cols-3" : "grid-cols-2")}
        >
          {axes.map(([axis, label]) => (
            <NumberField
              key={axis}
              label={label}
              compact
              value={placement.offset[axis] * unit.factor}
              min={unit.min * unit.factor}
              max={unit.max * unit.factor}
              step={unit.step}
              decimalPlaces={unit.decimals + 1}
              onChange={(value) =>
                patch({ ...placement.offset, [axis]: value / unit.factor })
              }
            />
          ))}
        </div>
        <p className="text-muted-foreground text-xs">
          {positionHint(t, attachment.kind)}
        </p>
      </fieldset>
      {placement.scale ? (
        <fieldset
          className={cn(
            "space-y-2",
            path.startsWith("attachment.scale") &&
              "ring-destructive/40 rounded-lg p-2 ring-1",
          )}
        >
          <legend className="mb-2 text-sm leading-none font-medium">
            {t("avatar.inspector.scale")}
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {(["x", "y"] as const).map((axis) => (
              <NumberField
                key={axis}
                label={
                  axis === "x"
                    ? t("avatar.inspector.width")
                    : t("avatar.inspector.height")
                }
                compact
                value={placement.scale![axis]}
                min={0.01}
                max={20}
                step={0.05}
                decimalPlaces={3}
                onChange={(value) =>
                  onDispatch({
                    type: "patch-attachment",
                    patch: {
                      scale: {
                        ...placement.scale!,
                        [axis]: Math.min(20, Math.max(0.01, value)),
                      },
                    },
                  })
                }
              />
            ))}
          </div>
        </fieldset>
      ) : sizeUnits ? (
        <NumberField
          label={t("avatar.inspector.size", {
            unit: placementUnitLabel(t, sizeUnits),
          })}
          className={cn(
            path.startsWith("attachment.size") &&
              "ring-destructive/40 rounded-lg p-2 ring-1",
          )}
          value={(placement.size ?? 0) * sizeUnits.factor}
          step={sizeUnits.step}
          decimalPlaces={1}
          onChange={(value) => {
            const next = placementScalePatch(
              attachment,
              { ...placement, size: value / sizeUnits.factor },
              1,
            );
            if (next) onDispatch({ type: "patch-attachment", patch: next });
          }}
        />
      ) : null}
      <NumberField
        label={t("avatar.inspector.rotation")}
        className={cn(
          path.startsWith("attachment.rotationDeg") &&
            "ring-destructive/40 rounded-lg p-2 ring-1",
        )}
        value={placement.rotationDeg}
        min={-3600}
        max={3600}
        step={1}
        decimalPlaces={1}
        onChange={(value) => {
          const next = placementRotationPatch(attachment, value);
          if (next) onDispatch({ type: "patch-attachment", patch: next });
        }}
      />
      {placement.tilt && attachment.kind === "face_landmark" ? (
        <details className="space-y-2">
          <summary className="cursor-pointer text-xs font-medium">
            {t("avatar.inspector.tilt")}
          </summary>
          <div className="grid grid-cols-2 gap-2">
            {(["x", "y"] as const).map((axis) => (
              <NumberField
                key={axis}
                label={
                  axis === "x"
                    ? t("avatar.inspector.tiltForward")
                    : t("avatar.inspector.turnSideways")
                }
                compact
                value={placement.tilt![axis]}
                min={-3600}
                max={3600}
                step={1}
                decimalPlaces={1}
                onChange={(value) =>
                  onDispatch({
                    type: "patch-attachment",
                    patch: {
                      rotationDeg: {
                        x: attachment.rotationDeg?.x ?? 0,
                        y: attachment.rotationDeg?.y ?? 0,
                        z: attachment.rotationDeg?.z ?? 0,
                        [axis]: value,
                      },
                    },
                  })
                }
              />
            ))}
          </div>
        </details>
      ) : null}
    </>
  );
}

function LookFields({
  document,
  invalidField,
  onDispatch,
}: {
  document: AvatarEffectEditorDocument;
  invalidField: string | null;
  onDispatch: Dispatch;
}) {
  const { t } = useTranslation("effects");
  const tintId = useId();
  const appearance = document.appearance;
  const path = invalidField?.replace(/^definition\.?/, "") ?? "";
  return (
    <>
      <NumberField
        label={t("avatar.inspector.opacity")}
        value={appearance.opacity * 100}
        min={0}
        max={100}
        step={5}
        decimalPlaces={0}
        onChange={(value) =>
          onDispatch({
            type: "patch-appearance",
            patch: { opacity: Math.min(1, Math.max(0, value / 100)) },
          })
        }
      />
      <Field
        label={t("avatar.inspector.tint")}
        htmlFor={tintId}
        invalid={path.startsWith("appearance.tint")}
      >
        <div className="flex items-center gap-2">
          <Input
            id={tintId}
            type="color"
            aria-label={t("avatar.inspector.tintColour")}
            className="h-8 w-14 cursor-pointer p-1"
            value={appearance.tint ?? "#ffffff"}
            onChange={(event) =>
              onDispatch({
                type: "patch-appearance",
                patch: { tint: event.target.value.toLowerCase() },
              })
            }
          />
          <span className="text-muted-foreground flex-1 text-xs">
            {appearance.tint
              ? t("avatar.inspector.tintApplied", { color: appearance.tint })
              : t("avatar.inspector.noTint")}
          </span>
          {appearance.tint ? (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={t("avatar.inspector.removeTint")}
              onClick={() =>
                onDispatch({ type: "patch-appearance", patch: { tint: null } })
              }
            >
              <XIcon />
            </Button>
          ) : null}
        </div>
      </Field>
      <Field label={t("avatar.inspector.blend")}>
        <Select
          value={appearance.blend}
          onValueChange={(blend) =>
            onDispatch({
              type: "patch-appearance",
              patch: { blend: blend as typeof appearance.blend },
            })
          }
        >
          <SelectTrigger
            size="sm"
            className="w-full text-xs"
            aria-label={t("avatar.inspector.blend")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="normal">
              {t("avatar.inspector.blends.normal")}
            </SelectItem>
            <SelectItem value="additive">
              {t("avatar.inspector.blends.additive")}
            </SelectItem>
            <SelectItem value="multiply">
              {t("avatar.inspector.blends.multiply")}
            </SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </>
  );
}

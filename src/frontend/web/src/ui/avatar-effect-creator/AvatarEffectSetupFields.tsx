import { useFormatters } from "@animama/product-ui/i18n";
import type { TFunction } from "i18next";
import { FileImageIcon, LoaderCircleIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { PyExactContentSource } from "@/lib/content/catalogTypes";
import {
  avatarEffectAcceptsOtherEyeImage,
  avatarEffectFaceOptionNames,
  suggestedAvatarEffectRegion,
  type AvatarEffectEditorAction,
  type AvatarEffectEditorAttachment,
  type AvatarEffectEditorDocument,
  type AvatarEffectEditorImageResources,
  type AvatarEffectEditorImageSlot,
} from "@/lib/avatar/vfx/editor";
import { MAX_AVATAR_EFFECT_IMAGE_BYTES } from "@/lib/avatar/vfx/effect-image-limits";
import {
  AVATAR_VFX_TARGET_ROLES,
  type AvatarVFXTargetRole,
} from "@/lib/avatar/vfx/types";
import { cn } from "@/lib/utils";
import {
  CreatorField as Field,
  CreatorNumberField as NumberField,
  CreatorToggleRow as SwitchRow,
} from "@/ui/content-creator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select";
import { Textarea } from "@/ui/components/textarea";
import { SoundUploadButton } from "@/ui/sound-upload/SoundUploadButton";
import {
  ATTACHMENT_KINDS,
  attachmentKindText,
  sidesChoice,
  sidesChoicePatch,
  sidesChoices,
  sidesLabel,
} from "./avatarEffectPlacement";

type Dispatch = (action: AvatarEffectEditorAction) => void;

type SoundOption = {
  item_id: string;
  name: string;
  source: PyExactContentSource | null;
};

/** Plain names for the face parts art can be painted on or hide. */
function targetPartName(
  t: TFunction<"effects">,
  role: AvatarVFXTargetRole,
): string {
  switch (role) {
    case "face_skin":
      return t("avatar.targetParts.face_skin");
    case "eye_iris":
      return t("avatar.targetParts.eye_iris");
    case "eye_highlight":
      return t("avatar.targetParts.eye_highlight");
    case "eyeline":
      return t("avatar.targetParts.eyeline");
    case "eyelash":
      return t("avatar.targetParts.eyelash");
  }
}

type BodyPoint =
  | "root"
  | "hips"
  | "spine"
  | "chest"
  | "neck"
  | "head"
  | "leftHand"
  | "rightHand"
  | "leftFoot"
  | "rightFoot";

const BODY_POINTS: readonly BodyPoint[] = [
  "root",
  "hips",
  "spine",
  "chest",
  "neck",
  "head",
  "leftHand",
  "rightHand",
  "leftFoot",
  "rightFoot",
];

function bodyPointName(t: TFunction<"effects">, point: BodyPoint): string {
  switch (point) {
    case "root":
      return t("avatar.bodyPoints.root");
    case "hips":
      return t("avatar.bodyPoints.hips");
    case "spine":
      return t("avatar.bodyPoints.spine");
    case "chest":
      return t("avatar.bodyPoints.chest");
    case "neck":
      return t("avatar.bodyPoints.neck");
    case "head":
      return t("avatar.bodyPoints.head");
    case "leftHand":
      return t("avatar.bodyPoints.leftHand");
    case "rightHand":
      return t("avatar.bodyPoints.rightHand");
    case "leftFoot":
      return t("avatar.bodyPoints.leftFoot");
    case "rightFoot":
      return t("avatar.bodyPoints.rightFoot");
  }
}

type Landmark = "eyes" | "mouth" | "forehead" | "top" | "top_edge";

const LANDMARKS: readonly Landmark[] = [
  "eyes",
  "mouth",
  "forehead",
  "top",
  "top_edge",
];

function landmarkName(t: TFunction<"effects">, landmark: Landmark): string {
  switch (landmark) {
    case "eyes":
      return t("avatar.landmarks.eyes");
    case "mouth":
      return t("avatar.landmarks.mouth");
    case "forehead":
      return t("avatar.landmarks.forehead");
    case "top":
      return t("avatar.landmarks.top");
    case "top_edge":
      return t("avatar.landmarks.top_edge");
  }
}

type SurfaceArea = "full" | "eyes" | "undereye" | "blush" | "mouth";

const SURFACE_AREAS: readonly SurfaceArea[] = [
  "full",
  "eyes",
  "undereye",
  "blush",
  "mouth",
];

function surfaceAreaName(t: TFunction<"effects">, area: SurfaceArea): string {
  switch (area) {
    case "full":
      return t("avatar.surfaceAreas.full");
    case "eyes":
      return t("avatar.surfaceAreas.eyes");
    case "undereye":
      return t("avatar.surfaceAreas.undereye");
    case "blush":
      return t("avatar.surfaceAreas.blush");
    case "mouth":
      return t("avatar.surfaceAreas.mouth");
  }
}

type Pivot =
  | "top-left"
  | "top-center"
  | "top-right"
  | "center-left"
  | "center"
  | "center-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

const PIVOTS: readonly Pivot[] = [
  "top-left",
  "top-center",
  "top-right",
  "center-left",
  "center",
  "center-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];

function pivotName(t: TFunction<"effects">, pivot: Pivot): string {
  switch (pivot) {
    case "top-left":
      return t("avatar.pivots.topLeft");
    case "top-center":
      return t("avatar.pivots.top");
    case "top-right":
      return t("avatar.pivots.topRight");
    case "center-left":
      return t("avatar.pivots.left");
    case "center":
      return t("avatar.pivots.centre");
    case "center-right":
      return t("avatar.pivots.right");
    case "bottom-left":
      return t("avatar.pivots.bottomLeft");
    case "bottom-center":
      return t("avatar.pivots.bottom");
    case "bottom-right":
      return t("avatar.pivots.bottomRight");
  }
}

/** Small select used throughout the setup panel. */
function ChoiceField<T extends string>({
  label,
  value,
  options,
  invalid,
  onValue,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  invalid?: boolean;
  onValue: (value: T) => void;
}) {
  return (
    <Field label={label} invalid={invalid}>
      <Select value={value} onValueChange={(next) => onValue(next as T)}>
        <SelectTrigger size="sm" className="w-full text-xs" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([option, optionLabel]) => (
            <SelectItem key={option} value={option}>
              {optionLabel}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

/** Image chooser with drag and drop; the same control serves both images. */
function ImageField({
  label,
  hint,
  name,
  busy,
  error,
  invalid,
  hasImage,
  onChoose,
  onClear,
}: {
  label: string;
  hint: string;
  name: string | null;
  busy: boolean;
  error: string | null;
  invalid: boolean;
  hasImage: boolean;
  onChoose: (file: File) => void;
  onClear?: () => void;
}) {
  const { t } = useTranslation("effects");
  const [dragActive, setDragActive] = useState(false);
  return (
    <Field label={label} invalid={invalid}>
      <label
        className={cn(
          "border-border/70 bg-background/55 hover:bg-accent/50 flex cursor-pointer items-center gap-3 rounded-lg border border-dashed p-3 transition",
          dragActive && "border-sky-400 bg-sky-100/50 dark:bg-sky-950/30",
          invalid && "border-destructive",
        )}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragActive(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          const file = event.dataTransfer.files[0];
          if (file) onChoose(file);
        }}
      >
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
          {busy ? (
            <LoaderCircleIcon className="animate-spin" />
          ) : (
            <FileImageIcon />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {name ?? t("avatar.setup.chooseImage")}
          </div>
          <div className="text-muted-foreground text-xs">{hint}</div>
        </div>
        <span className="border-border rounded-md border px-2 py-1 text-xs">
          {hasImage ? t("avatar.setup.replaceImage") : t("avatar.setup.browse")}
        </span>
        <input
          className="sr-only"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label={label}
          aria-invalid={invalid}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onChoose(file);
            event.currentTarget.value = "";
          }}
        />
      </label>
      {onClear && hasImage ? (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground self-start text-xs underline"
          onClick={onClear}
        >
          {t("avatar.setup.useMirroredImage")}
        </button>
      ) : null}
      {error ? <p className="text-destructive mt-1 text-xs">{error}</p> : null}
    </Field>
  );
}

/**
 * The Setup panel: where the art attaches, the art itself, face options,
 * sound and description. Only the controls the chosen attachment uses appear.
 */
export function AvatarEffectSetupFields({
  document,
  imageResources,
  imageBusy,
  imageError,
  invalidField,
  soundOptions,
  soundPending,
  licensedSoundOmitted = false,
  onDispatch,
  onChooseImage,
  onClearOtherEyeImage,
}: {
  document: AvatarEffectEditorDocument;
  imageResources: AvatarEffectEditorImageResources;
  imageBusy: AvatarEffectEditorImageSlot | null;
  imageError: { slot: AvatarEffectEditorImageSlot; message: string } | null;
  /** A failed Save's or validation's field, to highlight its control. */
  invalidField: string | null;
  soundOptions: SoundOption[];
  soundPending: boolean;
  /** The draft was copied from a built-in effect whose licensed sound stayed behind. */
  licensedSoundOmitted?: boolean;
  onDispatch: Dispatch;
  onChooseImage: (slot: AvatarEffectEditorImageSlot, file: File) => void;
  onClearOtherEyeImage: () => void;
}) {
  const { t } = useTranslation("effects");
  const formatters = useFormatters();
  const attachment = document.attachment;
  const invalid = (prefix: string) =>
    Boolean(invalidField && invalidField.startsWith(prefix));
  const otherEye = avatarEffectAcceptsOtherEyeImage(attachment);
  return (
    <div className="space-y-3">
      <Field
        label={t("avatar.setup.attachTo")}
        invalid={invalid("attachment.kind")}
      >
        <Select
          value={attachment.kind}
          onValueChange={(kind) =>
            onDispatch({
              type: "set-attachment",
              kind: kind as AvatarEffectEditorAttachment["kind"],
            })
          }
        >
          <SelectTrigger
            size="sm"
            className="w-full text-xs"
            aria-label={t("avatar.setup.attachTo")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ATTACHMENT_KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {attachmentKindText(t, kind).label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">
          {attachmentKindText(t, attachment.kind).description}
        </p>
      </Field>

      <AttachmentFields
        attachment={attachment}
        invalid={invalid}
        onDispatch={onDispatch}
      />

      <ImageField
        label={t("avatar.setup.image")}
        hint={t("avatar.setup.imageHint", {
          size: formatters.fileSize(MAX_AVATAR_EFFECT_IMAGE_BYTES),
        })}
        name={
          imageResources.image?.file.name ??
          document.art.image?.originalName ??
          null
        }
        busy={imageBusy === "image"}
        error={imageError?.slot === "image" ? imageError.message : null}
        invalid={invalid("art.image") || invalidField === "files"}
        hasImage={Boolean(document.art.image)}
        onChoose={(file) => onChooseImage("image", file)}
      />
      {otherEye ? (
        <ImageField
          label={t("avatar.setup.otherImage")}
          hint={t("avatar.setup.otherImageHint")}
          name={
            imageResources.otherEyeImage?.file.name ??
            document.art.otherEyeImage?.originalName ??
            null
          }
          busy={imageBusy === "otherEyeImage"}
          error={
            imageError?.slot === "otherEyeImage" ? imageError.message : null
          }
          invalid={invalid("art.otherEyeImage")}
          hasImage={Boolean(document.art.otherEyeImage)}
          onChoose={(file) => onChooseImage("otherEyeImage", file)}
          onClear={onClearOtherEyeImage}
        />
      ) : null}
      <FlipbookFields
        document={document}
        invalid={invalid("art.flipbook")}
        onDispatch={onDispatch}
      />

      <FaceOptionFields document={document} onDispatch={onDispatch} />

      <Field label={t("creator.sound.label")} invalid={invalid("sound")}>
        <SoundUploadButton />
        <Select
          value={soundSourceKey(document.sound?.source ?? null)}
          onValueChange={(value) => {
            if (value === "none") {
              onDispatch({ type: "patch", patch: { sound: null } });
              return;
            }
            const option = soundOptions.find(
              (item) => soundSourceKey(item.source) === value,
            );
            if (!option?.source) return;
            onDispatch({
              type: "patch",
              patch: {
                sound: {
                  alias: "on-apply",
                  label: option.name,
                  source: option.source,
                },
              },
            });
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-full text-xs"
            aria-label={t("creator.sound.label")}
            aria-describedby={
              licensedSoundOmitted
                ? "avatar-effect-licensed-sound-note"
                : undefined
            }
          >
            <SelectValue
              placeholder={
                soundPending
                  ? t("creator.sound.loading")
                  : t("creator.sound.none")
              }
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t("creator.sound.none")}</SelectItem>
            {document.sound &&
            !soundOptions.some(
              (item) =>
                soundSourceKey(item.source) ===
                soundSourceKey(document.sound?.source ?? null),
            ) ? (
              <SelectItem value={soundSourceKey(document.sound.source)}>
                {t("creator.sound.exact", { name: document.sound.label })}
              </SelectItem>
            ) : null}
            {soundOptions.flatMap((item) =>
              item.source ? (
                <SelectItem
                  key={item.item_id}
                  value={soundSourceKey(item.source)}
                >
                  {item.name}
                </SelectItem>
              ) : (
                []
              ),
            )}
          </SelectContent>
        </Select>
        {licensedSoundOmitted ? (
          <p
            id="avatar-effect-licensed-sound-note"
            className="text-muted-foreground text-xs"
          >
            {t("creator.sound.licensedOmitted")}
          </p>
        ) : null}
      </Field>
      <Field label={t("creator.description")}>
        <Textarea
          className="min-h-16 text-xs"
          rows={2}
          aria-label={t("creator.description")}
          value={document.description}
          onChange={(event) =>
            onDispatch({
              type: "patch",
              patch: { description: event.target.value },
            })
          }
        />
      </Field>
      <ReplacesField document={document} onDispatch={onDispatch} />
    </div>
  );
}

function SidesField({
  attachment,
  onDispatch,
}: {
  attachment: AvatarEffectEditorAttachment;
  onDispatch: Dispatch;
}) {
  const { t } = useTranslation("effects");
  const choices = sidesChoices(attachment);
  const current = sidesChoice(attachment);
  if (!choices.length || !current) return null;
  const eyes =
    attachment.kind === "face_landmark" ||
    (attachment.kind === "face_surface" && attachment.area === "eyes");
  return (
    <>
      <ChoiceField
        label={eyes ? t("avatar.setup.whichEyes") : t("avatar.setup.whichSide")}
        value={current}
        options={choices.map(
          (choice) => [choice, sidesLabel(t, choice, eyes)] as const,
        )}
        onValue={(choice) =>
          onDispatch({
            type: "patch-attachment",
            patch: sidesChoicePatch(attachment, choice),
          })
        }
      />
      {current === "mirrored" && "side" in attachment ? (
        <ChoiceField
          label={t("avatar.setup.drawnFor")}
          // The runtime draws a sideless mirrored pair for the right eye.
          value={attachment.side ?? "right"}
          options={[
            [
              "left",
              eyes ? t("avatar.setup.leftEye") : t("avatar.setup.leftSide"),
            ],
            [
              "right",
              eyes ? t("avatar.setup.rightEye") : t("avatar.setup.rightSide"),
            ],
          ]}
          onValue={(side) =>
            onDispatch({ type: "patch-attachment", patch: { side } })
          }
        />
      ) : null}
    </>
  );
}

/**
 * Where on its attachment kind the art goes (landmark, face area, body point,
 * sticker side, silhouette fill) and the sides it is drawn on. Dispatches only
 * `patch-attachment`, so it never changes the kind; the Action creator reuses
 * it to place one use of an effect.
 */
export function AttachmentFields({
  attachment,
  invalid,
  onDispatch,
}: {
  attachment: AvatarEffectEditorAttachment;
  invalid: (prefix: string) => boolean;
  onDispatch: Dispatch;
}) {
  const { t } = useTranslation("effects");
  const patch = (value: Record<string, unknown>) =>
    onDispatch({ type: "patch-attachment", patch: value });
  switch (attachment.kind) {
    case "face_landmark":
      return (
        <>
          <ChoiceField
            label={t("avatar.setup.where")}
            value={attachment.landmark}
            options={LANDMARKS.map(
              (landmark) => [landmark, landmarkName(t, landmark)] as const,
            )}
            invalid={invalid("attachment.landmark")}
            onValue={(landmark) => patch({ landmark })}
          />
          {attachment.position ? (
            <ChoiceField
              label={t("avatar.setup.position")}
              value={attachment.position}
              options={[
                ...(attachment.landmark === "top_edge"
                  ? ([["left_corner", t("avatar.positions.farLeft")]] as const)
                  : []),
                ["left", t("avatar.positions.left")],
                ["middle", t("avatar.positions.middle")],
                ["right", t("avatar.positions.right")],
                ...(attachment.landmark === "top_edge"
                  ? ([
                      ["right_corner", t("avatar.positions.farRight")],
                    ] as const)
                  : []),
              ]}
              invalid={invalid("attachment.position")}
              onValue={(position) => patch({ position })}
            />
          ) : null}
          <SidesField attachment={attachment} onDispatch={onDispatch} />
          <p className="text-muted-foreground text-xs">
            {t("avatar.setup.avatarSides")}
          </p>
        </>
      );
    case "face_surface": {
      const decal = ["undereye", "blush", "mouth"].includes(attachment.area);
      return (
        <>
          <ChoiceField
            label={t("avatar.setup.whereOnFace")}
            value={attachment.area}
            options={SURFACE_AREAS.map(
              (area) => [area, surfaceAreaName(t, area)] as const,
            )}
            invalid={invalid("attachment.area")}
            onValue={(area) =>
              patch({
                area,
                // Eye art paints the irises; other areas paint the skin.
                ...(area === "eyes" ? { part: "eye_iris" } : {}),
                ...(area === "full" ? { part: "face_skin" } : {}),
              })
            }
          />
          {!decal ? (
            <ChoiceField
              label={t("avatar.setup.paintOn")}
              value={attachment.part}
              options={AVATAR_VFX_TARGET_ROLES.map(
                (role) => [role, targetPartName(t, role)] as const,
              )}
              invalid={invalid("attachment.part")}
              onValue={(part) => patch({ part })}
            />
          ) : null}
          <SidesField attachment={attachment} onDispatch={onDispatch} />
          {decal ? (
            <ChoiceField
              label={t("avatar.setup.pivot")}
              value={attachment.pivot ?? "center"}
              options={PIVOTS.map(
                (pivot) => [pivot, pivotName(t, pivot)] as const,
              )}
              invalid={invalid("attachment.pivot")}
              onValue={(pivot) => patch({ pivot })}
            />
          ) : (
            <SwitchRow
              label={t("avatar.setup.keepOriginal")}
              description={t("avatar.setup.keepOriginalHint")}
              checked={(attachment.mode ?? "overlay") === "overlay"}
              onChecked={(keep) =>
                patch({ mode: keep ? "overlay" : "replace" })
              }
            />
          )}
          <p className="text-muted-foreground text-xs">
            {t("avatar.setup.avatarSides")}
          </p>
        </>
      );
    }
    case "body":
      return (
        <>
          <ChoiceField
            label={t("avatar.setup.bodyPoint")}
            value={attachment.bone}
            options={BODY_POINTS.map(
              (point) => [point, bodyPointName(t, point)] as const,
            )}
            invalid={invalid("attachment.bone")}
            onValue={(bone) => patch({ bone })}
          />
          <SwitchRow
            label={t("avatar.setup.faceCamera")}
            description={t("avatar.setup.faceCameraHint")}
            checked={(attachment.facing ?? "camera") === "camera"}
            onChecked={(camera) =>
              patch({ facing: camera ? "camera" : "bone" })
            }
          />
        </>
      );
    case "sticker":
      return (
        <ChoiceField
          label={t("avatar.setup.besideThe")}
          value={attachment.around ?? "head"}
          options={[
            ["head", t("avatar.setup.besideHead")],
            ["body", t("avatar.setup.besideBody")],
          ]}
          invalid={invalid("attachment.around")}
          onValue={(around) => patch({ around })}
        />
      );
    case "silhouette":
      return (
        <>
          <ChoiceField
            label={t("avatar.setup.fill")}
            value={attachment.fill ?? "pattern"}
            options={[
              ["pattern", t("avatar.setup.fillPattern")],
              ["tint", t("avatar.setup.fillTint")],
            ]}
            invalid={invalid("attachment.fill")}
            onValue={(fill) => patch({ fill })}
          />
          {(attachment.fill ?? "pattern") === "pattern" ? (
            <div className="grid grid-cols-3 gap-2">
              <NumberField
                label={t("avatar.setup.tileSize")}
                compact
                value={attachment.patternScale ?? 1}
                min={0.01}
                max={20}
                step={0.1}
                decimalPlaces={2}
                onChange={(value) =>
                  patch({ patternScale: Math.min(20, Math.max(0.01, value)) })
                }
              />
              <NumberField
                label={t("avatar.setup.scrollX")}
                compact
                value={attachment.scroll?.x ?? 0}
                min={-10}
                max={10}
                step={0.1}
                decimalPlaces={2}
                onChange={(x) =>
                  patch({ scroll: { x, y: attachment.scroll?.y ?? 0 } })
                }
              />
              <NumberField
                label={t("avatar.setup.scrollY")}
                compact
                value={attachment.scroll?.y ?? 0}
                min={-10}
                max={10}
                step={0.1}
                decimalPlaces={2}
                onChange={(y) =>
                  patch({ scroll: { x: attachment.scroll?.x ?? 0, y } })
                }
              />
            </div>
          ) : null}
        </>
      );
  }
}

/** Flipbook: frames on a grid in the image, played at a frame rate. */
function FlipbookFields({
  document,
  invalid,
  onDispatch,
}: {
  document: AvatarEffectEditorDocument;
  invalid: boolean;
  onDispatch: Dispatch;
}) {
  const { t } = useTranslation("effects");
  const flipbook = document.art.flipbook;
  const set = (value: typeof flipbook) =>
    onDispatch({ type: "patch-art", patch: { flipbook: value } });
  const integer = (value: number, max: number) =>
    Math.min(max, Math.max(1, Math.round(value)));
  return (
    <div
      className={cn(
        "space-y-2",
        invalid && "ring-destructive/40 rounded-lg p-2 ring-1",
      )}
    >
      <SwitchRow
        label={t("avatar.flipbook.title")}
        description={t("avatar.flipbook.description")}
        checked={Boolean(flipbook)}
        onChecked={(enabled) =>
          set(
            enabled
              ? { columns: 4, rows: 1, frames: 4, fps: 12, loop: "loop" }
              : null,
          )
        }
      />
      {flipbook ? (
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label={t("avatar.flipbook.columns")}
            compact
            value={flipbook.columns}
            min={1}
            max={16}
            step={1}
            decimalPlaces={0}
            onChange={(value) => {
              const columns = integer(value, 16);
              set({
                ...flipbook,
                columns,
                frames: Math.min(flipbook.frames, columns * flipbook.rows),
              });
            }}
          />
          <NumberField
            label={t("avatar.flipbook.rows")}
            compact
            value={flipbook.rows}
            min={1}
            max={16}
            step={1}
            decimalPlaces={0}
            onChange={(value) => {
              const rows = integer(value, 16);
              set({
                ...flipbook,
                rows,
                frames: Math.min(flipbook.frames, flipbook.columns * rows),
              });
            }}
          />
          <NumberField
            label={t("avatar.flipbook.frames")}
            compact
            value={flipbook.frames}
            min={1}
            max={flipbook.columns * flipbook.rows}
            step={1}
            decimalPlaces={0}
            onChange={(value) =>
              set({
                ...flipbook,
                frames: integer(value, flipbook.columns * flipbook.rows),
              })
            }
          />
          <NumberField
            label={t("avatar.flipbook.fps")}
            compact
            value={flipbook.fps}
            min={0.1}
            max={60}
            step={1}
            decimalPlaces={1}
            onChange={(value) =>
              set({ ...flipbook, fps: Math.min(60, Math.max(0.1, value)) })
            }
          />
          <div className="col-span-2">
            <ChoiceField
              label={t("avatar.flipbook.playback")}
              value={flipbook.loop ?? "loop"}
              options={[
                ["loop", t("avatar.flipbook.loop")],
                ["once", t("avatar.flipbook.once")],
                ["pingpong", t("avatar.flipbook.pingpong")],
              ]}
              onValue={(loop) => set({ ...flipbook, loop })}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Eye and mouth cleanup options; each is on unless switched off. */
function FaceOptionFields({
  document,
  onDispatch,
}: {
  document: AvatarEffectEditorDocument;
  onDispatch: Dispatch;
}) {
  const { t } = useTranslation("effects");
  const names = avatarEffectFaceOptionNames(document.attachment);
  if (!names.size) return null;
  const options = document.faceOptions;
  const eyes =
    document.attachment.kind === "face_landmark" &&
    document.attachment.landmark === "eyes";
  const set = (patch: Partial<typeof options>) =>
    onDispatch({ type: "patch-face-options", patch });
  const hidden = options.hideParts ?? [];
  return (
    <div className="space-y-2 border-t pt-3">
      {names.has("forceBlink") ? (
        <SwitchRow
          label={t("avatar.faceOptions.closeEyes")}
          description={t("avatar.faceOptions.closeEyesHint")}
          checked={options.forceBlink ?? true}
          onChecked={(forceBlink) => set({ forceBlink })}
        />
      ) : null}
      {names.has("hideEyeDetails") ? (
        <SwitchRow
          label={t("avatar.faceOptions.hideEyeDetails")}
          description={t("avatar.faceOptions.hideEyeDetailsHint")}
          checked={options.hideEyeDetails ?? true}
          onChecked={(hideEyeDetails) => set({ hideEyeDetails })}
        />
      ) : null}
      {names.has("faceCleanup") ? (
        <SwitchRow
          label={
            eyes
              ? t("avatar.faceOptions.cleanUpEyes")
              : t("avatar.faceOptions.cleanUpMouth")
          }
          description={t("avatar.faceOptions.cleanUpHint")}
          checked={options.faceCleanup ?? true}
          onChecked={(faceCleanup) => set({ faceCleanup })}
        />
      ) : null}
      {names.has("skinBackdrop") ? (
        <SwitchRow
          label={t("avatar.faceOptions.skinBackdrop")}
          description={t("avatar.faceOptions.skinBackdropHint")}
          checked={options.skinBackdrop ?? false}
          onChecked={(skinBackdrop) => set({ skinBackdrop })}
        />
      ) : null}
      {names.has("hideParts") ? (
        <details className="space-y-2">
          <summary className="cursor-pointer text-xs font-medium">
            {t("avatar.faceOptions.hideParts", { hidden: hidden.length })}
          </summary>
          <p className="text-muted-foreground text-xs">
            {t("avatar.faceOptions.hidePartsHint")}
          </p>
          {AVATAR_VFX_TARGET_ROLES.map((role) => (
            <SwitchRow
              key={role}
              label={t("avatar.faceOptions.hidePart", {
                part: targetPartName(t, role),
              })}
              checked={hidden.includes(role)}
              onChecked={(checked) =>
                set({
                  hideParts: checked
                    ? [...hidden, role]
                    : hidden.filter((item) => item !== role),
                })
              }
            />
          ))}
        </details>
      ) : null}
    </div>
  );
}

/** What an effect in each region replaces, as the Replaces field words it. */
function regionLabel(
  t: TFunction<"effects">,
  region: AvatarEffectEditorDocument["region"],
): string {
  switch (region) {
    case "eyes":
      return t("avatar.regions.eyes");
    case "undereye":
      return t("avatar.regions.undereye");
    case "blush":
      return t("avatar.regions.blush");
    case "mouth":
      return t("avatar.regions.mouth");
    case "emote":
      return t("avatar.regions.emote");
    case "full_face":
      return t("avatar.regions.full_face");
    case "body":
      return t("avatar.regions.body");
    case "sticker":
      return t("avatar.regions.sticker");
    case "silhouette":
      return t("avatar.regions.silhouette");
  }
}

/**
 * Which other effects this one replaces when both play. Face effects in the
 * same eye, cheek or mouth area replace each other; others stack.
 */
function ReplacesField({
  document,
  onDispatch,
}: {
  document: AvatarEffectEditorDocument;
  onDispatch: Dispatch;
}) {
  const { t } = useTranslation("effects");
  const kind = document.attachment.kind;
  if (kind === "body" || kind === "sticker" || kind === "silhouette")
    return null;
  const automatic = suggestedAvatarEffectRegion(document.attachment);
  const stacking = automatic === "full_face" ? "full_face" : "emote";
  const options: Array<readonly [string, string]> = [
    [
      "automatic",
      t("avatar.regions.automatic", { region: regionLabel(t, automatic) }),
    ],
    ["eyes", regionLabel(t, "eyes")],
    ["undereye", regionLabel(t, "undereye")],
    ["blush", regionLabel(t, "blush")],
    ["mouth", regionLabel(t, "mouth")],
    [stacking, regionLabel(t, stacking)],
  ];
  // A saved custom region is always offered, so the select never shows blank.
  if (
    document.regionMode === "custom" &&
    !options.some(([value]) => value === document.region)
  )
    options.push([document.region, regionLabel(t, document.region)]);
  return (
    <details className="space-y-2 border-t pt-3">
      <summary className="cursor-pointer text-xs font-medium">
        {t("avatar.regions.advanced")}
      </summary>
      <ChoiceField
        label={t("avatar.regions.replaces")}
        value={
          document.regionMode === "automatic" ? "automatic" : document.region
        }
        options={options}
        onValue={(value) =>
          onDispatch({
            type: "patch",
            patch:
              value === "automatic"
                ? { regionMode: "automatic" }
                : { region: value as AvatarEffectEditorDocument["region"] },
          })
        }
      />
      <p className="text-muted-foreground text-xs">
        {t("avatar.regions.replacesHint")}
      </p>
    </details>
  );
}

export function soundSourceKey(source: PyExactContentSource | null): string {
  if (!source) return "none";
  return source.type === "builtin"
    ? `builtin:${source.content_id ?? ""}:${source.version ?? ""}`
    : `catalog:${source.catalog_item_id}`;
}

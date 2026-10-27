"use client";

import * as Dialog from "@radix-ui/react-dialog";
import type { TFunction } from "i18next";
import {
  AlertTriangle,
  Box,
  Braces,
  CheckCircle2,
  ChevronsDownUp,
  ChevronsUpDown,
  ClipboardCopy,
  FileBox,
  LoaderCircle,
  PersonStanding,
  Smile,
  SmilePlus,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useFormatters } from "@animama/product-ui/i18n";

import type { FaceRegionSource } from "@/lib/avatar/arkitFaceExpressions";
import type { AvatarFacePartSource } from "@/lib/avatar/vfx/faceParts";
import {
  avatarDiagnosticsJson,
  avatarDiagnosticsText,
  type AvatarDiagnosticsReport,
  type AvatarSettingSource,
} from "@/lib/avatar/diagnostics/avatarDiagnosticsReport";
import type { AvatarMaterialKind } from "@/lib/avatar/diagnostics/avatarFileFacts";
import type { AvatarIssue } from "@/lib/avatar/diagnostics/issues";
import { cn } from "@/lib/utils";
import { facePartRoleName } from "@/ui/avatar-effect-creator/facePartsPanel";
import { Button } from "@/ui/components/button";
import { DialogOverlay } from "@/ui/components/dialog";
import {
  SectionedModalFrame,
  type SectionIcon,
} from "@/ui/components/sectioned-modal-frame";
import { avatarIssueText } from "./avatarIssueText";
import { materialModeLabel, springModeLabel } from "./avatarSettingLabels";
import { JsonTree } from "./JsonTree";
import {
  useAvatarDiagnostics,
  type AvatarDiagnosticsSource,
  type AvatarDiagnosticsView,
} from "./useAvatarDiagnostics";

type DiagnosticsSection =
  | "file"
  | "face"
  | "expressions"
  | "motion"
  | "warnings"
  | "json";

const SECTIONS: readonly DiagnosticsSection[] = [
  "file",
  "face",
  "expressions",
  "motion",
  "warnings",
  "json",
];

const SECTION_ICONS: Record<DiagnosticsSection, SectionIcon> = {
  file: FileBox,
  face: Smile,
  expressions: SmilePlus,
  motion: PersonStanding,
  warnings: AlertTriangle,
  json: Braces,
};

function sectionLabel(
  t: TFunction<"animas">,
  section: DiagnosticsSection,
): string {
  switch (section) {
    case "file":
      return t("avatarDiagnostics.sections.file");
    case "face":
      return t("avatarDiagnostics.sections.face");
    case "expressions":
      return t("avatarDiagnostics.sections.expressions");
    case "motion":
      return t("avatarDiagnostics.sections.motion");
    case "warnings":
      return t("avatarDiagnostics.sections.warnings");
    case "json":
      return t("avatarDiagnostics.sections.json");
  }
}

function materialKindLabel(
  t: TFunction<"animas">,
  kind: AvatarMaterialKind,
): string {
  switch (kind) {
    case "mtoon":
      return t("avatarDiagnostics.materialKinds.mtoon");
    case "liltoon":
      return t("avatarDiagnostics.materialKinds.liltoon");
    case "unlit":
      return t("avatarDiagnostics.materialKinds.unlit");
    case "pbr":
      return t("avatarDiagnostics.materialKinds.pbr");
  }
}

function partSourceLabel(
  t: TFunction<"animas">,
  source: AvatarFacePartSource,
): string {
  switch (source) {
    case "signals":
      return t("avatarDiagnostics.face.sources.signals");
    case "names":
      return t("avatarDiagnostics.face.sources.names");
    case "corrected":
      return t("avatarDiagnostics.face.sources.corrected");
    case "missing":
      return t("avatarDiagnostics.face.sources.missing");
  }
}

/** Where a stored setting comes from, under its effect; nothing when none is kept. */
function SettingSource({ source }: { source: AvatarSettingSource | null }) {
  const { t } = useTranslation("animas");
  if (!source) return null;
  return (
    <span className="text-muted-foreground block text-xs">
      {source === "stored"
        ? t("avatarDiagnostics.settingSource.stored")
        : t("avatarDiagnostics.settingSource.default")}
    </span>
  );
}

/** The file's lilToon materials: how they render and why. */
function LilToonMaterialsFact({ report }: { report: AvatarDiagnosticsReport }) {
  const { t } = useTranslation("animas");
  const { t: tSettings } = useTranslation("settings");
  const materials = report.live?.materials;
  if (!materials) return null;
  const state =
    materials.lilToon === "rendered"
      ? t("avatarDiagnostics.materials.rendered")
      : t("avatarDiagnostics.materials.simple");
  const why =
    materials.lilToon === "fallback" && materials.mode !== "simple"
      ? t("avatarDiagnostics.materials.why.failed")
      : materials.mode === "automatic"
        ? t("avatarDiagnostics.materials.why.automatic")
        : t("avatarDiagnostics.materials.why.chosen", {
            mode: materialModeLabel(tSettings, materials.mode),
          });
  return (
    <Fact label={t("avatarDiagnostics.materials.label")}>
      {t("avatarDiagnostics.materials.value", { state, why })}
      <SettingSource source={report.settings?.materialModeSource ?? null} />
    </Fact>
  );
}

function regionSourceLabel(
  t: TFunction<"animas">,
  source: FaceRegionSource,
): string {
  switch (source) {
    case "vroid":
      return t("avatarDiagnostics.expressions.regionSources.vroid");
    case "mmd":
      return t("avatarDiagnostics.expressions.regionSources.mmd");
    case "arkit":
      return t("avatarDiagnostics.expressions.regionSources.arkit");
    case "preset":
      return t("avatarDiagnostics.expressions.regionSources.preset");
    case "none":
      return t("avatarDiagnostics.expressions.regionSources.none");
  }
}

function readyLabel(
  t: TFunction<"animas">,
  status: "ready" | "unavailable",
): string {
  return status === "ready"
    ? t("avatarDiagnostics.face.ready")
    : t("avatarDiagnostics.face.unavailable");
}

/** A labelled list of facts in one bordered card. */
function FactList({ children }: { children: ReactNode }) {
  return (
    <dl className="border-border/60 bg-background divide-border/60 divide-y rounded-lg border">
      {children}
    </dl>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 px-4 py-2.5 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-foreground min-w-0 text-sm">{children}</dd>
    </div>
  );
}

/** Identifiers (extensions, expression and bone names) shown as written. */
function Names({ names, none }: { names: readonly ReactNode[]; none: string }) {
  if (names.length === 0) {
    return <span className="text-muted-foreground">{none}</span>;
  }
  return (
    <ul className="flex flex-wrap gap-1.5">
      {names.map((name, index) => (
        <li
          key={index}
          className="bg-muted text-foreground rounded-md px-1.5 py-0.5 font-mono text-xs"
        >
          {name}
        </li>
      ))}
    </ul>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "warning" | "success" | "info";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border p-3 text-sm",
        tone === "warning" && "border-warning/30 bg-warning/10 text-warning",
        tone === "success" && "border-success/30 bg-success/10 text-success",
        tone === "info" && "border-info/30 bg-info/10 text-info",
      )}
    >
      {tone === "success" ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      ) : (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      )}
      <p className="text-foreground">{children}</p>
    </div>
  );
}

function FileSection({ report }: { report: AvatarDiagnosticsReport }) {
  const { t } = useTranslation("animas");
  const format = useFormatters();
  const file = report.file;
  if (!file) {
    return (
      <Notice tone="warning">{t("avatarDiagnostics.file.unreadable")}</Notice>
    );
  }
  const kinds = (Object.keys(file.materialKinds) as AvatarMaterialKind[])
    .filter((kind) => file.materialKinds[kind] > 0)
    .map((kind) =>
      t("avatarDiagnostics.file.materialKind", {
        kind: materialKindLabel(t, kind),
        number: format.number(file.materialKinds[kind]),
      }),
    );
  const textureBytes = file.textures.reduce(
    (total, texture) => total + (texture.byteLength ?? 0),
    0,
  );
  const textures = [...file.textures].sort(
    (a, b) =>
      (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0),
  );
  return (
    <div className="flex flex-col gap-4">
      <FactList>
        <Fact label={t("avatarDiagnostics.file.format")}>
          {file.vrmVersion
            ? t("avatarDiagnostics.file.formatVrm", {
                container: file.container.toUpperCase(),
                version: file.vrmVersion,
              })
            : t("avatarDiagnostics.file.formatNotVrm", {
                container: file.container.toUpperCase(),
              })}
        </Fact>
        <Fact label={t("avatarDiagnostics.file.size")}>
          {format.fileSize(file.byteLength)}
        </Fact>
        <Fact label={t("avatarDiagnostics.file.extensionsRequired")}>
          <Names
            names={file.extensionsRequired}
            none={t("avatarDiagnostics.none")}
          />
        </Fact>
        <Fact label={t("avatarDiagnostics.file.extensionsUsed")}>
          <Names
            names={file.extensionsUsed}
            none={t("avatarDiagnostics.none")}
          />
        </Fact>
        <Fact label={t("avatarDiagnostics.file.meshes")}>
          {t("avatarDiagnostics.file.meshesValue", {
            meshes: format.number(file.meshCount),
            primitives: format.number(file.primitiveCount),
            morphed: format.number(file.morphedPrimitiveCount),
          })}
        </Fact>
        <Fact label={t("avatarDiagnostics.file.materials")}>
          {kinds.length > 0 ? format.list(kinds) : t("avatarDiagnostics.none")}
        </Fact>
        <LilToonMaterialsFact report={report} />
        <Fact label={t("avatarDiagnostics.file.textures")}>
          {t("avatarDiagnostics.file.texturesValue", {
            count: file.textures.length,
            size: format.fileSize(textureBytes),
          })}
        </Fact>
      </FactList>
      {textures.length > 0 ? (
        <table className="border-border/60 w-full overflow-hidden rounded-lg border text-sm">
          <caption className="text-muted-foreground mb-2 text-left text-xs font-medium tracking-wider uppercase">
            {t("avatarDiagnostics.file.imagesCaption")}
          </caption>
          <thead className="bg-muted/40 text-muted-foreground text-left text-xs">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">
                {t("avatarDiagnostics.file.imagePixels")}
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                {t("avatarDiagnostics.file.imageFormat")}
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                {t("avatarDiagnostics.file.imageSize")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-border/60 divide-y">
            {textures.map((texture, index) => (
              <tr key={index}>
                <td className="px-4 py-1.5 tabular-nums">
                  {texture.width && texture.height
                    ? `${format.number(texture.width)} × ${format.number(texture.height)}`
                    : t("avatarDiagnostics.unknown")}
                </td>
                <td className="text-muted-foreground px-4 py-1.5 font-mono text-xs">
                  {texture.mimeType ?? t("avatarDiagnostics.unknown")}
                </td>
                <td className="px-4 py-1.5 text-right tabular-nums">
                  {texture.byteLength !== null
                    ? format.fileSize(texture.byteLength)
                    : t("avatarDiagnostics.file.imageExternal")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

function NotLoaded() {
  const { t } = useTranslation("animas");
  return <Notice tone="warning">{t("avatarDiagnostics.notLoaded")}</Notice>;
}

function FaceSection({ report }: { report: AvatarDiagnosticsReport }) {
  const { t } = useTranslation("animas");
  const format = useFormatters();
  const face = report.live?.face;
  if (!face) return <NotLoaded />;
  return (
    <div className="flex flex-col gap-4">
      {face.detected ? null : (
        <Notice tone="warning">
          {t("avatarDiagnostics.issues.face_parts_detection_failed")}
        </Notice>
      )}
      {face.parts.length > 0 ? (
        <table className="border-border/60 w-full overflow-hidden rounded-lg border text-sm">
          <thead className="bg-muted/40 text-muted-foreground text-left text-xs">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">
                {t("avatarDiagnostics.face.part")}
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                {t("avatarDiagnostics.face.foundBy")}
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                {t("avatarDiagnostics.face.meshParts")}
              </th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                {t("avatarDiagnostics.face.confidence")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-border/60 divide-y">
            {face.parts.map((part) => (
              <tr key={part.role}>
                <td className="px-4 py-1.5">{facePartRoleName(part.role)}</td>
                <td
                  className={cn(
                    "px-4 py-1.5",
                    part.source === "missing" && "text-muted-foreground",
                  )}
                >
                  {partSourceLabel(t, part.source)}
                </td>
                <td className="px-4 py-1.5 text-right tabular-nums">
                  {part.regionCount > 0
                    ? [
                        ...(part.bindingCount > 0
                          ? [format.number(part.bindingCount)]
                          : []),
                        t("avatarDiagnostics.face.sharedRegions", {
                          count: part.regionCount,
                        }),
                      ].join(" · ")
                    : format.number(part.bindingCount)}
                </td>
                <td className="px-4 py-1.5 text-right tabular-nums">
                  {format.number(part.confidence, { style: "percent" })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <FactList>
        <Fact label={t("avatarDiagnostics.face.landmarks")}>
          {readyLabel(t, face.landmarks)}
        </Fact>
        <Fact label={t("avatarDiagnostics.face.textureAnchors")}>
          {readyLabel(t, face.textureAnchors)}
        </Fact>
      </FactList>
    </div>
  );
}

function ExpressionsSection({ report }: { report: AvatarDiagnosticsReport }) {
  const { t } = useTranslation("animas");
  const expressions = report.live?.expressions;
  if (!expressions) return <NotLoaded />;
  const unresolved = [
    ...expressions.unresolved.names,
    ...(expressions.unresolved.otherCount > 0
      ? [
          t("avatarDiagnostics.expressions.customNames", {
            count: expressions.unresolved.otherCount,
          }),
        ]
      : []),
  ];
  return (
    <FactList>
      <Fact label={t("avatarDiagnostics.expressions.present")}>
        <Names
          names={expressions.presets.map((preset) =>
            preset.source === "arkit"
              ? t("avatarDiagnostics.expressions.fromArkit", {
                  name: preset.name,
                })
              : preset.source === "mmd"
                ? t("avatarDiagnostics.expressions.fromMmd", {
                    name: preset.name,
                  })
                : preset.name,
          )}
          none={t("avatarDiagnostics.none")}
        />
      </Fact>
      <Fact label={t("avatarDiagnostics.expressions.missing")}>
        <Names
          names={expressions.missingPresets}
          none={t("avatarDiagnostics.none")}
        />
      </Fact>
      <Fact label={t("avatarDiagnostics.expressions.arkit")}>
        {t("avatarDiagnostics.expressions.arkitValue", {
          resolved: expressions.arkit.resolved,
          total: expressions.arkit.total,
        })}
      </Fact>
      <Fact label={t("avatarDiagnostics.expressions.playsFaces")}>
        {expressions.arkit.playsFaces
          ? t("avatarDiagnostics.yes")
          : t("avatarDiagnostics.no")}
      </Fact>
      <Fact label={t("avatarDiagnostics.expressions.moods")}>
        {expressions.moods.length > 0 ? (
          <ul className="grid gap-1">
            {expressions.moods.map((mood) => (
              <li key={mood.preset} className="flex flex-wrap gap-x-2">
                <span className="font-mono text-xs">{mood.preset}</span>
                <span className="text-muted-foreground">
                  {t("avatarDiagnostics.expressions.moodValue", {
                    brow: regionSourceLabel(t, mood.brow),
                    eye: regionSourceLabel(t, mood.eye),
                    mouth: regionSourceLabel(t, mood.mouth),
                  })}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-muted-foreground">
            {t("avatarDiagnostics.none")}
          </span>
        )}
      </Fact>
      <Fact label={t("avatarDiagnostics.expressions.unresolved")}>
        <Names names={unresolved} none={t("avatarDiagnostics.none")} />
      </Fact>
    </FactList>
  );
}

function MotionSection({ report }: { report: AvatarDiagnosticsReport }) {
  const { t } = useTranslation("animas");
  const { t: tSettings } = useTranslation("settings");
  const format = useFormatters();
  const motion = report.live?.motion;
  if (!motion) return <NotLoaded />;
  const windEffect =
    motion.wind.mode === "springs_off"
      ? t("avatarDiagnostics.motion.windEffect.held")
      : motion.wind.ambientForces
        ? t("avatarDiagnostics.motion.windEffect.on")
        : motion.wind.mode === "automatic"
          ? t("avatarDiagnostics.motion.windEffect.tunedWithout")
          : t("avatarDiagnostics.motion.windEffect.off");
  return (
    <FactList>
      <Fact label={t("avatarDiagnostics.motion.humanoidBones")}>
        {format.number(motion.humanoidBones)}
      </Fact>
      <Fact label={t("avatarDiagnostics.motion.missingBones")}>
        <Names
          names={motion.missingRequiredBones}
          none={t("avatarDiagnostics.none")}
        />
      </Fact>
      <Fact label={t("avatarDiagnostics.motion.springs")}>
        {t("avatarDiagnostics.motion.springsValue", {
          joints: format.number(motion.springJoints),
          colliders: format.number(motion.springColliders),
        })}
      </Fact>
      <Fact label={t("avatarDiagnostics.motion.wind")}>
        {t("avatarDiagnostics.motion.windValue", {
          mode: springModeLabel(tSettings, motion.wind.mode),
          effect: windEffect,
        })}
        <SettingSource source={report.settings?.springModeSource ?? null} />
      </Fact>
      <Fact label={t("avatarDiagnostics.motion.restPose")}>
        <span className="text-muted-foreground">
          {t("avatarDiagnostics.motion.notChecked")}
        </span>
      </Fact>
    </FactList>
  );
}

function WarningsSection({
  issues,
  effectNames,
}: {
  issues: readonly AvatarIssue[];
  effectNames: ReadonlyMap<string, string>;
}) {
  const { t } = useTranslation("animas");
  if (issues.length === 0) {
    return (
      <Notice tone="success">{t("avatarDiagnostics.warnings.none")}</Notice>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {issues.map((issue, index) => (
        <li
          key={index}
          className="border-warning/30 bg-warning/5 flex items-start gap-3 rounded-lg border px-4 py-3"
        >
          <AlertTriangle
            className="text-warning mt-0.5 h-4 w-4 shrink-0"
            aria-hidden
          />
          <div className="min-w-0">
            <p className="text-foreground text-sm">
              {avatarIssueText(t, issue, (id) => effectNames.get(id))}
            </p>
            <p className="text-muted-foreground text-2xs mt-0.5 font-mono">
              {issue.code}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Sections nested deeper than this start collapsed in the JSON view. */
const JSON_OPEN_DEPTH = 2;

function JsonSection({
  report,
  json,
}: {
  report: AvatarDiagnosticsReport;
  json: string;
}) {
  const { t } = useTranslation("animas");
  // Remounting the tree applies a new depth to every node.
  const [view, setView] = useState({ openDepth: JSON_OPEN_DEPTH, key: 0 });
  const expandTo = (openDepth: number) =>
    setView((current) => ({ openDepth, key: current.key + 1 }));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        {t("avatarDiagnostics.json.description")}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void copyText(json, t("avatarDiagnostics.json.copied"), t)
          }
        >
          <Braces /> {t("avatarDiagnostics.json.copy")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => expandTo(Number.POSITIVE_INFINITY)}
        >
          <ChevronsUpDown /> {t("avatarDiagnostics.json.expandAll")}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => expandTo(1)}>
          <ChevronsDownUp /> {t("avatarDiagnostics.json.collapseAll")}
        </Button>
      </div>
      <JsonTree
        key={view.key}
        value={report}
        openDepth={view.openDepth}
        label={t("avatarDiagnostics.sections.json")}
        className="border-border/60 bg-background min-h-0 flex-1 overflow-auto rounded-lg border p-3"
      />
    </div>
  );
}

async function copyText(text: string, done: string, t: TFunction<"animas">) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(done);
  } catch {
    toast.error(t("avatarDiagnostics.copyFailed"));
  }
}

function identityLabel(
  t: TFunction<"animas">,
  report: AvatarDiagnosticsReport,
): string {
  switch (report.avatar.source) {
    case "included":
      return t("avatarDiagnostics.identity.included");
    case "local":
      return t("avatarDiagnostics.identity.local");
    case "upload":
      return t("avatarDiagnostics.identity.upload");
    default:
      return t("avatarDiagnostics.identity.unknown");
  }
}

/** Where the live facts come from: the Avatar on screen, or a load for this view. */
function liveSourceLabel(
  t: TFunction<"animas">,
  kind: AvatarDiagnosticsSource["kind"],
  live: boolean,
): string {
  if (kind === "upload") {
    return live
      ? t("avatarDiagnostics.source.uploadStage")
      : t("avatarDiagnostics.source.notLoaded");
  }
  if (!live) return t("avatarDiagnostics.source.offscreen");
  return kind === "anima"
    ? t("avatarDiagnostics.source.live")
    : t("avatarDiagnostics.source.dock");
}

type AvatarDiagnosticsDialogProps = {
  source: AvatarDiagnosticsSource;
  /**
   * Diagnostics the caller already collects for `source`, so the dialog does
   * not read the Avatar a second time.
   */
  view?: AvatarDiagnosticsView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Avatar Diagnostics: what Animama found in an Avatar file and how it plays
 * it, with a shareable report free of paths and names. It describes an
 * Anima's Avatar, an Avatar item or an unsaved upload (`source`).
 */
export function AvatarDiagnosticsDialog({
  source,
  view,
  open,
  onOpenChange,
}: AvatarDiagnosticsDialogProps) {
  const { t } = useTranslation("animas");
  const own = useAvatarDiagnostics(source, open && !view);
  const { state, effectNames } = view ?? own;
  const [section, setSection] = useState<DiagnosticsSection>("file");
  const report = state.status === "ready" ? state.report : null;
  const json = useMemo(
    () => (report ? avatarDiagnosticsJson(report) : ""),
    [report],
  );
  // The rows on screen, which can outnumber the report's merged findings.
  const warningCount = state.status === "ready" ? state.issues.length : 0;
  const sectionLabels = Object.fromEntries(
    SECTIONS.map((id) => [
      id,
      id === "warnings" && warningCount > 0
        ? t("avatarDiagnostics.sections.warningsCount", { count: warningCount })
        : sectionLabel(t, id),
    ]),
  ) as Record<DiagnosticsSection, string>;

  let body: ReactNode;
  if (state.status === "loading") {
    body = (
      <div
        role="status"
        className="text-muted-foreground flex items-center gap-2 text-sm"
      >
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
        {t("avatarDiagnostics.loading")}
      </div>
    );
  } else if (state.status === "unavailable" || !report) {
    body = <Notice tone="info">{t("avatarDiagnostics.unavailable")}</Notice>;
  } else if (section === "file") {
    body = <FileSection report={report} />;
  } else if (section === "face") {
    body = <FaceSection report={report} />;
  } else if (section === "expressions") {
    body = <ExpressionsSection report={report} />;
  } else if (section === "motion") {
    body = <MotionSection report={report} />;
  } else if (section === "warnings") {
    body = <WarningsSection issues={state.issues} effectNames={effectNames} />;
  } else {
    body = <JsonSection report={report} json={json} />;
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <DialogOverlay />
        <SectionedModalFrame<DiagnosticsSection>
          title={t("avatarDiagnostics.title")}
          description={t("avatarDiagnostics.description")}
          closeLabel={t("avatarDiagnostics.close")}
          sidebarLabel={t("avatarDiagnostics.navigationLabel")}
          sidebarTitle={t("avatarDiagnostics.title")}
          sections={SECTIONS}
          sectionIcons={SECTION_ICONS}
          sectionLabels={sectionLabels}
          activeSection={section}
          onSectionChange={setSection}
          avoidSidebar
          sidebarHeader={
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Box className="text-muted-foreground h-4 w-4" aria-hidden />
                <p className="text-foreground text-sm font-semibold">
                  {t("avatarDiagnostics.title")}
                </p>
              </div>
              {report ? (
                <p className="text-muted-foreground text-xs">
                  {identityLabel(t, report)}
                  {" · "}
                  {liveSourceLabel(
                    t,
                    source.kind,
                    state.status === "ready" && state.live,
                  )}
                </p>
              ) : null}
              <Button
                size="sm"
                disabled={!report}
                onClick={() =>
                  report &&
                  void copyText(
                    avatarDiagnosticsText(report),
                    t("avatarDiagnostics.copied"),
                    t,
                  )
                }
              >
                <ClipboardCopy /> {t("avatarDiagnostics.copyReport")}
              </Button>
              <p className="text-muted-foreground text-2xs max-md:hidden">
                {t("avatarDiagnostics.privacy")}
              </p>
            </div>
          }
          headerTitle={sectionLabel(t, section)}
          contentClassName="gap-5"
        >
          {body}
        </SectionedModalFrame>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

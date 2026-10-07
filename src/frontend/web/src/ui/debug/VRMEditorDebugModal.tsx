"use client";

import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { RefreshCw, RotateCcw } from "lucide-react";

import { useSoundController } from "@/hooks/use-sound-controller";
import { useVRMEditorSession } from "@/hooks/useVRMEditorSession";
import type { AvatarVFXAppliedEffectSnapshot } from "@/lib/avatar";
import { AppImage } from "@/platform/image/AppImage";
import { useVRMEditorDebugStore } from "@/stores/vrm-editor-debug-store";
import { Button } from "@/ui/components/button";
import { DialogOverlay } from "@/ui/components/dialog";
import { SectionedModalFrame } from "@/ui/components/sectioned-modal-frame";
import { Switch } from "@/ui/components/switch";
import {
  BodyCell,
  EmptyState,
  HeaderCell,
  KeyValueGrid,
  Panel,
  Table,
  WarningList,
} from "./vrm-editor/controls";
import { resolveFaceTexturePreview } from "./vrm-editor/face-preview";
import {
  formatBytes,
  formatDateTime,
  formatInteger,
  formatJsonValue,
  formatMaybeText,
} from "./vrm-editor/formatting";
import { JsonTreeNode, type JsonExpandMode } from "./vrm-editor/json-tree";
import { EffectsSection } from "./vrm-editor/effects/section";
import { useVFXCatalogDrafts } from "./vrm-editor/effects/use-vfx-catalog-drafts";
import { SceneVFXSection } from "./vrm-editor/scene-vfx/section";
import { useSceneVFXDrafts } from "./vrm-editor/scene-vfx/use-scene-vfx-drafts";

const sections = [
  "Overview",
  "Nodes",
  "Geometry",
  "Rig",
  "Materials",
  "Effects",
  "Scene VFX",
  "Raw JSON",
] as const;

type VRMEditorDebugSection = (typeof sections)[number];

function SectionDescription(section: VRMEditorDebugSection): string {
  switch (section) {
    case "Overview":
      return "Source details, VRM metadata, asset info, warnings, and totals.";
    case "Nodes":
      return "Hierarchy and node-level structure from the active VRM asset.";
    case "Geometry":
      return "Mesh and primitive usage rows, including live runtime toggle bindings.";
    case "Rig":
      return "Humanoid bones and skin relationships used by the active avatar.";
    case "Materials":
      return "Material inventory, texture slot usage, and referenced images.";
    case "Effects":
      return "Manual texture and hover-plane VFX controls for eye and face targets on the live avatar.";
    case "Scene VFX":
      return "Scene-scoped background and focus-lines VFX controls for under-canvas and over-canvas presentation.";
    case "Raw JSON":
      return "Raw VRM/glTF JSON with a collapsible tree viewer.";
    default:
      return "";
  }
}

export function VRMEditorDebugModal({ animaLabel }: { animaLabel?: string }) {
  const { playBuiltInSfxCue } = useSoundController();
  const open = useVRMEditorDebugStore((state) => state.isOpen);
  const setOpen = useVRMEditorDebugStore((state) => state.setOpen);
  const target = useVRMEditorDebugStore((state) => state.target);
  const showFaceDebugBox = useVRMEditorDebugStore(
    (state) => state.showFaceDebugBox,
  );
  const setShowFaceDebugBox = useVRMEditorDebugStore(
    (state) => state.setShowFaceDebugBox,
  );
  const [activeSection, setActiveSection] =
    useState<VRMEditorDebugSection>("Overview");
  const [initializedTargetKey, setInitializedTargetKey] = useState<
    string | null
  >(null);
  const [previewTextureIndex, setPreviewTextureIndex] = useState<number | null>(
    null,
  );
  const [jsonExpandMode, setJsonExpandMode] = useState<JsonExpandMode>("smart");
  const [jsonResetToken, setJsonResetToken] = useState(0);

  const targetKey =
    target?.sourceKey ??
    target?.sourceUrl ??
    target?.avatar.sourceUrl ??
    target?.avatar.scene?.uuid ??
    null;
  const sceneVFXDrafts = useSceneVFXDrafts({ open, targetKey });

  useEffect(() => {
    setPreviewTextureIndex(null);
  }, [targetKey]);

  useEffect(() => {
    if (!open) {
      setPreviewTextureIndex(null);
    }
  }, [open]);

  useEffect(() => {
    if (!targetKey) {
      setInitializedTargetKey(null);
      return;
    }
    if (open) {
      setInitializedTargetKey(targetKey);
      return;
    }
    if (initializedTargetKey && initializedTargetKey !== targetKey) {
      setInitializedTargetKey(null);
    }
  }, [initializedTargetKey, open, targetKey]);

  const sessionEnabled = Boolean(
    target && targetKey && (open || initializedTargetKey === targetKey),
  );

  const { session, snapshot, status, refresh } = useVRMEditorSession({
    avatar: target?.avatar ?? null,
    sourceUrl: target?.sourceUrl,
    sourceKey: target?.sourceKey,
    enabled: sessionEnabled,
  });

  const inspection = snapshot.inspection;
  const vfx = snapshot.vfx;
  const rawJson = snapshot.rawJson;
  const vfxCatalogDrafts = useVFXCatalogDrafts({
    targetKey,
    catalog: vfx?.catalog ?? null,
  });
  const faceLandmarks = target?.avatar.getFaceLandmarksSnapshot() ?? null;
  const faceTextureAnchors =
    target?.avatar.getFaceTextureAnchorsSnapshot() ?? null;
  const vfxBindingByKey = useMemo(
    () =>
      new Map(
        (vfx?.targetBindings ?? []).map((binding) => [
          binding.bindingKey,
          binding,
        ]),
      ),
    [vfx],
  );
  const vfxActiveEffectsByEffectId = useMemo(() => {
    const next = new Map<string, AvatarVFXAppliedEffectSnapshot[]>();
    (vfx?.activeEffects ?? []).forEach((effect) => {
      const current = next.get(effect.effectId) ?? [];
      current.push(effect);
      next.set(effect.effectId, current);
    });
    return next;
  }, [vfx]);
  const effectWarnings = useMemo(
    () => Array.from(new Set([...snapshot.warnings, ...(vfx?.warnings ?? [])])),
    [snapshot.warnings, vfx],
  );
  const previewTexture =
    inspection?.textures.find(
      (texture) => texture.index === previewTextureIndex,
    ) ?? null;
  const faceTexturePreview = useMemo(
    () =>
      resolveFaceTexturePreview({
        inspection,
        faceTextureAnchors,
      }),
    [faceTextureAnchors, inspection],
  );
  const overviewRows = useMemo(
    () =>
      inspection
        ? [
            {
              label: "Status",
              value: (
                <span className="font-medium">
                  {status === "loading"
                    ? "Loading"
                    : status === "error"
                      ? "Error"
                      : "Ready"}
                </span>
              ),
            },
            { label: "Source mode", value: inspection.sourceMode },
            {
              label: "Source URL",
              value: formatMaybeText(inspection.source.sourceUrl),
            },
            {
              label: "Source key",
              value: formatMaybeText(inspection.source.sourceKey),
            },
            {
              label: "Byte length",
              value: formatBytes(inspection.source.byteLength),
            },
            {
              label: "Fetched",
              value: formatDateTime(inspection.source.fetchedAtMs),
            },
            { label: "VRM spec", value: inspection.asset.specVersion },
            {
              label: "VRM extension",
              value: formatMaybeText(inspection.asset.vrmExtensionName),
            },
            {
              label: "Generator",
              value: formatMaybeText(inspection.asset.generator),
            },
            {
              label: "Asset version",
              value: formatMaybeText(inspection.asset.version),
            },
            {
              label: "Min version",
              value: formatMaybeText(inspection.asset.minVersion),
            },
            {
              label: "Extensions used",
              value:
                inspection.asset.extensionsUsed.length > 0
                  ? inspection.asset.extensionsUsed.join(", ")
                  : "-",
            },
            {
              label: "Extensions required",
              value:
                inspection.asset.extensionsRequired.length > 0
                  ? inspection.asset.extensionsRequired.join(", ")
                  : "-",
            },
            {
              label: "Top-level extensions",
              value:
                inspection.asset.topLevelExtensionKeys.length > 0
                  ? inspection.asset.topLevelExtensionKeys.join(", ")
                  : "-",
            },
          ]
        : [],
    [inspection, status],
  );

  const totalsRows = useMemo(
    () =>
      inspection
        ? [
            {
              label: "Nodes",
              value: formatInteger(inspection.totals.nodeCount),
            },
            {
              label: "Meshes",
              value: formatInteger(inspection.totals.meshCount),
            },
            {
              label: "Primitives",
              value: formatInteger(inspection.totals.primitiveCount),
            },
            {
              label: "Primitive usages",
              value: formatInteger(inspection.totals.primitiveUsageCount),
            },
            {
              label: "Runtime bound usages",
              value: formatInteger(
                inspection.totals.runtimeBoundPrimitiveUsageCount,
              ),
            },
            {
              label: "Vertices",
              value: formatInteger(inspection.totals.vertexCount),
            },
            {
              label: "Indices",
              value: formatInteger(inspection.totals.indexCount),
            },
            {
              label: "Skins",
              value: formatInteger(inspection.totals.skinCount),
            },
            {
              label: "Bones",
              value: formatInteger(inspection.totals.boneCount),
            },
            {
              label: "Materials",
              value: formatInteger(inspection.totals.materialCount),
            },
            {
              label: "Textures",
              value: formatInteger(inspection.totals.textureCount),
            },
            {
              label: "Active overrides",
              value: formatInteger(inspection.totals.activeOverrideCount),
            },
          ]
        : [],
    [inspection],
  );

  const modalHeaderMeta = (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          void refresh();
        }}
        disabled={!target || status === "loading"}
      >
        <RefreshCw className="h-4 w-4" />
        Refresh
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => session?.resetRuntimeOverrides()}
        disabled={!session || snapshot.activeOverrideCount === 0}
      >
        <RotateCcw className="h-4 w-4" />
        Reset overrides
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => session?.clearVFXEffects()}
        disabled={!session || !vfx || vfx.activeEffects.length === 0}
      >
        Reset VFX
      </Button>
      <label className="border-border/60 bg-background/70 text-foreground ml-1 inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
        <Switch
          checked={showFaceDebugBox}
          onCheckedChange={setShowFaceDebugBox}
          aria-label="Toggle face debug box"
          disabled={!target}
        />
        <span>Face debug box</span>
      </label>
    </div>
  );

  const resetJsonTree = (nextMode: JsonExpandMode) => {
    setJsonExpandMode(nextMode);
    setJsonResetToken((current) => current + 1);
  };

  const renderContent = () => {
    if (!target) {
      return (
        <EmptyState
          title="No active avatar"
          description="Load a anima avatar in the main canvas to inspect its VRM asset."
        />
      );
    }

    if (activeSection === "Scene VFX") {
      return <SceneVFXSection drafts={sceneVFXDrafts} />;
    }

    if (activeSection === "Effects") {
      return (
        <EffectsSection
          status={status}
          vfx={vfx}
          faceLandmarks={faceLandmarks}
          faceTextureAnchors={faceTextureAnchors}
          faceTexturePreview={faceTexturePreview}
          effectWarnings={effectWarnings}
          session={session}
          onOpenTexturePreview={setPreviewTextureIndex}
          playSfxCue={playBuiltInSfxCue}
          vfxBindingByKey={vfxBindingByKey}
          vfxActiveEffectsByEffectId={vfxActiveEffectsByEffectId}
          drafts={vfxCatalogDrafts}
        />
      );
    }

    if (!inspection && status === "loading") {
      return (
        <EmptyState
          title="Loading VRM inspection"
          description="Reading the active VRM asset and building runtime bindings."
        />
      );
    }

    if (!inspection) {
      return (
        <EmptyState
          title="VRM inspection unavailable"
          description={
            snapshot.error ?? "The active avatar could not be inspected."
          }
        />
      );
    }

    if (activeSection === "Overview") {
      const metadataEntries = Object.entries(inspection.metadata ?? {});

      return (
        <div className="space-y-4">
          <WarningList warnings={snapshot.warnings} />
          <Panel
            title="Source"
            description="The parsed asset and VRM extension summary."
          >
            <KeyValueGrid rows={overviewRows} />
          </Panel>
          <Panel
            title="Totals"
            description="Top-level counts derived from the active snapshot."
          >
            <KeyValueGrid rows={totalsRows} />
          </Panel>
          <Panel
            title="Metadata"
            description="VRM metadata taken from the raw extension payload when available."
          >
            {metadataEntries.length > 0 ? (
              <div className="space-y-2">
                {metadataEntries.map(([key, value]) => (
                  <div
                    key={key}
                    className="border-border/60 bg-background/70 rounded-lg border p-3"
                  >
                    <p className="text-muted-foreground text-2xs font-medium tracking-wide uppercase">
                      {key}
                    </p>
                    <pre className="text-foreground mt-1 overflow-x-auto font-mono text-xs break-words whitespace-pre-wrap">
                      {formatJsonValue(value)}
                    </pre>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No metadata"
                description="The active asset did not expose VRM metadata."
              />
            )}
          </Panel>
        </div>
      );
    }

    if (activeSection === "Nodes") {
      return (
        <Panel
          title="Nodes"
          description="Hierarchy rows include node index, kind, parent, mesh, skin, and transform data."
        >
          <Table>
            <thead>
              <tr>
                <HeaderCell>#</HeaderCell>
                <HeaderCell>Name</HeaderCell>
                <HeaderCell>Kind</HeaderCell>
                <HeaderCell>Parent</HeaderCell>
                <HeaderCell>Children</HeaderCell>
                <HeaderCell>Mesh</HeaderCell>
                <HeaderCell>Skin</HeaderCell>
                <HeaderCell>Transform</HeaderCell>
              </tr>
            </thead>
            <tbody className="divide-border/60 divide-y">
              {inspection.nodes.map((node) => (
                <tr key={node.index}>
                  <BodyCell className="font-mono text-xs">
                    {node.index}
                  </BodyCell>
                  <BodyCell>{formatMaybeText(node.name)}</BodyCell>
                  <BodyCell>{node.kind}</BodyCell>
                  <BodyCell className="font-mono text-xs">
                    {formatInteger(node.parentIndex)}
                  </BodyCell>
                  <BodyCell className="font-mono text-xs">
                    {node.childIndices.length > 0
                      ? node.childIndices.join(", ")
                      : "-"}
                  </BodyCell>
                  <BodyCell className="font-mono text-xs">
                    {formatInteger(node.meshIndex)}
                  </BodyCell>
                  <BodyCell className="font-mono text-xs">
                    {formatInteger(node.skinIndex)}
                  </BodyCell>
                  <BodyCell className="font-mono text-2xs">
                    <div>T {formatJsonValue(node.translation)}</div>
                    <div>R {formatJsonValue(node.rotation)}</div>
                    <div>S {formatJsonValue(node.scale)}</div>
                  </BodyCell>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      );
    }

    if (activeSection === "Geometry") {
      return (
        <div className="space-y-4">
          <Panel
            title="Meshes"
            description="Aggregated mesh inventory and node usage."
          >
            <Table>
              <thead>
                <tr>
                  <HeaderCell>#</HeaderCell>
                  <HeaderCell>Name</HeaderCell>
                  <HeaderCell>Primitives</HeaderCell>
                  <HeaderCell>Node usage</HeaderCell>
                </tr>
              </thead>
              <tbody className="divide-border/60 divide-y">
                {inspection.meshes.map((mesh) => (
                  <tr key={mesh.index}>
                    <BodyCell className="font-mono text-xs">
                      {mesh.index}
                    </BodyCell>
                    <BodyCell>{formatMaybeText(mesh.name)}</BodyCell>
                    <BodyCell className="font-mono text-xs">
                      {formatInteger(mesh.primitiveCount)}
                    </BodyCell>
                    <BodyCell className="font-mono text-xs">
                      {mesh.nodeIndices.length > 0
                        ? mesh.nodeIndices.join(", ")
                        : "-"}
                    </BodyCell>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Panel>
          <Panel
            title="Primitive usages"
            description="Each row is one mesh primitive bound to one node usage in the rendered avatar."
          >
            <Table>
              <thead>
                <tr>
                  <HeaderCell>Node</HeaderCell>
                  <HeaderCell>Mesh</HeaderCell>
                  <HeaderCell>Primitive</HeaderCell>
                  <HeaderCell>Material</HeaderCell>
                  <HeaderCell>Vertices</HeaderCell>
                  <HeaderCell>Indices</HeaderCell>
                  <HeaderCell>Attributes</HeaderCell>
                  <HeaderCell>Runtime</HeaderCell>
                  <HeaderCell className="text-right">Visibility</HeaderCell>
                </tr>
              </thead>
              <tbody className="divide-border/60 divide-y">
                {inspection.primitiveUsages.map((usage) => (
                  <tr key={usage.bindingKey}>
                    <BodyCell>
                      <div>{formatMaybeText(usage.nodeName)}</div>
                      <div className="text-muted-foreground font-mono text-2xs">
                        node {formatInteger(usage.nodeIndex)}
                        {usage.skinIndex !== null
                          ? ` | skin ${usage.skinIndex}`
                          : ""}
                      </div>
                    </BodyCell>
                    <BodyCell>
                      <div>{formatMaybeText(usage.meshName)}</div>
                      <div className="text-muted-foreground font-mono text-2xs">
                        mesh {usage.meshIndex}
                      </div>
                    </BodyCell>
                    <BodyCell className="font-mono text-xs">
                      {usage.primitiveIndex}
                    </BodyCell>
                    <BodyCell>
                      <div>{formatMaybeText(usage.materialName)}</div>
                      <div className="text-muted-foreground font-mono text-2xs">
                        material {formatInteger(usage.materialIndex)}
                      </div>
                    </BodyCell>
                    <BodyCell className="font-mono text-xs">
                      {formatInteger(usage.vertexCount)}
                    </BodyCell>
                    <BodyCell className="font-mono text-xs">
                      {formatInteger(usage.indexCount)}
                    </BodyCell>
                    <BodyCell className="font-mono text-2xs">
                      {usage.attributeNames.length > 0
                        ? usage.attributeNames.join(", ")
                        : "-"}
                    </BodyCell>
                    <BodyCell>
                      <div>{formatMaybeText(usage.runtimeObjectName)}</div>
                      <div className="text-muted-foreground font-mono text-2xs">
                        {usage.runtimeObjectType ?? "-"}
                      </div>
                    </BodyCell>
                    <BodyCell className="text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant={
                          usage.isRuntimeVisible === false
                            ? "secondary"
                            : "outline"
                        }
                        onClick={() =>
                          session?.setPrimitiveVisibility(
                            usage.bindingKey,
                            !(usage.isRuntimeVisible ?? true),
                          )
                        }
                        disabled={!session || !usage.isRuntimeBound}
                      >
                        {usage.isRuntimeVisible === false ? "Show" : "Hide"}
                      </Button>
                    </BodyCell>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Panel>
        </div>
      );
    }

    if (activeSection === "Rig") {
      return (
        <div className="space-y-4">
          <Panel
            title="Bones"
            description="Humanoid bone mapping from raw VRM data with runtime node names when available."
          >
            <Table>
              <thead>
                <tr>
                  <HeaderCell>Bone</HeaderCell>
                  <HeaderCell>Node</HeaderCell>
                  <HeaderCell>Raw node</HeaderCell>
                  <HeaderCell>Normalized node</HeaderCell>
                </tr>
              </thead>
              <tbody className="divide-border/60 divide-y">
                {inspection.bones.map((bone) => (
                  <tr key={bone.humanBoneName}>
                    <BodyCell>{bone.humanBoneName}</BodyCell>
                    <BodyCell>
                      <div>{formatMaybeText(bone.nodeName)}</div>
                      <div className="text-muted-foreground font-mono text-2xs">
                        node {formatInteger(bone.nodeIndex)}
                      </div>
                    </BodyCell>
                    <BodyCell>{formatMaybeText(bone.rawNodeName)}</BodyCell>
                    <BodyCell>
                      {formatMaybeText(bone.normalizedNodeName)}
                    </BodyCell>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Panel>
          <Panel
            title="Skins"
            description="Skin skeleton roots and joint coverage."
          >
            <Table>
              <thead>
                <tr>
                  <HeaderCell>#</HeaderCell>
                  <HeaderCell>Name</HeaderCell>
                  <HeaderCell>Skeleton root</HeaderCell>
                  <HeaderCell>Joint count</HeaderCell>
                  <HeaderCell>Joints</HeaderCell>
                </tr>
              </thead>
              <tbody className="divide-border/60 divide-y">
                {inspection.skins.map((skin) => (
                  <tr key={skin.index}>
                    <BodyCell className="font-mono text-xs">
                      {skin.index}
                    </BodyCell>
                    <BodyCell>{formatMaybeText(skin.name)}</BodyCell>
                    <BodyCell>
                      <div>{formatMaybeText(skin.skeletonNodeName)}</div>
                      <div className="text-muted-foreground font-mono text-2xs">
                        node {formatInteger(skin.skeletonNodeIndex)}
                      </div>
                    </BodyCell>
                    <BodyCell className="font-mono text-xs">
                      {formatInteger(skin.jointCount)}
                    </BodyCell>
                    <BodyCell className="font-mono text-2xs">
                      {skin.jointNames.length > 0
                        ? skin.jointNames.join(", ")
                        : "-"}
                    </BodyCell>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Panel>
        </div>
      );
    }

    if (activeSection === "Raw JSON") {
      return (
        <div className="space-y-4">
          <WarningList warnings={snapshot.warnings} />
          <Panel
            title="Raw VRM JSON"
            description="This is the raw glTF/VRM JSON used for the active inspection snapshot."
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => resetJsonTree("smart")}
                >
                  Reset view
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => resetJsonTree("all")}
                >
                  Expand all
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => resetJsonTree("collapsed")}
                >
                  Collapse all
                </Button>
              </div>
            }
          >
            {rawJson ? (
              <div className="border-border/60 bg-background/80 rounded-lg border p-3">
                <div className="text-muted-foreground mb-3 font-mono text-xs">
                  Root keys: {Object.keys(rawJson).length}
                </div>
                <div className="max-h-[60vh] overflow-auto pr-2">
                  <JsonTreeNode
                    key={`${targetKey ?? "raw-json"}:${jsonExpandMode}:${jsonResetToken}`}
                    label={null}
                    value={rawJson}
                    depth={0}
                    expandMode={jsonExpandMode}
                  />
                </div>
              </div>
            ) : (
              <EmptyState
                title="Raw JSON unavailable"
                description="The active avatar did not expose a raw VRM JSON payload."
              />
            )}
          </Panel>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <Panel
          title="Materials"
          description="Standard glTF and VRM-specific texture slots grouped by material."
        >
          <Table>
            <thead>
              <tr>
                <HeaderCell>#</HeaderCell>
                <HeaderCell>Name</HeaderCell>
                <HeaderCell>Alpha</HeaderCell>
                <HeaderCell>Double sided</HeaderCell>
                <HeaderCell>Extensions</HeaderCell>
                <HeaderCell>Usage count</HeaderCell>
                <HeaderCell>Texture slots</HeaderCell>
              </tr>
            </thead>
            <tbody className="divide-border/60 divide-y">
              {inspection.materials.map((material) => (
                <tr key={material.index}>
                  <BodyCell className="font-mono text-xs">
                    {material.index}
                  </BodyCell>
                  <BodyCell>{formatMaybeText(material.name)}</BodyCell>
                  <BodyCell>{formatMaybeText(material.alphaMode)}</BodyCell>
                  <BodyCell>{material.doubleSided ? "true" : "false"}</BodyCell>
                  <BodyCell className="font-mono text-2xs">
                    {material.extensionNames.length > 0
                      ? material.extensionNames.join(", ")
                      : "-"}
                  </BodyCell>
                  <BodyCell className="font-mono text-xs">
                    {formatInteger(material.usageCount)}
                  </BodyCell>
                  <BodyCell className="font-mono text-2xs">
                    {material.textureSlots.length > 0
                      ? material.textureSlots
                          .map(
                            (slot) =>
                              `${slot.slot} -> tex ${slot.textureIndex} (${slot.source})`,
                          )
                          .join(", ")
                      : "-"}
                  </BodyCell>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
        <Panel
          title="Textures"
          description="Referenced textures and the material slots that use them."
        >
          <Table>
            <thead>
              <tr>
                <HeaderCell>#</HeaderCell>
                <HeaderCell>Preview</HeaderCell>
                <HeaderCell>Name</HeaderCell>
                <HeaderCell>URI</HeaderCell>
                <HeaderCell>MIME</HeaderCell>
                <HeaderCell>Size</HeaderCell>
                <HeaderCell>Usage count</HeaderCell>
                <HeaderCell>Used by</HeaderCell>
              </tr>
            </thead>
            <tbody className="divide-border/60 divide-y">
              {inspection.textures.map((texture) => (
                <tr key={texture.index}>
                  <BodyCell className="font-mono text-xs">
                    {texture.index}
                  </BodyCell>
                  <BodyCell>
                    {texture.previewUrl ? (
                      <button
                        type="button"
                        onClick={() => setPreviewTextureIndex(texture.index)}
                        className="border-border/60 bg-background hover:border-foreground/30 flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border transition"
                        aria-label={`Preview texture ${texture.name ?? texture.index}`}
                      >
                        <AppImage
                          src={texture.previewUrl}
                          alt={texture.name ?? `Texture ${texture.index}`}
                          width={texture.pixelWidth ?? 64}
                          height={texture.pixelHeight ?? 64}
                          unoptimized
                          className="h-full w-full object-contain"
                        />
                      </button>
                    ) : (
                      <span className="text-muted-foreground text-xs">
                        No preview
                      </span>
                    )}
                  </BodyCell>
                  <BodyCell>{formatMaybeText(texture.name)}</BodyCell>
                  <BodyCell className="font-mono text-2xs">
                    {formatMaybeText(texture.uri)}
                  </BodyCell>
                  <BodyCell>{formatMaybeText(texture.mimeType)}</BodyCell>
                  <BodyCell>{formatMaybeText(texture.sizeLabel)}</BodyCell>
                  <BodyCell className="font-mono text-xs">
                    {formatInteger(texture.usageCount)}
                  </BodyCell>
                  <BodyCell className="font-mono text-2xs">
                    {texture.usedBy.length > 0
                      ? texture.usedBy
                          .map(
                            (usage) =>
                              `${usage.materialName ?? `material_${usage.materialIndex}`} / ${usage.slot} (${usage.source})`,
                          )
                          .join(", ")
                      : "-"}
                  </BodyCell>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      </div>
    );
  };

  return (
    <>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <DialogOverlay className="z-40" />
          <SectionedModalFrame
            title="VRM object debug"
            description="Inspect the live VRM asset and runtime bindings for the active avatar."
            closeLabel="Close VRM object debug"
            sidebarLabel="VRM Debug"
            sidebarTitle={animaLabel ?? target?.animaId ?? "VRM inspector"}
            sections={sections}
            activeSection={activeSection}
            onSectionChange={setActiveSection}
            headerTitle={activeSection}
            headerDescription={SectionDescription(activeSection)}
            headerMeta={modalHeaderMeta}
            dialogClassName="w-[min(1680px,96vw)]"
            gridClassName="md:grid-cols-[220px_minmax(0,1fr)]"
          >
            {renderContent()}
          </SectionedModalFrame>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root
        open={Boolean(previewTexture?.previewUrl)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setPreviewTextureIndex(null);
          }
        }}
      >
        <Dialog.Portal>
          <DialogOverlay className="z-[60]" />
          <Dialog.Content className="border-border bg-background fixed top-1/2 left-1/2 z-[61] flex max-h-[92vh] w-[min(96vw,1200px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border shadow-2xl">
            <div className="border-border/60 flex items-start justify-between gap-4 border-b p-4">
              <div>
                <Dialog.Title className="text-foreground text-base font-semibold">
                  {previewTexture?.name ?? "Texture preview"}
                </Dialog.Title>
                <Dialog.Description className="text-muted-foreground mt-1 text-sm">
                  {[
                    formatMaybeText(previewTexture?.mimeType),
                    formatMaybeText(previewTexture?.sizeLabel),
                  ]
                    .filter((value) => value !== "-")
                    .join(" · ") || "Full-size texture preview"}
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <Button type="button" variant="outline" size="sm">
                  Close
                </Button>
              </Dialog.Close>
            </div>
            <div className="bg-muted/20 flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
              {previewTexture?.previewUrl ? (
                <AppImage
                  src={previewTexture.previewUrl}
                  alt={previewTexture.name ?? `Texture ${previewTexture.index}`}
                  width={previewTexture.pixelWidth ?? 1024}
                  height={previewTexture.pixelHeight ?? 1024}
                  unoptimized
                  className="h-auto max-h-full w-auto max-w-full object-contain"
                />
              ) : null}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

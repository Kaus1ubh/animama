import type { Avatar } from "./Avatar";
import type { AvatarVFXSnapshot } from "./vfx/types";

export type VRMSpecVersion = "0" | "1" | "unknown";
export type VRMExtensionName = "VRM" | "VRMC_vrm" | null;
export type VRMInspectionSourceMode =
  | "document"
  | "merged"
  | "runtime_fallback";
export type VRMTextureUsageSource = "standard" | "vrm0" | "mtoon";
export type VRMEditorSessionStatus = "idle" | "loading" | "ready" | "error";

export type VRMDocumentSourceInput = {
  sourceUrl?: string | null;
  arrayBuffer?: ArrayBuffer | null;
  sourceKey?: string | null;
};

export type VRMEditorSessionInput = VRMDocumentSourceInput & {
  avatar: Avatar;
};

export type VRMInspectionSourceSummary = {
  sourceUrl: string | null;
  sourceKey: string | null;
  byteLength: number | null;
  fetchedAtMs: number | null;
};

export type VRMInspectionAssetSummary = {
  generator: string | null;
  version: string | null;
  minVersion: string | null;
  extensionsUsed: string[];
  extensionsRequired: string[];
  topLevelExtensionKeys: string[];
  vrmExtensionName: VRMExtensionName;
  specVersion: VRMSpecVersion;
};

export type VRMInspectionNode = {
  index: number;
  name: string | null;
  kind: string;
  parentIndex: number | null;
  childIndices: number[];
  meshIndex: number | null;
  skinIndex: number | null;
  translation: [number, number, number] | null;
  rotation: [number, number, number, number] | null;
  scale: [number, number, number] | null;
};

export type VRMInspectionMesh = {
  index: number;
  name: string | null;
  primitiveCount: number;
  nodeIndices: number[];
};

export type VRMInspectionPrimitiveUsage = {
  bindingKey: string;
  nodeIndex: number | null;
  nodeName: string | null;
  meshIndex: number;
  meshName: string | null;
  primitiveIndex: number;
  materialIndex: number | null;
  materialName: string | null;
  vertexCount: number | null;
  indexCount: number | null;
  attributeNames: string[];
  mode: number | null;
  skinIndex: number | null;
  skinName: string | null;
  isRuntimeBound: boolean;
  isRuntimeVisible: boolean | null;
  runtimeObjectName: string | null;
  runtimeObjectType: string | null;
};

export type VRMInspectionSkin = {
  index: number;
  name: string | null;
  skeletonNodeIndex: number | null;
  skeletonNodeName: string | null;
  jointCount: number;
  jointNodeIndices: number[];
  jointNames: string[];
};

export type VRMInspectionBone = {
  humanBoneName: string;
  nodeIndex: number | null;
  nodeName: string | null;
  rawNodeName: string | null;
  normalizedNodeName: string | null;
};

export type VRMInspectionMaterialTextureSlot = {
  slot: string;
  textureIndex: number;
  textureName: string | null;
  source: VRMTextureUsageSource;
};

export type VRMInspectionMaterial = {
  index: number;
  name: string | null;
  alphaMode: string | null;
  doubleSided: boolean;
  extensionNames: string[];
  usageCount: number;
  textureSlots: VRMInspectionMaterialTextureSlot[];
};

export type VRMInspectionTextureUsage = {
  materialIndex: number;
  materialName: string | null;
  slot: string;
  source: VRMTextureUsageSource;
};

export type VRMInspectionTexture = {
  index: number;
  name: string | null;
  uri: string | null;
  mimeType: string | null;
  sizeLabel: string | null;
  pixelWidth: number | null;
  pixelHeight: number | null;
  previewUrl: string | null;
  usageCount: number;
  usedBy: VRMInspectionTextureUsage[];
};

export type VRMInspectionTotals = {
  nodeCount: number;
  meshCount: number;
  primitiveCount: number;
  primitiveUsageCount: number;
  vertexCount: number;
  indexCount: number;
  skinCount: number;
  boneCount: number;
  materialCount: number;
  textureCount: number;
  runtimeBoundPrimitiveUsageCount: number;
  activeOverrideCount: number;
};

export type VRMInspectionSnapshot = {
  sourceMode: VRMInspectionSourceMode;
  source: VRMInspectionSourceSummary;
  asset: VRMInspectionAssetSummary;
  metadata: Record<string, unknown> | null;
  warnings: string[];
  totals: VRMInspectionTotals;
  nodes: VRMInspectionNode[];
  meshes: VRMInspectionMesh[];
  primitiveUsages: VRMInspectionPrimitiveUsage[];
  skins: VRMInspectionSkin[];
  bones: VRMInspectionBone[];
  materials: VRMInspectionMaterial[];
  textures: VRMInspectionTexture[];
};

export type VRMRuntimePrimitiveBinding = {
  bindingKey: string;
  nodeIndex: number | null;
  meshIndex: number;
  primitiveIndex: number;
  materialIndex: number | null;
  materialName: string | null;
  objectName: string | null;
  objectType: string;
  visible: boolean;
  originalVisible: boolean;
  isSkinnedMesh: boolean;
};

export type VRMEditorSessionSnapshot = {
  status: VRMEditorSessionStatus;
  error: string | null;
  warnings: string[];
  inspection: VRMInspectionSnapshot | null;
  vfx: AvatarVFXSnapshot | null;
  rawJson: Record<string, unknown> | null;
  primitiveBindings: VRMRuntimePrimitiveBinding[];
  activeOverrideCount: number;
  canEdit: boolean;
};

import * as THREE from "three";
import type {
  Document as TransformDocument,
  GLTF as TransformGLTF,
  JSONDocument,
} from "@gltf-transform/core";

import type { Avatar } from "./Avatar";
import type {
  VRMEditorSessionSnapshot,
  VRMInspectionBone,
  VRMInspectionMaterial,
  VRMInspectionMaterialTextureSlot,
  VRMInspectionMesh,
  VRMInspectionNode,
  VRMInspectionPrimitiveUsage,
  VRMInspectionSnapshot,
  VRMInspectionSkin,
  VRMInspectionSourceMode,
  VRMInspectionSourceSummary,
  VRMInspectionTexture,
  VRMRuntimePrimitiveBinding,
  VRMSpecVersion,
} from "./vrm-editor-types";

type RawGltf = TransformGLTF.IGLTF;
type RawNode = NonNullable<RawGltf["nodes"]>[number];
type RawMaterial = NonNullable<RawGltf["materials"]>[number];
type RuntimePrimitiveBindingEntry = VRMRuntimePrimitiveBinding & {
  object: THREE.Mesh;
};

const VRM_EXTENSION_PATTERN = /^(VRM|VRMC_)/;
const DEFAULT_PRIMITIVE_MODE = 4;

type BuildInspectionSnapshotArgs = {
  sourceMode: VRMInspectionSourceMode;
  source: VRMInspectionSourceSummary;
  rawJson: RawGltf;
  document?: TransformDocument | null;
  texturePreviewUrlByIndex?: Map<number, string>;
  primitiveBindings?: VRMRuntimePrimitiveBinding[];
  activeOverrideCount?: number;
  avatar?: Avatar | null;
  warnings?: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function toVec3(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const x = toNumberOrNull(value[0]);
  const y = toNumberOrNull(value[1]);
  const z = toNumberOrNull(value[2]);
  return x === null || y === null || z === null ? null : [x, y, z];
}

function toVec4(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length < 4) return null;
  const x = toNumberOrNull(value[0]);
  const y = toNumberOrNull(value[1]);
  const z = toNumberOrNull(value[2]);
  const w = toNumberOrNull(value[3]);
  return x === null || y === null || z === null || w === null
    ? null
    : [x, y, z, w];
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

function formatTextureSize(value: [number, number] | null): string | null {
  if (!value) return null;
  return `${value[0]}x${value[1]}`;
}

function buildParentIndexMap(rawNodes: RawNode[]): Map<number, number | null> {
  const parentIndexMap = new Map<number, number | null>();
  rawNodes.forEach((_node, index) => {
    parentIndexMap.set(index, null);
  });

  rawNodes.forEach((node, parentIndex) => {
    const children = Array.isArray(node.children) ? node.children : [];
    children.forEach((childIndex) => {
      if (typeof childIndex === "number") {
        parentIndexMap.set(childIndex, parentIndex);
      }
    });
  });

  return parentIndexMap;
}

function buildPrimitiveBindingKey(
  nodeIndex: number | null,
  meshIndex: number,
  primitiveIndex: number,
  fallbackKey: string | null = null,
): string {
  if (nodeIndex !== null) {
    return `${nodeIndex}:${meshIndex}:${primitiveIndex}`;
  }
  if (fallbackKey) {
    return `${fallbackKey}:${meshIndex}:${primitiveIndex}`;
  }
  return `mesh:${meshIndex}:${primitiveIndex}`;
}

function sanitizeRuntimeMetaValue(value: unknown): unknown {
  if (
    value instanceof THREE.Texture ||
    value instanceof THREE.Object3D ||
    value instanceof HTMLImageElement
  ) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeRuntimeMetaValue(item));
  }
  if (isRecord(value)) {
    const next: Record<string, unknown> = {};
    Object.entries(value).forEach(([key, item]) => {
      next[key] = sanitizeRuntimeMetaValue(item);
    });
    return next;
  }
  return value;
}

function resolveRuntimeMetadata(avatar: Avatar | null | undefined) {
  const meta = avatar?.vrm?.meta;
  if (!meta || !isRecord(meta)) return null;
  const next: Record<string, unknown> = {};
  Object.entries(meta).forEach(([key, value]) => {
    next[key] = sanitizeRuntimeMetaValue(value);
  });
  return next;
}

function resolveAssetSummary(
  rawJson: RawGltf,
  avatar: Avatar | null | undefined,
): VRMInspectionSnapshot["asset"] {
  const extensions = toRecord(rawJson.extensions);
  const vrm1 = toRecord(extensions?.VRMC_vrm);
  const vrm0 = toRecord(extensions?.VRM);
  const runtimeMetaVersion = avatar?.vrm?.meta?.metaVersion;

  let specVersion: VRMSpecVersion = "unknown";
  let vrmExtensionName: VRMInspectionSnapshot["asset"]["vrmExtensionName"] =
    null;

  if (vrm1) {
    specVersion = "1";
    vrmExtensionName = "VRMC_vrm";
  } else if (vrm0) {
    specVersion = "0";
    vrmExtensionName = "VRM";
  } else if (runtimeMetaVersion === "1") {
    specVersion = "1";
  } else if (runtimeMetaVersion === "0") {
    specVersion = "0";
  }

  const asset = toRecord(rawJson.asset);
  return {
    generator: toStringOrNull(asset?.generator),
    version: toStringOrNull(asset?.version),
    minVersion: toStringOrNull(asset?.minVersion),
    extensionsUsed: dedupeStrings(toStringArray(rawJson.extensionsUsed)),
    extensionsRequired: dedupeStrings(
      toStringArray(rawJson.extensionsRequired),
    ),
    topLevelExtensionKeys: dedupeStrings(Object.keys(extensions ?? {})),
    vrmExtensionName,
    specVersion,
  };
}

function resolveMetadata(
  rawJson: RawGltf,
  avatar: Avatar | null | undefined,
): Record<string, unknown> | null {
  const extensions = toRecord(rawJson.extensions);
  const vrm1 = toRecord(extensions?.VRMC_vrm);
  const vrm0 = toRecord(extensions?.VRM);

  const rawMetadata = toRecord(vrm1?.meta) ?? toRecord(vrm0?.meta);
  if (rawMetadata) return rawMetadata;

  return resolveRuntimeMetadata(avatar);
}

function resolveBoneEntries(
  rawJson: RawGltf,
  avatar: Avatar | null | undefined,
): Array<{ humanBoneName: string; nodeIndex: number | null }> {
  const extensions = toRecord(rawJson.extensions);
  const vrm1 = toRecord(extensions?.VRMC_vrm);
  const vrm0 = toRecord(extensions?.VRM);
  const entries: Array<{ humanBoneName: string; nodeIndex: number | null }> =
    [];

  const vrm1Humanoid = toRecord(vrm1?.humanoid);
  const vrm1HumanBones = toRecord(vrm1Humanoid?.humanBones);
  Object.entries(vrm1HumanBones ?? {}).forEach(([humanBoneName, value]) => {
    const nodeIndex = toNumberOrNull(toRecord(value)?.node);
    entries.push({ humanBoneName, nodeIndex });
  });

  const vrm0Humanoid = toRecord(vrm0?.humanoid);
  const vrm0HumanBones = Array.isArray(vrm0Humanoid?.humanBones)
    ? vrm0Humanoid.humanBones
    : [];
  vrm0HumanBones.forEach((value) => {
    const entry = toRecord(value);
    const humanBoneName = toStringOrNull(entry?.bone);
    if (!humanBoneName) return;
    entries.push({
      humanBoneName,
      nodeIndex: toNumberOrNull(entry?.node),
    });
  });

  if (entries.length > 0) {
    return entries;
  }

  const runtimeHumanBones = avatar?.vrm?.humanoid?.humanBones;
  if (!runtimeHumanBones || !isRecord(runtimeHumanBones)) {
    return entries;
  }

  return Object.keys(runtimeHumanBones).map((humanBoneName) => ({
    humanBoneName,
    nodeIndex: null,
  }));
}

function resolveNodeIndexForObject(
  avatar: Avatar | null | undefined,
  object: THREE.Object3D | null,
): number | null {
  if (!avatar?.sourceGltf || !object) return null;

  let current: THREE.Object3D | null = object;
  while (current) {
    const mapping = avatar.sourceGltf.parser.associations.get(current);
    if (typeof mapping?.nodes === "number") {
      return mapping.nodes;
    }
    current = current.parent;
  }

  return null;
}

function resolveRuntimeBoneDetails(
  avatar: Avatar | null | undefined,
  humanBoneName: string,
) {
  const humanoid = avatar?.vrm?.humanoid;
  if (!humanoid) {
    return {
      rawNodeName: null,
      normalizedNodeName: null,
      nodeIndex: null,
    };
  }

  const rawNode = humanoid.getRawBoneNode(humanBoneName as never);
  const normalizedNode = humanoid.getNormalizedBoneNode(humanBoneName as never);
  const nodeIndex = resolveNodeIndexForObject(avatar, rawNode);

  return {
    rawNodeName: rawNode?.name ?? null,
    normalizedNodeName: normalizedNode?.name ?? null,
    nodeIndex,
  };
}

function resolveMaterialTextureSlotsFromRaw(
  rawMaterial: RawMaterial | undefined,
  textureNameByIndex: Map<number, string | null>,
): VRMInspectionMaterialTextureSlot[] {
  if (!rawMaterial) return [];

  const slots: VRMInspectionMaterialTextureSlot[] = [];
  const standardSlots: Array<{
    slot: string;
    index: number | null;
  }> = [
    {
      slot: "baseColorTexture",
      index: toNumberOrNull(
        rawMaterial.pbrMetallicRoughness?.baseColorTexture?.index,
      ),
    },
    {
      slot: "metallicRoughnessTexture",
      index: toNumberOrNull(
        rawMaterial.pbrMetallicRoughness?.metallicRoughnessTexture?.index,
      ),
    },
    {
      slot: "normalTexture",
      index: toNumberOrNull(rawMaterial.normalTexture?.index),
    },
    {
      slot: "occlusionTexture",
      index: toNumberOrNull(rawMaterial.occlusionTexture?.index),
    },
    {
      slot: "emissiveTexture",
      index: toNumberOrNull(rawMaterial.emissiveTexture?.index),
    },
  ];

  standardSlots.forEach(({ slot, index }) => {
    if (index === null) return;
    slots.push({
      slot,
      textureIndex: index,
      textureName: textureNameByIndex.get(index) ?? null,
      source: "standard",
    });
  });

  const rawExtensions = toRecord(rawMaterial.extensions);
  const mtoon = toRecord(rawExtensions?.VRMC_materials_mtoon);
  Object.entries(mtoon ?? {}).forEach(([slot, value]) => {
    const textureIndex = toNumberOrNull(toRecord(value)?.index);
    if (textureIndex === null) return;
    slots.push({
      slot,
      textureIndex,
      textureName: textureNameByIndex.get(textureIndex) ?? null,
      source: "mtoon",
    });
  });

  return slots;
}

function resolveVrm0MaterialTextureSlots(
  rawJson: RawGltf,
  materialIndex: number,
  textureNameByIndex: Map<number, string | null>,
): VRMInspectionMaterialTextureSlot[] {
  const extensions = toRecord(rawJson.extensions);
  const vrm0 = toRecord(extensions?.VRM);
  const materialProperties = Array.isArray(vrm0?.materialProperties)
    ? vrm0.materialProperties
    : [];
  const property = toRecord(materialProperties[materialIndex]);
  const textureProperties = toRecord(property?.textureProperties);
  const slots: VRMInspectionMaterialTextureSlot[] = [];

  Object.entries(textureProperties ?? {}).forEach(([slot, value]) => {
    const textureIndex = toNumberOrNull(value);
    if (textureIndex === null) return;
    slots.push({
      slot,
      textureIndex,
      textureName: textureNameByIndex.get(textureIndex) ?? null,
      source: "vrm0",
    });
  });

  return slots;
}

function createTextureBaseList(
  rawJson: RawGltf,
  document: TransformDocument | null | undefined,
  texturePreviewUrlByIndex: Map<number, string>,
): VRMInspectionTexture[] {
  const rawTextures = Array.isArray(rawJson.textures) ? rawJson.textures : [];
  const rawImages = Array.isArray(rawJson.images) ? rawJson.images : [];
  const documentTextures = document?.getRoot().listTextures() ?? [];

  return rawTextures.map((rawTexture, index) => {
    const imageIndex = toNumberOrNull(rawTexture.source);
    const rawImage = imageIndex !== null ? rawImages[imageIndex] : undefined;
    const documentTexture = documentTextures[index];
    const size = documentTexture?.getSize();
    return {
      index,
      name:
        toStringOrNull(documentTexture?.getName()) ??
        toStringOrNull(toRecord(rawImage)?.name) ??
        null,
      uri:
        toStringOrNull(documentTexture?.getURI()) ??
        toStringOrNull(toRecord(rawImage)?.uri) ??
        null,
      mimeType:
        toStringOrNull(documentTexture?.getMimeType()) ??
        toStringOrNull(toRecord(rawImage)?.mimeType) ??
        null,
      sizeLabel: formatTextureSize(
        size && size.length >= 2 ? [size[0], size[1]] : null,
      ),
      pixelWidth: size?.[0] ?? null,
      pixelHeight: size?.[1] ?? null,
      previewUrl: texturePreviewUrlByIndex.get(index) ?? null,
      usageCount: 0,
      usedBy: [],
    };
  });
}

function createMaterialList(
  rawJson: RawGltf,
  document: TransformDocument | null | undefined,
  textureNameByIndex: Map<number, string | null>,
  primitiveUsages: VRMInspectionPrimitiveUsage[],
): VRMInspectionMaterial[] {
  const rawMaterials = Array.isArray(rawJson.materials)
    ? rawJson.materials
    : [];
  const documentMaterials = document?.getRoot().listMaterials() ?? [];

  return rawMaterials.map((rawMaterial, index) => {
    const documentMaterial = documentMaterials[index];
    const textureSlots = dedupeMaterialTextureSlots([
      ...resolveMaterialTextureSlotsFromRaw(rawMaterial, textureNameByIndex),
      ...resolveVrm0MaterialTextureSlots(rawJson, index, textureNameByIndex),
    ]);

    return {
      index,
      name:
        toStringOrNull(documentMaterial?.getName()) ??
        toStringOrNull(rawMaterial.name) ??
        null,
      alphaMode:
        toStringOrNull(documentMaterial?.getAlphaMode()) ??
        toStringOrNull(rawMaterial.alphaMode) ??
        "OPAQUE",
      doubleSided:
        typeof documentMaterial?.getDoubleSided() === "boolean"
          ? documentMaterial.getDoubleSided()
          : rawMaterial.doubleSided === true,
      extensionNames: dedupeStrings(
        Object.keys(toRecord(rawMaterial.extensions) ?? {}),
      ),
      usageCount: primitiveUsages.filter(
        (usage) => usage.materialIndex === index,
      ).length,
      textureSlots,
    };
  });
}

function dedupeMaterialTextureSlots(
  values: VRMInspectionMaterialTextureSlot[],
): VRMInspectionMaterialTextureSlot[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = `${value.source}:${value.slot}:${value.textureIndex}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function createPrimitiveLookup(
  rawJson: RawGltf,
  document: TransformDocument | null | undefined,
) {
  const rawMeshes = Array.isArray(rawJson.meshes) ? rawJson.meshes : [];
  const documentMeshes = document?.getRoot().listMeshes() ?? [];
  const primitiveLookup = new Map<
    string,
    {
      materialIndex: number | null;
      materialName: string | null;
      vertexCount: number | null;
      indexCount: number | null;
      attributeNames: string[];
      mode: number | null;
      meshName: string | null;
    }
  >();

  rawMeshes.forEach((rawMesh, meshIndex) => {
    const documentMesh = documentMeshes[meshIndex];
    const documentPrimitives = documentMesh?.listPrimitives() ?? [];
    const rawPrimitives = Array.isArray(rawMesh.primitives)
      ? rawMesh.primitives
      : [];

    rawPrimitives.forEach((rawPrimitive, primitiveIndex) => {
      const documentPrimitive = documentPrimitives[primitiveIndex];
      const positionAccessor = documentPrimitive?.getAttribute("POSITION");
      const vertexCount = positionAccessor?.getCount() ?? null;
      const indexAccessor = documentPrimitive?.getIndices();
      const indexCount = indexAccessor?.getCount() ?? vertexCount;
      const attributeNames = documentPrimitive
        ? documentPrimitive.listSemantics()
        : dedupeStrings(Object.keys(rawPrimitive.attributes ?? {}));

      primitiveLookup.set(`${meshIndex}:${primitiveIndex}`, {
        materialIndex: toNumberOrNull(rawPrimitive.material),
        materialName: null,
        vertexCount,
        indexCount,
        attributeNames,
        mode:
          documentPrimitive?.getMode() ??
          rawPrimitive.mode ??
          DEFAULT_PRIMITIVE_MODE,
        meshName:
          toStringOrNull(documentMesh?.getName()) ??
          toStringOrNull(rawMesh.name) ??
          null,
      });
    });
  });

  return primitiveLookup;
}

function createSkinList(
  rawJson: RawGltf,
  document: TransformDocument | null | undefined,
  rawNodes: RawNode[],
): VRMInspectionSkin[] {
  const rawSkins = Array.isArray(rawJson.skins) ? rawJson.skins : [];
  const documentSkins = document?.getRoot().listSkins() ?? [];

  return rawSkins.map((rawSkin, index) => {
    const documentSkin = documentSkins[index];
    const jointNodeIndices = Array.isArray(rawSkin.joints)
      ? rawSkin.joints.filter(
          (jointIndex): jointIndex is number => typeof jointIndex === "number",
        )
      : [];
    return {
      index,
      name: toStringOrNull(documentSkin?.getName()) ?? null,
      skeletonNodeIndex: toNumberOrNull(rawSkin.skeleton),
      skeletonNodeName:
        toStringOrNull(
          rawNodes[toNumberOrNull(rawSkin.skeleton) ?? -1]?.name,
        ) ?? null,
      jointCount: jointNodeIndices.length,
      jointNodeIndices,
      jointNames: jointNodeIndices.map(
        (jointIndex) =>
          toStringOrNull(rawNodes[jointIndex]?.name) ?? `node_${jointIndex}`,
      ),
    };
  });
}

function createBoneList(
  rawJson: RawGltf,
  avatar: Avatar | null | undefined,
  rawNodes: RawNode[],
): VRMInspectionBone[] {
  const entries = resolveBoneEntries(rawJson, avatar);
  const seen = new Set<string>();
  return entries
    .filter((entry) => {
      if (seen.has(entry.humanBoneName)) return false;
      seen.add(entry.humanBoneName);
      return true;
    })
    .map((entry) => {
      const runtimeDetails = resolveRuntimeBoneDetails(
        avatar,
        entry.humanBoneName,
      );
      const nodeIndex = entry.nodeIndex ?? runtimeDetails.nodeIndex;
      const nodeName =
        toStringOrNull(rawNodes[nodeIndex ?? -1]?.name) ??
        runtimeDetails.rawNodeName ??
        null;
      return {
        humanBoneName: entry.humanBoneName,
        nodeIndex,
        nodeName,
        rawNodeName: runtimeDetails.rawNodeName ?? nodeName,
        normalizedNodeName: runtimeDetails.normalizedNodeName,
      };
    })
    .sort((a, b) => a.humanBoneName.localeCompare(b.humanBoneName));
}

function createNodeList(
  _rawJson: RawGltf,
  rawNodes: RawNode[],
  bones: VRMInspectionBone[],
): VRMInspectionNode[] {
  const parentIndexMap = buildParentIndexMap(rawNodes);
  const boneNodeIndexSet = new Set(
    bones
      .map((bone) => bone.nodeIndex)
      .filter((value): value is number => typeof value === "number"),
  );

  return rawNodes.map((rawNode, index) => {
    const meshIndex = toNumberOrNull(rawNode.mesh);
    const skinIndex = toNumberOrNull(rawNode.skin);
    const kind =
      meshIndex !== null && skinIndex !== null
        ? "skinned-mesh"
        : meshIndex !== null
          ? "mesh"
          : boneNodeIndexSet.has(index)
            ? "bone"
            : "node";

    return {
      index,
      name: toStringOrNull(rawNode.name) ?? null,
      kind,
      parentIndex: parentIndexMap.get(index) ?? null,
      childIndices: Array.isArray(rawNode.children)
        ? rawNode.children.filter(
            (childIndex): childIndex is number =>
              typeof childIndex === "number",
          )
        : [],
      meshIndex,
      skinIndex,
      translation: toVec3(rawNode.translation),
      rotation: toVec4(rawNode.rotation),
      scale: toVec3(rawNode.scale),
    };
  });
}

function createMeshList(
  rawJson: RawGltf,
  primitiveUsages: VRMInspectionPrimitiveUsage[],
): VRMInspectionMesh[] {
  const rawMeshes = Array.isArray(rawJson.meshes) ? rawJson.meshes : [];
  return rawMeshes.map((rawMesh, index) => ({
    index,
    name: toStringOrNull(rawMesh.name) ?? null,
    primitiveCount: Array.isArray(rawMesh.primitives)
      ? rawMesh.primitives.length
      : 0,
    nodeIndices: primitiveUsages
      .filter((usage) => usage.meshIndex === index)
      .map((usage) => usage.nodeIndex)
      .filter(
        (nodeIndex): nodeIndex is number => typeof nodeIndex === "number",
      ),
  }));
}

function createPrimitiveUsageList(
  rawJson: RawGltf,
  rawNodes: RawNode[],
  skins: VRMInspectionSkin[],
  primitiveLookup: Map<
    string,
    {
      materialIndex: number | null;
      materialName: string | null;
      vertexCount: number | null;
      indexCount: number | null;
      attributeNames: string[];
      mode: number | null;
      meshName: string | null;
    }
  >,
  primitiveBindings: VRMRuntimePrimitiveBinding[],
): VRMInspectionPrimitiveUsage[] {
  const rawMeshes = Array.isArray(rawJson.meshes) ? rawJson.meshes : [];
  const bindingByKey = new Map(
    primitiveBindings.map((binding) => [binding.bindingKey, binding]),
  );

  const usages: VRMInspectionPrimitiveUsage[] = [];

  rawMeshes.forEach((rawMesh, meshIndex) => {
    const primitiveCount = Array.isArray(rawMesh.primitives)
      ? rawMesh.primitives.length
      : 0;
    const matchingNodes = rawNodes
      .map((rawNode, nodeIndex) => ({
        rawNode,
        nodeIndex,
      }))
      .filter(({ rawNode }) => toNumberOrNull(rawNode.mesh) === meshIndex);

    const usageSeeds =
      matchingNodes.length > 0
        ? matchingNodes.map(({ nodeIndex, rawNode }) => ({
            nodeIndex,
            nodeName: toStringOrNull(rawNode.name) ?? null,
            skinIndex: toNumberOrNull(rawNode.skin),
          }))
        : [{ nodeIndex: null, nodeName: null, skinIndex: null }];

    usageSeeds.forEach(({ nodeIndex, nodeName, skinIndex }) => {
      for (
        let primitiveIndex = 0;
        primitiveIndex < primitiveCount;
        primitiveIndex += 1
      ) {
        const primitiveInfo = primitiveLookup.get(
          `${meshIndex}:${primitiveIndex}`,
        );
        if (!primitiveInfo) continue;

        const bindingKey = buildPrimitiveBindingKey(
          nodeIndex,
          meshIndex,
          primitiveIndex,
        );
        const binding = bindingByKey.get(bindingKey) ?? null;
        const skinName =
          skinIndex !== null ? (skins[skinIndex]?.name ?? null) : null;
        usages.push({
          bindingKey,
          nodeIndex,
          nodeName,
          meshIndex,
          meshName: primitiveInfo.meshName,
          primitiveIndex,
          materialIndex: primitiveInfo.materialIndex,
          materialName: primitiveInfo.materialName,
          vertexCount: primitiveInfo.vertexCount,
          indexCount: primitiveInfo.indexCount,
          attributeNames: primitiveInfo.attributeNames,
          mode: primitiveInfo.mode,
          skinIndex,
          skinName,
          isRuntimeBound: Boolean(binding),
          isRuntimeVisible: binding?.visible ?? null,
          runtimeObjectName: binding?.objectName ?? null,
          runtimeObjectType: binding?.objectType ?? null,
        });
      }
    });
  });

  return usages.sort((a, b) => {
    if (a.nodeIndex !== b.nodeIndex) {
      if (a.nodeIndex === null) return 1;
      if (b.nodeIndex === null) return -1;
      return a.nodeIndex - b.nodeIndex;
    }
    if (a.meshIndex !== b.meshIndex) return a.meshIndex - b.meshIndex;
    return a.primitiveIndex - b.primitiveIndex;
  });
}

function populateMaterialNames(
  primitiveUsages: VRMInspectionPrimitiveUsage[],
  materials: VRMInspectionMaterial[],
) {
  const materialNameByIndex = new Map(
    materials.map((material) => [material.index, material.name]),
  );
  primitiveUsages.forEach((usage) => {
    if (usage.materialIndex === null) return;
    usage.materialName = materialNameByIndex.get(usage.materialIndex) ?? null;
  });
}

function populateTextureUsages(
  textures: VRMInspectionTexture[],
  materials: VRMInspectionMaterial[],
) {
  const textureByIndex = new Map(
    textures.map((texture) => [texture.index, texture]),
  );
  materials.forEach((material) => {
    material.textureSlots.forEach((slot) => {
      const texture = textureByIndex.get(slot.textureIndex);
      if (!texture) return;
      texture.usedBy.push({
        materialIndex: material.index,
        materialName: material.name,
        slot: slot.slot,
        source: slot.source,
      });
      texture.usageCount += 1;
    });
  });
}

function computeTotals(args: {
  nodes: VRMInspectionNode[];
  meshes: VRMInspectionMesh[];
  primitiveUsages: VRMInspectionPrimitiveUsage[];
  skins: VRMInspectionSkin[];
  bones: VRMInspectionBone[];
  materials: VRMInspectionMaterial[];
  textures: VRMInspectionTexture[];
  activeOverrideCount: number;
}) {
  const primitiveDefinitionKeys = new Set(
    args.primitiveUsages.map(
      (usage) => `${usage.meshIndex}:${usage.primitiveIndex}`,
    ),
  );
  const vertexCount = Array.from(primitiveDefinitionKeys).reduce((sum, key) => {
    const usage = args.primitiveUsages.find(
      (candidate) =>
        `${candidate.meshIndex}:${candidate.primitiveIndex}` === key,
    );
    return sum + (usage?.vertexCount ?? 0);
  }, 0);
  const indexCount = Array.from(primitiveDefinitionKeys).reduce((sum, key) => {
    const usage = args.primitiveUsages.find(
      (candidate) =>
        `${candidate.meshIndex}:${candidate.primitiveIndex}` === key,
    );
    return sum + (usage?.indexCount ?? 0);
  }, 0);

  return {
    nodeCount: args.nodes.length,
    meshCount: args.meshes.length,
    primitiveCount: primitiveDefinitionKeys.size,
    primitiveUsageCount: args.primitiveUsages.length,
    vertexCount,
    indexCount,
    skinCount: args.skins.length,
    boneCount: args.bones.length,
    materialCount: args.materials.length,
    textureCount: args.textures.length,
    runtimeBoundPrimitiveUsageCount: args.primitiveUsages.filter(
      (usage) => usage.isRuntimeBound,
    ).length,
    activeOverrideCount: args.activeOverrideCount,
  };
}

function dedupeWarnings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

export function sanitizeJsonDocument(jsonDocument: JSONDocument): JSONDocument {
  const sanitizedJson = JSON.parse(
    JSON.stringify(jsonDocument.json),
  ) as RawGltf;

  sanitizedJson.extensionsUsed = toStringArray(
    sanitizedJson.extensionsUsed,
  ).filter((extensionName) => !VRM_EXTENSION_PATTERN.test(extensionName));
  sanitizedJson.extensionsRequired = toStringArray(
    sanitizedJson.extensionsRequired,
  ).filter((extensionName) => !VRM_EXTENSION_PATTERN.test(extensionName));

  return {
    json: sanitizedJson,
    resources: jsonDocument.resources,
  };
}

export function buildRuntimePrimitiveBindings(avatar: Avatar): {
  entries: RuntimePrimitiveBindingEntry[];
  warnings: string[];
} {
  if (!avatar.scene || !avatar.sourceGltf) {
    return {
      entries: [],
      warnings: ["Live avatar scene bindings are unavailable."],
    };
  }

  const { associations } = avatar.sourceGltf.parser;
  const entries: RuntimePrimitiveBindingEntry[] = [];

  avatar.scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;

    const meshMapping = associations.get(object);
    const meshIndex = toNumberOrNull(meshMapping?.meshes);
    const primitiveIndex = toNumberOrNull(
      isRecord(meshMapping) ? meshMapping.primitives : null,
    );
    if (meshIndex === null || primitiveIndex === null) return;

    const nodeIndex = resolveNodeIndexForObject(avatar, object);
    const rawPrimitive =
      avatar.sourceGltf?.parser.json.meshes?.[meshIndex]?.primitives?.[
        primitiveIndex
      ];
    const material = Array.isArray(object.material)
      ? (object.material[0] ?? null)
      : object.material;
    const materialMapping = material ? associations.get(material) : null;
    const materialIndex =
      toNumberOrNull(materialMapping?.materials) ??
      toNumberOrNull(rawPrimitive?.material);
    entries.push({
      bindingKey: buildPrimitiveBindingKey(
        nodeIndex,
        meshIndex,
        primitiveIndex,
        `runtime:${object.uuid}`,
      ),
      nodeIndex,
      meshIndex,
      primitiveIndex,
      materialIndex,
      materialName: material?.name?.trim() ? material.name.trim() : null,
      objectName: object.name?.trim() ? object.name.trim() : null,
      objectType: object.type,
      visible: object.visible,
      originalVisible: object.visible,
      isSkinnedMesh: object instanceof THREE.SkinnedMesh,
      object,
    });
  });

  return {
    entries: entries.sort((a, b) => {
      if (a.nodeIndex !== b.nodeIndex) {
        if (a.nodeIndex === null) return 1;
        if (b.nodeIndex === null) return -1;
        return a.nodeIndex - b.nodeIndex;
      }
      if (a.meshIndex !== b.meshIndex) return a.meshIndex - b.meshIndex;
      return a.primitiveIndex - b.primitiveIndex;
    }),
    warnings: [],
  };
}

export function buildInspectionSnapshot(
  args: BuildInspectionSnapshotArgs,
): VRMInspectionSnapshot {
  const rawNodes = Array.isArray(args.rawJson.nodes) ? args.rawJson.nodes : [];
  const primitiveBindings = args.primitiveBindings ?? [];
  const bones = createBoneList(args.rawJson, args.avatar, rawNodes);
  const primitiveLookup = createPrimitiveLookup(args.rawJson, args.document);
  const skins = createSkinList(args.rawJson, args.document, rawNodes);
  const primitiveUsages = createPrimitiveUsageList(
    args.rawJson,
    rawNodes,
    skins,
    primitiveLookup,
    primitiveBindings,
  );
  const textures = createTextureBaseList(
    args.rawJson,
    args.document,
    args.texturePreviewUrlByIndex ?? new Map<number, string>(),
  );
  const textureNameByIndex = new Map(
    textures.map((texture) => [texture.index, texture.name]),
  );
  const materials = createMaterialList(
    args.rawJson,
    args.document,
    textureNameByIndex,
    primitiveUsages,
  );
  populateMaterialNames(primitiveUsages, materials);
  populateTextureUsages(textures, materials);
  const meshes = createMeshList(args.rawJson, primitiveUsages);
  const nodes = createNodeList(args.rawJson, rawNodes, bones);

  return {
    sourceMode: args.sourceMode,
    source: args.source,
    asset: resolveAssetSummary(args.rawJson, args.avatar),
    metadata: resolveMetadata(args.rawJson, args.avatar),
    warnings: dedupeWarnings(args.warnings ?? []),
    totals: computeTotals({
      nodes,
      meshes,
      primitiveUsages,
      skins,
      bones,
      materials,
      textures,
      activeOverrideCount: args.activeOverrideCount ?? 0,
    }),
    nodes,
    meshes,
    primitiveUsages,
    skins,
    bones,
    materials,
    textures,
  };
}

export function createEmptyVRMEditorSessionSnapshot(): VRMEditorSessionSnapshot {
  return {
    status: "idle",
    error: null,
    warnings: [],
    inspection: null,
    vfx: null,
    rawJson: null,
    primitiveBindings: [],
    activeOverrideCount: 0,
    canEdit: false,
  };
}

export function readRawJsonFromAvatar(
  avatar: Avatar | null | undefined,
): RawGltf | null {
  const json = avatar?.sourceGltf?.parser?.json;
  return isRecord(json) ? (json as unknown as RawGltf) : null;
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

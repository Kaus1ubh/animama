import { BILLBOARD_GEOMETRY_UUID, FULL_CIRCLE_RADIANS } from "./constants";
import {
  createColorOverLifeBehavior,
  colorToGenerator,
  DEFAULT_START_COLOR,
} from "./colors";
import {
  createForceOverLifeBehavior,
  createFrameOverLifeBehavior,
  createSizeOverLifeBehavior,
} from "./behaviors";
import {
  ensureJsonArrayProperty,
  ensureJsonObject,
  identityMatrix,
  makeEmitterUuid,
  makeGroupUuid,
  readJsonObject,
} from "./json";
import {
  generatorToValueRange,
  readFiniteNumber,
  roundEditorNumber,
  valueRangeToGenerator,
} from "./numbers";
import { shapeToJson } from "./shapes";
import {
  ensureEmitterMaterialAssets,
  getParticleVFXEditorTextureById,
  type ParticleVFXMaterialAssets,
} from "./textures";
import type {
  EmitterNodeRef,
  JsonArray,
  JsonObject,
  ParticleVFXEditorBurstDraft,
  ParticleVFXEditorCatalogDraft,
  ParticleVFXEditorValueRange,
} from "./types";
import type { ParticleVFXTransformAxisTriple } from "../types";

export function createBlankParticleVFXJson(
  catalog: ParticleVFXEditorCatalogDraft,
  textureId: string,
): JsonObject {
  const json: JsonObject = {
    metadata: {
      version: 4.6,
      type: "Object",
      generator: "Animama particle VFX creator",
    },
    geometries: [createBillboardGeometry()],
    materials: [],
    textures: [],
    images: [],
    object: {
      uuid: makeGroupUuid(catalog.id),
      type: "Group",
      name: catalog.label,
      layers: 1,
      matrix: identityMatrix(),
      up: [0, 1, 0],
      children: [],
    },
  };
  const materialAssets = ensureEmitterMaterialAssets(
    json,
    catalog.id,
    1,
    textureId,
  );
  const root = ensureQuarksRootObject(json, catalog.label);
  ensureJsonArrayProperty(root, "children").push(
    createParticleEmitterNode({
      effectId: catalog.id,
      index: 1,
      name: "emitter-1",
      textureId,
      materialAssets,
    }),
  );
  return json;
}

export function createParticleEmitterNode(args: {
  effectId: string;
  index: number;
  name: string;
  textureId: string;
  materialAssets: ParticleVFXMaterialAssets;
}): JsonObject {
  const textureEntry = getParticleVFXEditorTextureById(args.textureId);
  const frameOverLife = textureEntry?.atlas?.frameOverLife;
  return {
    uuid: makeEmitterUuid(args.effectId, args.index),
    type: "ParticleEmitter",
    name: args.name,
    layers: 1,
    matrix: identityMatrix(),
    up: [0, 1, 0],
    ps: {
      version: "3.0",
      autoDestroy: false,
      looping: false,
      prewarm: false,
      duration: 1.2,
      shape: shapeToJson({
        type: "sphere",
        radius: 0.12,
        width: 1,
        height: 1,
        arc: FULL_CIRCLE_RADIANS,
        thickness: 1,
        angle: 0.35,
        mode: 0,
        spread: 0,
        speed: { min: 1, max: 1 },
      }),
      startLife: valueRangeToGenerator({ min: 0.7, max: 1 }),
      startSpeed: valueRangeToGenerator({ min: 0.2, max: 0.45 }),
      startRotation: valueRangeToGenerator({
        min: 0,
        max: FULL_CIRCLE_RADIANS,
      }),
      startSize: valueRangeToGenerator({ min: 0.14, max: 0.22 }),
      startColor: colorToGenerator(DEFAULT_START_COLOR),
      emissionOverTime: valueRangeToGenerator({ min: 0, max: 0 }),
      emissionOverDistance: valueRangeToGenerator({ min: 0, max: 0 }),
      emissionBursts: [
        {
          time: 0,
          count: valueRangeToGenerator({ min: 12, max: 12 }),
          probability: 1,
          interval: 0.01,
          cycle: 1,
        },
      ],
      onlyUsedByOther: false,
      instancingGeometry: BILLBOARD_GEOMETRY_UUID,
      renderOrder: 20,
      renderMode: textureEntry?.recommendedRenderMode ?? 0,
      rendererEmitterSettings: {},
      material: args.materialAssets.materialUuid,
      layers: 1,
      startTileIndex: valueRangeToGenerator({ min: 0, max: 0 }),
      uTileCount: textureEntry?.atlas?.uTileCount ?? 1,
      vTileCount: textureEntry?.atlas?.vTileCount ?? 1,
      blendTiles: textureEntry?.atlas?.blendTiles ?? false,
      softParticles: false,
      softFarFade: 0,
      softNearFade: 0,
      behaviors: [
        createForceOverLifeBehavior(),
        createSizeOverLifeBehavior(),
        createColorOverLifeBehavior(),
        ...(frameOverLife
          ? [
              createFrameOverLifeBehavior({
                startFrame: frameOverLife.startFrame,
                endFrame: frameOverLife.endFrame,
              }),
            ]
          : []),
      ],
      worldSpace: false,
    },
  };
}

export function createBillboardGeometry(): JsonObject {
  return {
    uuid: BILLBOARD_GEOMETRY_UUID,
    type: "PlaneGeometry",
    width: 1,
    height: 1,
    widthSegments: 1,
    heightSegments: 1,
  };
}

export function ensureQuarksRootObject(
  quarksJson: JsonObject,
  label: string,
): JsonObject {
  const current = readJsonObject(quarksJson.object);
  if (current) return current;
  const root: JsonObject = {
    uuid: makeGroupUuid(label),
    type: "Group",
    name: label,
    layers: 1,
    matrix: identityMatrix(),
    up: [0, 1, 0],
    children: [],
  };
  quarksJson.object = root;
  return root;
}

export function readEmitterName(
  object: JsonObject,
  fallbackIndex: number,
): string {
  return typeof object.name === "string" && object.name.trim()
    ? object.name
    : `Emitter ${fallbackIndex}`;
}

export function readObjectLocalPosition(
  object: JsonObject,
): ParticleVFXTransformAxisTriple {
  const matrix = Array.isArray(object.matrix)
    ? object.matrix
    : identityMatrix();
  return {
    x: readFiniteNumber(matrix[12]) ?? 0,
    y: readFiniteNumber(matrix[13]) ?? 0,
    z: readFiniteNumber(matrix[14]) ?? 0,
  };
}

export function setObjectLocalPosition(
  object: JsonObject,
  position: ParticleVFXTransformAxisTriple,
): void {
  const matrix = Array.isArray(object.matrix)
    ? [...(object.matrix as unknown[])]
    : identityMatrix();
  while (matrix.length < 16) matrix.push(0);
  matrix[12] = roundEditorNumber(position.x);
  matrix[13] = roundEditorNumber(position.y);
  matrix[14] = roundEditorNumber(position.z);
  matrix[15] = readFiniteNumber(matrix[15]) ?? 1;
  object.matrix = matrix;
}

export function removeEmitterNode(
  object: JsonObject,
  path: string,
  emitterPath: string,
): boolean {
  const children = Array.isArray(object.children) ? object.children : [];
  const index = children.findIndex((child, childIndex) => {
    const childObject = readJsonObject(child);
    return (
      childObject?.type === "ParticleEmitter" &&
      `${path}/children/${childIndex}` === emitterPath
    );
  });
  if (index >= 0) {
    children.splice(index, 1);
    object.children = children;
    return true;
  }
  for (let childIndex = 0; childIndex < children.length; childIndex += 1) {
    const childObject = readJsonObject(children[childIndex]);
    if (
      childObject &&
      removeEmitterNode(
        childObject,
        `${path}/children/${childIndex}`,
        emitterPath,
      )
    ) {
      return true;
    }
  }
  return false;
}

export function readFirstBurst(
  ps: JsonObject | null | undefined,
): ParticleVFXEditorBurstDraft | null {
  const bursts = Array.isArray(ps?.emissionBursts) ? ps?.emissionBursts : [];
  const firstBurst = readJsonObject(bursts[0]);
  if (!firstBurst) return null;
  const count = generatorToValueRange(firstBurst.count);
  return {
    time: readFiniteNumber(firstBurst.time) ?? 0,
    count: count ?? { min: 0, max: 0 },
    interval: readFiniteNumber(firstBurst.interval) ?? 0.01,
    cycle: readFiniteNumber(firstBurst.cycle) ?? 1,
    probability: readFiniteNumber(firstBurst.probability) ?? 1,
  };
}

export function setFirstBurst(
  ps: JsonObject,
  patch: Partial<ParticleVFXEditorBurstDraft>,
): void {
  const bursts = Array.isArray(ps.emissionBursts)
    ? (ps.emissionBursts as JsonArray)
    : [];
  const firstBurst = ensureJsonObject(bursts[0]);
  if (typeof patch.time === "number") {
    firstBurst.time = roundEditorNumber(Math.max(0, patch.time));
  }
  if (patch.count) {
    firstBurst.count = valueRangeToGenerator(patch.count);
  }
  if (typeof patch.interval === "number") {
    firstBurst.interval = roundEditorNumber(Math.max(0, patch.interval));
  }
  if (typeof patch.cycle === "number") {
    firstBurst.cycle = Math.max(1, Math.round(patch.cycle));
  }
  if (typeof patch.probability === "number") {
    firstBurst.probability = roundEditorNumber(
      Math.min(1, Math.max(0, patch.probability)),
    );
  }
  if (!firstBurst.count) {
    firstBurst.count = valueRangeToGenerator({ min: 0, max: 0 });
  }
  if (typeof firstBurst.time !== "number") firstBurst.time = 0;
  if (typeof firstBurst.interval !== "number") firstBurst.interval = 0.01;
  if (typeof firstBurst.cycle !== "number") firstBurst.cycle = 1;
  if (typeof firstBurst.probability !== "number") firstBurst.probability = 1;
  bursts[0] = firstBurst;
  ps.emissionBursts = bursts;
}

export function setFirstBurstCount(
  ps: JsonObject,
  range: ParticleVFXEditorValueRange,
): void {
  const bursts = Array.isArray(ps.emissionBursts)
    ? (ps.emissionBursts as JsonArray)
    : [];
  if (bursts.length === 0) {
    bursts.push({
      time: 0,
      count: valueRangeToGenerator(range),
      probability: 1,
      interval: 0.01,
      cycle: 1,
    });
  } else {
    const firstBurst = ensureJsonObject(bursts[0]);
    firstBurst.count = valueRangeToGenerator(range);
    bursts[0] = firstBurst;
  }
  ps.emissionBursts = bursts;
}

export function collectEmitterNodes(quarksJson: JsonObject): EmitterNodeRef[] {
  const nodes: EmitterNodeRef[] = [];
  const root = readJsonObject(quarksJson.object);
  if (!root) return nodes;
  walkObject(root, "/object", nodes);
  return nodes;
}

export function findEmitterNode(
  quarksJson: JsonObject,
  emitterPath: string,
): JsonObject | null {
  return (
    collectEmitterNodes(quarksJson).find((node) => node.path === emitterPath)
      ?.object ?? null
  );
}

function walkObject(
  object: JsonObject,
  path: string,
  nodes: EmitterNodeRef[],
): void {
  if (object.type === "ParticleEmitter") {
    nodes.push({ path, object });
  }
  const children = Array.isArray(object.children) ? object.children : [];
  children.forEach((child, index) => {
    const childObject = readJsonObject(child);
    if (childObject) {
      walkObject(childObject, `${path}/children/${index}`, nodes);
    }
  });
}

import type * as THREE from "three";
import type {
  GLTF,
  GLTFReference,
} from "three/examples/jsm/loaders/GLTFLoader.js";
import type { VRM, VRMSpringBoneJoint } from "@pixiv/three-vrm";

import { addAvatarIssue, type AvatarIssue } from "../diagnostics/issues";

import {
  DEFAULT_SPRING_BONE_SEMANTIC_PROFILES,
  UNPROFILED_SPRING_BONE_INTENSITY_SCALE,
  type SpringBoneSemantic,
} from "./SpringBoneSemanticProfile";

const MAX_SEMANTIC_WARNINGS = 5;
const LOW_CONFIDENCE_ASSIGNMENT_THRESHOLD = 0.5;
const VRM1_SPRING_BONE_EXTENSION = "VRMC_springBone";
const VRM0_EXTENSION = "VRM";

const JAPANESE_HAIR_TOKENS = ["前髪", "横髪", "後髪", "髪"] as const;
const LATIN_HAIR_PREFIX_TOKENS = [
  "hair",
  "bang",
  "bangs",
  "pony",
  "twin",
  "braid",
  "ahoge",
  "fringe",
  "forelock",
  "maegami",
  "yokogami",
  "ushirogami",
] as const;
const LATIN_HAIR_COMPACT_TOKENS = [
  "sidehair",
  "backhair",
  "ponytail",
  "twintail",
  "maegami",
  "yokogami",
  "ushirogami",
] as const;

type TokenRule = {
  semantic: SpringBoneSemantic;
  japanese?: readonly string[];
  latinPrefix?: readonly string[];
  latinExact?: readonly string[];
  latinCompact?: readonly string[];
};

const SEMANTIC_TOKEN_RULES = [
  {
    semantic: "hair",
    japanese: JAPANESE_HAIR_TOKENS,
    latinPrefix: LATIN_HAIR_PREFIX_TOKENS,
    latinCompact: LATIN_HAIR_COMPACT_TOKENS,
  },
  {
    semantic: "chest",
    japanese: ["胸", "乳"],
    latinPrefix: ["chest", "bust", "breast", "oppai", "mune"],
  },
  {
    semantic: "tail",
    japanese: ["尻尾"],
    latinPrefix: ["tail"],
    latinCompact: ["foxtail", "wolftail", "cattail", "rabbittail"],
  },
  {
    semantic: "ear",
    japanese: ["耳"],
    latinExact: ["ear", "ears"],
    latinCompact: [
      "rabbitear",
      "rabbitears",
      "catear",
      "catears",
      "foxear",
      "foxears",
      "kemomimi",
    ],
  },
  {
    semantic: "cloth",
    latinPrefix: [
      "cloth",
      "clothes",
      "clothing",
      "skirt",
      "sleeve",
      "dress",
      "coat",
      "hood",
      "hoodie",
      "hem",
      "cape",
      "collar",
      "shirt",
      "top",
      "tops",
      "jacket",
    ],
    latinCompact: ["topsupperarm", "coatskirt", "hoodstring"],
  },
  {
    semantic: "accessory",
    latinPrefix: [
      "accessory",
      "accessories",
      "acc",
      "ribbon",
      "bow",
      "ornament",
      "charm",
      "pendant",
      "necklace",
      "glasses",
      "hat",
      "pin",
    ],
  },
] as const satisfies readonly TokenRule[];

export type SpringBoneSemanticAssignmentSource =
  | "vrm1SpringName"
  | "vrm0BoneGroupComment"
  | "boneName"
  | "fallback";

export type SpringBoneSemanticJointCounts = Record<
  SpringBoneSemantic,
  number
> & {
  total: number;
  unprofiled: number;
  unmapped: number;
  lowConfidence: number;
};

export type SpringBoneSemanticAssignment = {
  semantic: SpringBoneSemantic | null;
  intensityScale: number;
  confidence: number;
  source: SpringBoneSemanticAssignmentSource;
  springName?: string;
  comment?: string;
  rootNodeNames: string[];
  jointNodeNames: string[];
  runtimeNodeIndex: number | null;
  rawSpringIndex?: number;
  rawBoneGroupIndex?: number;
};

export type SpringBoneSemanticClassification = {
  ready: boolean;
  assignments: Map<VRMSpringBoneJoint, SpringBoneSemanticAssignment>;
  counts: SpringBoneSemanticJointCounts;
  assignmentCount: number;
  warnings: string[];
  /** `warnings` as stable codes, for the Diagnostics view. */
  issues: AvatarIssue[];
};

type Findings = { warnings: string[]; issues: AvatarIssue[] };

export type SpringBoneSemanticClassifierInput = {
  vrm: VRM;
  sourceGltf?: GLTF | null;
  parserJson?: unknown | null;
  associations?: ParserAssociations | null;
};

type ParserAssociations = Map<
  THREE.Object3D | THREE.Material | THREE.Texture,
  GLTFReference
>;

type JsonRecord = Record<string, unknown>;

type RawSpringChainBase = {
  rootNodeIndices: number[];
  jointNodeIndices: number[];
  rootNodeNames: string[];
  jointNodeNames: string[];
};

type RawVrm1SpringChain = RawSpringChainBase & {
  version: "vrm1";
  index: number;
  springName?: string;
  runtimeJointNodeIndices: number[];
};

type RawVrm0SpringChain = RawSpringChainBase & {
  version: "vrm0";
  index: number;
  comment?: string;
};

type RawSpringChain = RawVrm1SpringChain | RawVrm0SpringChain;

type SemanticEvidence = {
  value: string;
  source: Exclude<SpringBoneSemanticAssignmentSource, "fallback">;
};

export function buildSpringBoneSemanticAssignments({
  vrm,
  sourceGltf,
  parserJson,
  associations,
}: SpringBoneSemanticClassifierInput): SpringBoneSemanticClassification {
  const assignments = new Map<
    VRMSpringBoneJoint,
    SpringBoneSemanticAssignment
  >();
  const counts = createEmptySpringBoneSemanticJointCounts();
  const findings: Findings = { warnings: [], issues: [] };
  const manager = vrm.springBoneManager;

  if (!manager) {
    return {
      ready: false,
      assignments,
      counts,
      assignmentCount: 0,
      ...findings,
    };
  }

  const joints = Array.from(manager.joints);
  const rawJson = asRecord(parserJson ?? sourceGltf?.parser.json);
  const parserAssociations = associations ?? sourceGltf?.parser.associations;

  if (!rawJson) {
    pushWarning(
      findings,
      { code: "springs_source_unavailable" },
      "Spring-bone semantic classifier could not inspect source glTF JSON.",
    );
  }

  if (!parserAssociations) {
    pushWarning(
      findings,
      { code: "springs_source_unavailable" },
      "Spring-bone semantic classifier could not inspect parser associations.",
    );
  }

  if (!rawJson || !parserAssociations) {
    for (const joint of joints) {
      assignFallback(assignments, counts, joint, null);
    }
    return finalizeClassification(assignments, counts, findings);
  }

  const nodes = readRawNodes(rawJson);
  const parentByNodeIndex = buildParentNodeMap(nodes);
  const vrm1Chains = parseVrm1SpringChains(rawJson, nodes);
  const vrm0Chains = parseVrm0SpringChains(rawJson, nodes);
  const vrm1ChainsByRuntimeJointNodeIndex =
    buildVrm1RuntimeJointNodeLookup(vrm1Chains);

  if (vrm1Chains.length === 0 && vrm0Chains.length === 0) {
    pushWarning(
      findings,
      { code: "springs_metadata_missing" },
      "No VRM spring-bone metadata found; defaulting unprofiled assignments to half intensity.",
    );
  }

  for (const joint of joints) {
    const runtimeNodeIndex = resolveNodeIndexForObject(
      joint.bone,
      parserAssociations,
    );

    if (runtimeNodeIndex === null) {
      assignFallback(assignments, counts, joint, runtimeNodeIndex);
      continue;
    }

    const chain = resolveRawChainForJoint(
      runtimeNodeIndex,
      vrm1ChainsByRuntimeJointNodeIndex,
      vrm0Chains,
      parentByNodeIndex,
    );

    if (!chain) {
      assignFallback(assignments, counts, joint, runtimeNodeIndex);
      continue;
    }

    const assignment = buildAssignmentForChain(chain, runtimeNodeIndex);
    assignments.set(joint, assignment);
    if (assignment.semantic) {
      counts[assignment.semantic] += 1;
    } else {
      counts.unprofiled += 1;
    }
  }

  if (counts.unmapped > 0) {
    pushWarning(
      findings,
      { code: "springs_unmapped_joints", params: { count: counts.unmapped } },
      `${counts.unmapped} spring-bone semantic assignment(s) could not be mapped to raw VRM metadata.`,
    );
  }

  return finalizeClassification(assignments, counts, findings);
}

function finalizeClassification(
  assignments: Map<VRMSpringBoneJoint, SpringBoneSemanticAssignment>,
  counts: SpringBoneSemanticJointCounts,
  findings: Findings,
): SpringBoneSemanticClassification {
  return {
    ready: true,
    assignments,
    counts: {
      ...counts,
      total: assignments.size,
      lowConfidence: Array.from(assignments.values()).filter(
        (assignment) =>
          assignment.confidence < LOW_CONFIDENCE_ASSIGNMENT_THRESHOLD,
      ).length,
    },
    assignmentCount: assignments.size,
    warnings: findings.warnings.slice(-MAX_SEMANTIC_WARNINGS),
    issues: findings.issues,
  };
}

function parseVrm1SpringChains(
  rawJson: JsonRecord,
  nodes: JsonRecord[],
): RawVrm1SpringChain[] {
  const springBoneExtension = getExtension(rawJson, VRM1_SPRING_BONE_EXTENSION);
  const springs = readArray(springBoneExtension?.springs);
  const chains: RawVrm1SpringChain[] = [];

  springs.forEach((rawSpring, index) => {
    if (!isRecord(rawSpring)) return;

    const jointNodeIndices = readArray(rawSpring.joints)
      .map((rawJoint) =>
        isRecord(rawJoint) ? toNodeIndex(rawJoint.node) : null,
      )
      .filter(isNumber);

    if (jointNodeIndices.length === 0) return;

    const rootNodeIndices = jointNodeIndices.slice(0, 1);
    const springName = readOptionalString(rawSpring.name);

    chains.push({
      version: "vrm1",
      index,
      springName,
      rootNodeIndices,
      jointNodeIndices,
      runtimeJointNodeIndices: jointNodeIndices.slice(0, -1),
      rootNodeNames: readNodeNames(nodes, rootNodeIndices),
      jointNodeNames: readNodeNames(nodes, jointNodeIndices),
    });
  });

  return chains;
}

function parseVrm0SpringChains(
  rawJson: JsonRecord,
  nodes: JsonRecord[],
): RawVrm0SpringChain[] {
  const vrmExtension = getExtension(rawJson, VRM0_EXTENSION);
  const secondaryAnimation = isRecord(vrmExtension?.secondaryAnimation)
    ? vrmExtension.secondaryAnimation
    : null;
  const boneGroups = readArray(
    isRecord(secondaryAnimation) ? secondaryAnimation.boneGroups : null,
  );
  const chains: RawVrm0SpringChain[] = [];

  boneGroups.forEach((rawBoneGroup, index) => {
    if (!isRecord(rawBoneGroup)) return;

    const rootNodeIndices = readArray(rawBoneGroup.bones)
      .map(toNodeIndex)
      .filter(isNumber);

    if (rootNodeIndices.length === 0) return;

    const jointNodeIndices = uniqueNumbers(
      rootNodeIndices.flatMap((rootNodeIndex) =>
        collectDescendantNodeIndices(nodes, rootNodeIndex),
      ),
    );
    const comment = readOptionalString(rawBoneGroup.comment);

    chains.push({
      version: "vrm0",
      index,
      comment,
      rootNodeIndices,
      jointNodeIndices,
      rootNodeNames: readNodeNames(nodes, rootNodeIndices),
      jointNodeNames: readNodeNames(nodes, jointNodeIndices),
    });
  });

  return chains;
}

function resolveRawChainForJoint(
  runtimeNodeIndex: number,
  vrm1ChainsByRuntimeJointNodeIndex: Map<number, RawVrm1SpringChain[]>,
  vrm0Chains: RawVrm0SpringChain[],
  parentByNodeIndex: Map<number, number>,
): RawSpringChain | null {
  const vrm1Matches =
    vrm1ChainsByRuntimeJointNodeIndex.get(runtimeNodeIndex) ?? [];
  if (vrm1Matches.length === 1) {
    return vrm1Matches[0];
  }
  if (vrm1Matches.length > 1) {
    return null;
  }

  const vrm0Matches = vrm0Chains.filter((chain) =>
    isNodeUnderAnyRoot(
      runtimeNodeIndex,
      chain.rootNodeIndices,
      parentByNodeIndex,
    ),
  );

  return vrm0Matches.length === 1 ? vrm0Matches[0] : null;
}

function buildAssignmentForChain(
  chain: RawSpringChain,
  runtimeNodeIndex: number,
): SpringBoneSemanticAssignment {
  const evidence = buildEvidence(chain);
  const semanticMatch = findSemanticMatch(evidence);
  const semantic = semanticMatch?.semantic ?? null;
  const source = semanticMatch?.source ?? resolvePrimarySource(chain);
  const confidence = resolveConfidence(semantic, source);
  const baseAssignment = {
    semantic,
    intensityScale:
      semantic !== null
        ? DEFAULT_SPRING_BONE_SEMANTIC_PROFILES[semantic].intensityScale
        : UNPROFILED_SPRING_BONE_INTENSITY_SCALE,
    confidence,
    source,
    rootNodeNames: chain.rootNodeNames,
    jointNodeNames: chain.jointNodeNames,
    runtimeNodeIndex,
  };

  if (chain.version === "vrm1") {
    return {
      ...baseAssignment,
      springName: chain.springName,
      rawSpringIndex: chain.index,
    };
  }

  return {
    ...baseAssignment,
    comment: chain.comment,
    rawBoneGroupIndex: chain.index,
  };
}

function buildEvidence(chain: RawSpringChain): SemanticEvidence[] {
  const evidence: SemanticEvidence[] = [];

  if (chain.version === "vrm1" && chain.springName) {
    evidence.push({
      value: chain.springName,
      source: "vrm1SpringName",
    });
  }

  if (chain.version === "vrm0" && chain.comment) {
    evidence.push({
      value: chain.comment,
      source: "vrm0BoneGroupComment",
    });
  }

  for (const nodeName of chain.jointNodeNames) {
    evidence.push({
      value: nodeName,
      source: "boneName",
    });
  }

  return evidence;
}

function findSemanticMatch(
  evidence: SemanticEvidence[],
): { semantic: SpringBoneSemantic; source: SemanticEvidence["source"] } | null {
  for (const entry of evidence) {
    const semantic = resolveSemanticFromText(entry.value);
    if (semantic) {
      return {
        semantic,
        source: entry.source,
      };
    }
  }

  return null;
}

function resolveSemanticFromText(value: string): SpringBoneSemantic | null {
  const normalized = normalizeNameForTokenMatch(value);

  for (const rule of SEMANTIC_TOKEN_RULES) {
    if (matchesTokenRule(value, normalized, rule)) {
      return rule.semantic;
    }
  }

  return null;
}

function resolvePrimarySource(
  chain: RawSpringChain,
): SpringBoneSemanticAssignmentSource {
  if (chain.version === "vrm1" && chain.springName) {
    return "vrm1SpringName";
  }
  if (chain.version === "vrm0" && chain.comment) {
    return "vrm0BoneGroupComment";
  }
  if (chain.jointNodeNames.length > 0) {
    return "boneName";
  }
  return "fallback";
}

function resolveConfidence(
  semantic: SpringBoneSemantic | null,
  source: SpringBoneSemanticAssignmentSource,
): number {
  if (semantic) {
    return source === "boneName" ? 0.75 : 0.95;
  }
  if (source === "fallback") {
    return 0.35;
  }
  return source === "boneName" ? 0.65 : 0.85;
}

function assignFallback(
  assignments: Map<VRMSpringBoneJoint, SpringBoneSemanticAssignment>,
  counts: SpringBoneSemanticJointCounts,
  joint: VRMSpringBoneJoint,
  runtimeNodeIndex: number | null,
): void {
  const jointName = joint.bone.name.trim();
  assignments.set(joint, {
    semantic: null,
    intensityScale: UNPROFILED_SPRING_BONE_INTENSITY_SCALE,
    confidence: 0.25,
    source: "fallback",
    rootNodeNames: [],
    jointNodeNames: jointName ? [jointName] : [],
    runtimeNodeIndex,
  });
  counts.unprofiled += 1;
  counts.unmapped += 1;
}

function buildVrm1RuntimeJointNodeLookup(
  chains: RawVrm1SpringChain[],
): Map<number, RawVrm1SpringChain[]> {
  const lookup = new Map<number, RawVrm1SpringChain[]>();

  for (const chain of chains) {
    for (const nodeIndex of chain.runtimeJointNodeIndices) {
      const chainsForNodeIndex = lookup.get(nodeIndex) ?? [];
      chainsForNodeIndex.push(chain);
      lookup.set(nodeIndex, chainsForNodeIndex);
    }
  }

  return lookup;
}

function resolveNodeIndexForObject(
  object: THREE.Object3D,
  associations: ParserAssociations,
): number | null {
  let current: THREE.Object3D | null = object;

  while (current) {
    const mapping = associations.get(current);
    if (typeof mapping?.nodes === "number") {
      return mapping.nodes;
    }
    current = current.parent;
  }

  return null;
}

function getExtension(
  rawJson: JsonRecord,
  extensionName: string,
): JsonRecord | null {
  const extensions = isRecord(rawJson.extensions) ? rawJson.extensions : null;
  const extension = extensions?.[extensionName];
  return isRecord(extension) ? extension : null;
}

function readRawNodes(rawJson: JsonRecord): JsonRecord[] {
  return readArray(rawJson.nodes).filter(isRecord);
}

function readNodeNames(nodes: JsonRecord[], nodeIndices: number[]): string[] {
  return uniqueStrings(
    nodeIndices
      .map((nodeIndex) => readNodeName(nodes, nodeIndex))
      .filter(isString),
  );
}

function readNodeName(nodes: JsonRecord[], nodeIndex: number): string | null {
  const node = nodes[nodeIndex];
  if (!node) return null;
  return readOptionalString(node.name) ?? null;
}

function buildParentNodeMap(nodes: JsonRecord[]): Map<number, number> {
  const parentByNodeIndex = new Map<number, number>();

  nodes.forEach((node, parentNodeIndex) => {
    for (const rawChildNodeIndex of readArray(node.children)) {
      const childNodeIndex = toNodeIndex(rawChildNodeIndex);
      if (childNodeIndex === null || parentByNodeIndex.has(childNodeIndex)) {
        continue;
      }
      parentByNodeIndex.set(childNodeIndex, parentNodeIndex);
    }
  });

  return parentByNodeIndex;
}

function collectDescendantNodeIndices(
  nodes: JsonRecord[],
  rootNodeIndex: number,
): number[] {
  const descendants: number[] = [];
  const visited = new Set<number>();
  const stack = [rootNodeIndex];

  while (stack.length > 0) {
    const nodeIndex = stack.pop();
    if (nodeIndex === undefined || visited.has(nodeIndex)) continue;
    visited.add(nodeIndex);
    descendants.push(nodeIndex);

    const node = nodes[nodeIndex];
    if (!node) continue;

    for (const rawChildNodeIndex of readArray(node.children)) {
      const childNodeIndex = toNodeIndex(rawChildNodeIndex);
      if (childNodeIndex !== null) {
        stack.push(childNodeIndex);
      }
    }
  }

  return descendants;
}

function isNodeUnderAnyRoot(
  nodeIndex: number,
  rootNodeIndices: number[],
  parentByNodeIndex: Map<number, number>,
): boolean {
  let currentNodeIndex: number | undefined = nodeIndex;

  while (typeof currentNodeIndex === "number") {
    if (rootNodeIndices.includes(currentNodeIndex)) {
      return true;
    }
    currentNodeIndex = parentByNodeIndex.get(currentNodeIndex);
  }

  return false;
}

function matchesTokenRule(
  originalValue: string,
  normalized: { tokens: string[]; compact: string },
  rule: TokenRule,
): boolean {
  if (rule.japanese?.some((token) => originalValue.includes(token))) {
    return true;
  }

  if (
    rule.latinExact?.some((semanticToken) =>
      normalized.tokens.some((token) => token === semanticToken),
    )
  ) {
    return true;
  }

  if (
    rule.latinPrefix?.some((semanticToken) =>
      normalized.tokens.some(
        (token) => token === semanticToken || token.startsWith(semanticToken),
      ),
    )
  ) {
    return true;
  }

  return Boolean(
    rule.latinCompact?.some((semanticToken) =>
      normalized.compact.includes(semanticToken),
    ),
  );
}

function normalizeNameForTokenMatch(value: string): {
  tokens: string[];
  compact: string;
} {
  const tokenSource = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .toLowerCase();
  const tokens = tokenSource.split(/[^a-z0-9]+/).filter(Boolean);
  return {
    tokens,
    compact: tokens.join(""),
  };
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toNodeIndex(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null;
}

function isNumber(value: number | null): value is number {
  return typeof value === "number";
}

function isString(value: string | null): value is string {
  return typeof value === "string";
}

function uniqueNumbers(values: number[]): number[] {
  return Array.from(new Set(values));
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function createEmptySpringBoneSemanticJointCounts(): SpringBoneSemanticJointCounts {
  return {
    total: 0,
    hair: 0,
    cloth: 0,
    accessory: 0,
    tail: 0,
    ear: 0,
    chest: 0,
    unprofiled: 0,
    unmapped: 0,
    lowConfidence: 0,
  };
}

function pushWarning(
  findings: Findings,
  issue: AvatarIssue,
  warning: string,
): void {
  addAvatarIssue(findings.issues, issue);
  if (findings.warnings.includes(warning)) return;
  findings.warnings.push(warning);
}

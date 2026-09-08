import type { SpringBonePhysicsParams } from "./SpringBonePhysicsController";

export type SpringBoneSemantic =
  | "hair"
  | "cloth"
  | "accessory"
  | "tail"
  | "ear"
  | "chest";

export const SPRING_BONE_SEMANTICS = [
  "hair",
  "cloth",
  "accessory",
  "tail",
  "ear",
  "chest",
] as const satisfies readonly SpringBoneSemantic[];

export const UNPROFILED_SPRING_BONE_INTENSITY_SCALE = 0.5;

export type SpringBoneSemanticProfile = {
  semantic: SpringBoneSemantic;
  intensityScale: number;
  params?: Partial<SpringBonePhysicsParams>;
};

export type SpringBoneSemanticProfileOverride = {
  intensityScale?: number;
  params?: Partial<SpringBonePhysicsParams>;
};

export const DEFAULT_SPRING_BONE_SEMANTIC_PROFILES = {
  hair: {
    semantic: "hair",
    intensityScale: 1,
    params: {},
  },
  cloth: {
    semantic: "cloth",
    intensityScale: 0.5,
    params: {},
  },
  accessory: {
    semantic: "accessory",
    intensityScale: 0.5,
    params: {},
  },
  tail: {
    semantic: "tail",
    intensityScale: 0.5,
    params: {},
  },
  ear: {
    semantic: "ear",
    intensityScale: 0.5,
    params: {},
  },
  chest: {
    semantic: "chest",
    intensityScale: 0.5,
    params: {},
  },
} satisfies Record<SpringBoneSemantic, SpringBoneSemanticProfile>;

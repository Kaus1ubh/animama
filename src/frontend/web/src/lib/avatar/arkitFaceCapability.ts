import { ARKIT_BLENDSHAPES } from "./arkit";

/**
 * Which of the 52 ARKit face shapes an Avatar has, found from its morph-target
 * names.
 *
 * Avatars made for VRChat or face tracking often carry ARKit shapes under
 * slightly different names: `MouthSmile_L`, `mouthsmileleft`, SRanipal's
 * `Mouth_Smile_Left` or Unified Expressions' `MouthCornerPullLeft`. Each name is
 * reduced to a key (lower-case word tokens with the side token taken out) and
 * matched against the canonical ARKit names, so the runtime can drive every
 * Avatar's shapes by one vocabulary (`registerArkitExpressions`).
 */

type Side = "left" | "right" | null;

export interface ArkitFaceCapability {
  /**
   * Canonical ARKit name → the Avatar's morph-target names that drive it.
   * Usually one name; an unsided ARKit shape (`browInnerUp`, `cheekPuff`) an
   * Avatar splits into left and right halves resolves to both halves.
   */
  readonly resolved: ReadonlyMap<string, readonly string[]>;
  /** Canonical names with no matching morph target, in ARKit order. */
  readonly missing: readonly string[];
  /**
   * Canonical names left unresolved because several morph targets matched
   * equally well, with the candidates. Listed in `missing` too unless, for a
   * whole Avatar, another mesh resolves the name.
   */
  readonly ambiguous: ReadonlyMap<string, readonly string[]>;
}

/**
 * Face-tracking names whose words differ from ARKit's, as key → ARKit key.
 * Keys are side-free lower-case words joined without separators. Many
 * SRanipal names (`Eye_Left_Blink`, `Jaw_Open`, `Mouth_Smile_Left`) reduce to
 * ARKit keys already; these add SRanipal and Unified Expressions shapes that
 * correspond one-to-one with an ARKit shape. Eye-look names with two side
 * words, such as SRanipal's `Eye_Left_Left`, are not matched.
 */
const FACE_TRACKING_ALIASES: Readonly<Record<string, string>> = {
  // Unified Expressions
  eyeclosed: "eyeblink",
  browlowerer: "browdown",
  mouthcornerpull: "mouthsmile",
  mouthclosed: "mouthclose",
  mouthraiserupper: "mouthshrugupper",
  mouthraiserlower: "mouthshruglower",
  lipfunnel: "mouthfunnel",
  lippucker: "mouthpucker",
  lipsuckupper: "mouthrollupper",
  lipsucklower: "mouthrolllower",
  // SRanipal and Unified Expressions' blended shapes
  mouthsad: "mouthfrown",
  eyesqueeze: "eyesquint",
  mouthpout: "mouthpucker",
  mouthoshape: "mouthfunnel",
  mouthupperinside: "mouthrollupper",
  mouthlowerinside: "mouthrolllower",
};

const SIDE_TOKENS: Readonly<Record<string, Exclude<Side, null>>> = {
  l: "left",
  left: "left",
  r: "right",
  right: "right",
};

interface ShapeKey {
  base: string;
  side: Side;
}

/**
 * Split a shape name into lower-case word tokens at separators (`_`, `-`, `.`,
 * spaces) and camel-case boundaries: `Mouth_Smile_L` and `mouthSmileL` both
 * become `mouth smile l`.
 */
function tokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_.-]+/)
    .map((token) => token.toLowerCase())
    .filter(Boolean);
}

/**
 * Reduce a shape name to its side-free key and side. Only one side token is
 * taken out; a name with two (or none) keeps any remaining ones in its base.
 */
function shapeKey(name: string): ShapeKey {
  const words = tokens(name);
  const sideIndexes = words
    .map((word, index) => (word in SIDE_TOKENS ? index : -1))
    .filter((index) => index >= 0);
  // A side counts only beside other words (`Smile_L`, `L_Smile`), never as
  // the whole name.
  if (sideIndexes.length !== 1 || words.length < 2) {
    return { base: words.join(""), side: null };
  }
  const index = sideIndexes[0]!;
  const side = SIDE_TOKENS[words[index]!]!;
  return {
    base: words.filter((_, i) => i !== index).join(""),
    side,
  };
}

const keyString = (key: ShapeKey) => `${key.base}|${key.side ?? ""}`;

/**
 * A shape name's matching key, as ARKit names are matched: lower-case words
 * with separators and camel case ignored and one side token (`_L`, `Left` …)
 * reduced to its side, so `vrc.blink_left`, `VRC_Blink_L` and `vrc.blink.L`
 * share one key. `faceSignals.ts` matches VRChat's shapes by it.
 */
export function shapeMatchKey(name: string): string {
  return keyString(shapeKey(name));
}

/**
 * Resolve the ARKit shapes an Avatar has from its morph-target names.
 *
 * Matching prefers, in order: the exact canonical name; a case-insensitive
 * match; a match by key; a match by face-tracking alias. Within the first level
 * that has any match, a single candidate resolves and several are reported as
 * ambiguous. An unsided ARKit shape with no unsided match resolves to a
 * left/right pair when both halves match by key or alias.
 */
export function resolveArkitFaceCapability(
  morphTargetNames: Iterable<string>,
): ArkitFaceCapability {
  const names = [...new Set(morphTargetNames)].filter(
    (name) => name.trim() !== "",
  );
  const byKey = new Map<string, string[]>();
  const byAlias = new Map<string, string[]>();
  for (const name of names) {
    const key = shapeKey(name);
    push(byKey, keyString(key), name);
    const alias = FACE_TRACKING_ALIASES[key.base];
    if (alias) push(byAlias, keyString({ base: alias, side: key.side }), name);
  }

  const resolved = new Map<string, readonly string[]>();
  const ambiguous = new Map<string, readonly string[]>();
  for (const canonical of ARKIT_BLENDSHAPES) {
    const key = shapeKey(canonical);
    const levels: (readonly string[])[] = [
      names.filter((name) => name === canonical),
      names.filter((name) => name.toLowerCase() === canonical.toLowerCase()),
      byKey.get(keyString(key)) ?? [],
      byAlias.get(keyString(key)) ?? [],
    ];
    const level = levels.find((candidates) => candidates.length > 0);
    if (level?.length === 1) {
      resolved.set(canonical, level);
      continue;
    }
    if (level) {
      ambiguous.set(canonical, level);
      continue;
    }
    if (key.side === null) {
      const halves = (["left", "right"] as const).map((side) => {
        const sided = keyString({ base: key.base, side });
        const direct = byKey.get(sided) ?? [];
        return direct.length > 0 ? direct : (byAlias.get(sided) ?? []);
      });
      if (halves.every((half) => half.length === 1)) {
        resolved.set(canonical, [halves[0]![0]!, halves[1]![0]!]);
      } else if (halves.every((half) => half.length > 0)) {
        ambiguous.set(canonical, halves.flat());
      }
    }
  }

  return {
    resolved,
    missing: ARKIT_BLENDSHAPES.filter((name) => !resolved.has(name)),
    ambiguous,
  };
}

function push(map: Map<string, string[]>, key: string, name: string): void {
  const list = map.get(key);
  if (list) list.push(name);
  else map.set(key, [name]);
}

/** ARKit shapes resolved mesh by mesh, with the Avatar-wide summary. */
export interface MeshArkitFaces {
  /**
   * The union over meshes: a shape is resolved when any mesh resolves it, and
   * ambiguous when any mesh found several equal candidates for it (those
   * morphs stay unbound even if another mesh resolves the shape).
   */
  readonly capability: ArkitFaceCapability;
  /** For each input mesh, in order, its own canonical name → morph names. */
  readonly meshes: readonly ReadonlyMap<string, readonly string[]>[];
}

/**
 * Resolve ARKit shapes separately for each mesh, so a face and a teeth mesh
 * that spell a shape differently (`MouthSmile_L`, `mouthSmileLeft`) each bind
 * their own morph target.
 *
 * @param meshMorphNames Each mesh's morph-target names.
 */
export function resolveArkitFacesPerMesh(
  meshMorphNames: readonly Iterable<string>[],
): MeshArkitFaces {
  const perMesh = meshMorphNames.map((names) =>
    resolveArkitFaceCapability(names),
  );
  const resolved = new Map<string, readonly string[]>();
  const ambiguous = new Map<string, readonly string[]>();
  for (const canonical of ARKIT_BLENDSHAPES) {
    const morphs = new Set(
      perMesh.flatMap((mesh) => mesh.resolved.get(canonical) ?? []),
    );
    if (morphs.size > 0) resolved.set(canonical, [...morphs]);
    const candidates = new Set(
      perMesh.flatMap((mesh) => mesh.ambiguous.get(canonical) ?? []),
    );
    if (candidates.size > 0) ambiguous.set(canonical, [...candidates]);
  }
  return {
    capability: {
      resolved,
      missing: ARKIT_BLENDSHAPES.filter((name) => !resolved.has(name)),
      ambiguous,
    },
    meshes: perMesh.map((mesh) => mesh.resolved),
  };
}

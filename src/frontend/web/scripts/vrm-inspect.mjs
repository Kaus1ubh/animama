import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadWebModule } from "./effects.mjs";
import {
  COMPONENT_SIZE,
  readGlb,
  TYPE_COMPONENTS,
} from "./vrm-optimize/glb.mjs";

/**
 * Report what a VRM file holds and what the app will make of its face:
 *
 *   pnpm -s vrm:inspect <file.vrm> [--json]
 *
 * It reads only. The report covers the VRM version, extensions, materials,
 * images, each mesh's size and morph-target names with where they are stored
 * (mesh level, or per primitive, which Animama applies when the primitives
 * agree; `primitiveTargetNames.ts`), the expressions the file authors, the
 * ARKit face shapes the app resolves after loading, where each blink and
 * viseme comes from (`faceSignals.ts`), and the face parts the app detects.
 * Use it on converted Avatars before importing them; see
 * docs/frontend/runtime/avatar-animation.md.
 */

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const USAGE = "Usage: pnpm -s vrm:inspect <file.vrm> [--json]";

/** The backend's VRM upload limit (`MAX_VRM_SOURCE_BYTES`). */
export const VRM_UPLOAD_LIMIT_BYTES = 100 * 1024 * 1024;

/**
 * How the report words where a mesh's morph-target names come from, by
 * `resolveMeshTargetNames` source.
 */
const NAME_STORAGE = {
  none: "no morph targets",
  mesh: "mesh",
  primitives: "primitives only",
  mismatched: "primitives, mismatched",
  unnamed: "none",
};

/** The bytes an accessor's data occupies, counting sparse storage as stored. */
function accessorBytes(accessor) {
  const elementSize =
    COMPONENT_SIZE[accessor.componentType] * TYPE_COMPONENTS[accessor.type];
  const dense =
    accessor.bufferView === undefined ? 0 : accessor.count * elementSize;
  const sparse = accessor.sparse
    ? accessor.sparse.count *
      (elementSize + COMPONENT_SIZE[accessor.sparse.indices.componentType])
    : 0;
  return dense + sparse;
}

/** Bytes of the geometry, indices and morph targets a mesh uses. */
function meshBytes(json, mesh) {
  const accessors = new Set();
  for (const primitive of mesh.primitives ?? []) {
    for (const index of Object.values(primitive.attributes ?? {}))
      accessors.add(index);
    if (primitive.indices !== undefined) accessors.add(primitive.indices);
    for (const target of primitive.targets ?? [])
      for (const index of Object.values(target)) accessors.add(index);
  }
  return [...accessors].reduce(
    (total, index) => total + accessorBytes(json.accessors[index]),
    0,
  );
}

/** Expression names the file authors, by VRM version. */
function authoredExpressions(json) {
  const vrm1 = json.extensions?.VRMC_vrm?.expressions;
  if (vrm1) {
    return {
      preset: Object.keys(vrm1.preset ?? {}),
      custom: Object.keys(vrm1.custom ?? {}),
    };
  }
  const groups = json.extensions?.VRM?.blendShapeMaster?.blendShapeGroups ?? [];
  return {
    preset: groups
      .map((group) => group.presetName)
      .filter((name) => name && name !== "unknown"),
    custom: groups
      .filter((group) => !group.presetName || group.presetName === "unknown")
      .map((group) => group.name),
  };
}

/**
 * Summarize a GLB document's JSON without loading it.
 *
 * @param resolveMeshTargetNames From `primitiveTargetNames.ts`, the rule the
 *   Avatar loaders apply.
 */
export function inspectDocument(document, fileBytes, resolveMeshTargetNames) {
  const { json } = document;
  const vrmVersion = json.extensions?.VRMC_vrm
    ? `VRM ${json.extensions.VRMC_vrm.specVersion}`
    : json.extensions?.VRM
      ? `VRM ${json.extensions.VRM.specVersion ?? "0.x"}`
      : "not a VRM";
  const materials = json.materials ?? [];
  const materialsWith = (extension) =>
    materials.filter((material) => material.extensions?.[extension]).length;
  const imageBytes = (json.images ?? []).reduce(
    (total, image) =>
      total +
      (image.bufferView === undefined
        ? 0
        : (json.bufferViews[image.bufferView]?.byteLength ?? 0)),
    0,
  );
  return {
    fileBytes,
    overUploadLimit: fileBytes > VRM_UPLOAD_LIMIT_BYTES,
    vrmVersion,
    extensionsUsed: json.extensionsUsed ?? [],
    extensionsRequired: json.extensionsRequired ?? [],
    meshes: (json.meshes ?? []).map((mesh) => {
      const { source, names } = resolveMeshTargetNames(mesh);
      return {
        name: mesh.name ?? "",
        primitives: mesh.primitives?.length ?? 0,
        bytes: meshBytes(json, mesh),
        morphTargets: mesh.primitives?.[0]?.targets?.length ?? 0,
        morphNames: NAME_STORAGE[source],
        targetNames: names,
      };
    }),
    materials: {
      total: materials.length,
      mtoon: materialsWith("VRMC_materials_mtoon"),
      liltoon: materialsWith("MOCHIYA_materials_liltoon"),
      unlit: materialsWith("KHR_materials_unlit"),
    },
    images: { count: json.images?.length ?? 0, bytes: imageBytes },
    expressions: authoredExpressions(json),
  };
}

/**
 * Each face part role's source and how many mesh parts (and regions inside
 * shared ones) hold it, as `Avatar.load` detects them after the load-time
 * installs; null with the failure's code and message when detection throws,
 * which the app survives by falling back to material names. As in
 * Diagnostics, a mesh part holding only a region of the part counts as a
 * region, and face skin that is the head of a whole-body mesh part says so.
 */
function detectFaceParts(detectAvatarFaceParts, vrm, gltf) {
  try {
    const map = detectAvatarFaceParts(vrm, gltf, {});
    return {
      parts: Object.fromEntries(
        Object.values(map.parts).map((part) => {
          const regionKeys = new Set(
            (part.regions ?? []).map((region) => region.bindingKey),
          );
          return [
            part.role,
            {
              source: part.source,
              bindings: part.bindings.filter((key) => !regionKeys.has(key))
                .length,
              regions: part.regions?.length ?? 0,
              // What an eye without geometry of its own is placed from.
              ...(part.estimate ? { estimate: part.estimate } : {}),
              ...(part.role === "face_skin" && regionKeys.size > 0
                ? { headRegion: true }
                : {}),
            },
          ];
        }),
      ),
      issues: map.issues.map((issue) => issue.code),
    };
  } catch (error) {
    return {
      parts: null,
      issues: ["face_parts_detection_failed"],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Load the file as the app does and resolve its ARKit face shapes, mesh by
 * mesh, from the morph-target names the loader produced; then run the app's
 * load-time installs and face part detection.
 *
 * @param web A `loadWebModule` handle on `headlessVrm.ts`.
 */
async function inspectLoadedFace(web, bytes) {
  const { resolveArkitFacesPerMesh } = await web.load(
    path.join(webRoot, "src/lib/avatar/arkitFaceCapability.ts"),
  );
  const { prepareLoadedVrm } = await web.load(
    path.join(webRoot, "src/lib/avatar/prepareLoadedVrm.ts"),
  );
  const { detectAvatarFaceParts } = await web.load(
    path.join(webRoot, "src/lib/avatar/vfx/faceParts.ts"),
  );
  // The app's geometry cleanup too, since face part detection reads it.
  const { vrm, gltf } = await web.module.loadHeadlessVrmWithGltf(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    { removeUnnecessaryVertices: true },
  );
  const meshNames = [];
  vrm.scene.traverse((object) => {
    if (object.isMesh && object.morphTargetDictionary)
      meshNames.push(Object.keys(object.morphTargetDictionary));
  });
  const { capability } = resolveArkitFacesPerMesh(meshNames);
  // The app keeps an expression the file already authors under an ARKit
  // name instead of binding the resolved morph targets.
  const authored = [...capability.resolved.keys()].filter((canonical) =>
    vrm.expressionManager?.getExpression(canonical),
  );
  // The same decisions `Avatar.load` makes (after `authored` is read, since
  // registering adds the canonical names).
  const {
    faceSignals,
    arkitFace: { playsFacesWithArkit, moods },
  } = prepareLoadedVrm(vrm, { vrmSha256: null });
  return {
    morphNames: new Set(meshNames.flat()).size,
    // Each blink and viseme preset's source: the file's preset, or the
    // shapes Animama filled it from.
    faceSignals,
    face: detectFaceParts(detectAvatarFaceParts, vrm, gltf),
    arkit: {
      resolved: capability.resolved.size,
      total: capability.resolved.size + capability.missing.length,
      playsFacesWithArkit,
      // Each mood preset's region sources (brow, eye, mouth).
      moods,
      authored,
      // Shapes found under another name, to check the matching by eye.
      renamed: Object.fromEntries(
        [...capability.resolved].filter(
          ([canonical, morphs]) =>
            !authored.includes(canonical) &&
            (morphs.length !== 1 || morphs[0] !== canonical),
        ),
      ),
      missing: capability.missing,
      ambiguous: Object.fromEntries(capability.ambiguous),
    },
  };
}

/** The full report for a VRM file's bytes. */
export async function inspectVrm(bytes) {
  const web = await loadWebModule(
    path.join(webRoot, "src/lib/avatar/motion-authoring/headlessVrm.ts"),
  );
  try {
    const { resolveMeshTargetNames } = await web.load(
      path.join(webRoot, "src/lib/avatar/primitiveTargetNames.ts"),
    );
    return {
      ...inspectDocument(
        readGlb(bytes),
        bytes.byteLength,
        resolveMeshTargetNames,
      ),
      loaded: await inspectLoadedFace(web, bytes),
    };
  } finally {
    await web.close();
  }
}

const megabytes = (bytes) => `${(bytes / 1e6).toFixed(2)} MB`;

/** How the report words each `FaceSignalSource`. */
const SIGNAL_SOURCES = {
  preset: "preset",
  left_right: "from left and right blinks",
  mmd: "MMD",
  arkit: "ARKit",
  vrchat: "VRChat",
  none: "none",
};

/** How the report words what an estimated eye is placed from. */
const ESTIMATES = {
  blink: "blinking",
  eye_bone: "its eye bone",
};

/** Print a report as readable lines. */
export function formatReport(report) {
  const lines = [
    `${report.vrmVersion}, ${megabytes(report.fileBytes)}${report.overUploadLimit ? " (over the 100 MiB upload limit; reduce it with vrm:optimize)" : ""}`,
    `extensions used: ${report.extensionsUsed.join(", ") || "none"}`,
  ];
  if (report.extensionsRequired.length)
    lines.push(`extensions required: ${report.extensionsRequired.join(", ")}`);
  const { materials } = report;
  lines.push(
    `materials: ${materials.total} (${materials.mtoon} MToon, ${materials.liltoon} lilToon, ${materials.unlit} unlit)`,
    `images: ${report.images.count}, ${megabytes(report.images.bytes)}`,
    "meshes:",
  );
  for (const mesh of report.meshes) {
    const warning =
      mesh.morphNames === NAME_STORAGE.mismatched
        ? " — the stored names disagree with each other or with the shapes, so they load unnamed"
        : mesh.morphNames === NAME_STORAGE.unnamed
          ? " — unnamed"
          : "";
    lines.push(
      `  ${mesh.name || "(unnamed)"}: ${mesh.primitives} primitives, ${megabytes(mesh.bytes)}, ${mesh.morphTargets} morph targets, names stored: ${mesh.morphNames}${warning}`,
    );
    if (mesh.targetNames.length)
      lines.push(`    ${mesh.targetNames.join(", ")}`);
  }
  const { preset, custom } = report.expressions;
  lines.push(
    `authored expressions: ${preset.length} preset (${preset.join(", ") || "none"}), ${custom.length} custom`,
  );
  const { loaded } = report;
  const { arkit } = loaded;
  lines.push(
    `loaded morph names: ${loaded.morphNames}`,
    `ARKit shapes: ${arkit.resolved} of ${arkit.total}`,
  );
  if (arkit.resolved > 0)
    lines.push(
      arkit.playsFacesWithArkit
        ? "  Animama plays some of this Avatar's mood regions as ARKit mixes"
        : "  Animama plays the file's presets (no mood region has all its table shapes, or it has VRoid mood parts)",
    );
  lines.push(
    "mood faces (brow/eye/mouth):",
    ...Object.entries(arkit.moods).map(
      ([preset, regions]) =>
        `  ${preset}: ${regions.brow}/${regions.eye}/${regions.mouth}`,
    ),
  );
  if (arkit.authored.length)
    lines.push(`  authored by the file: ${arkit.authored.join(", ")}`);
  for (const [canonical, morphs] of Object.entries(arkit.renamed))
    lines.push(`  ${canonical} ← ${morphs.join(" + ")}`);
  // An Avatar without ARKit shapes would list all 52; say nothing instead.
  if (arkit.resolved > 0 && arkit.missing.length)
    lines.push(`  missing: ${arkit.missing.join(", ")}`);
  for (const [canonical, candidates] of Object.entries(arkit.ambiguous))
    lines.push(`  ambiguous ${canonical}: ${candidates.join(", ")}`);
  lines.push(
    `blink and visemes: ${Object.entries(loaded.faceSignals)
      .map(([preset, source]) => `${preset} ${SIGNAL_SOURCES[source]}`)
      .join(", ")}`,
  );
  const { face } = loaded;
  lines.push(
    face.parts
      ? `face parts: ${Object.entries(face.parts)
          .map(
            ([role, part]) =>
              `${role} ${part.source}` +
              (part.source === "missing"
                ? ""
                : part.estimate
                  ? ` from ${ESTIMATES[part.estimate] ?? part.estimate}`
                  : part.headRegion
                    ? " (the head of a whole-body mesh part)"
                    : ` (${part.bindings} mesh part(s)${part.regions ? `, ${part.regions} region(s)` : ""})`),
          )
          .join(", ")}`
      : `face parts: detection failed (${face.error}); the app places effects by material names`,
  );
  if (face.issues.length) lines.push(`  issues: ${face.issues.join(", ")}`);
  return lines.join("\n");
}

async function main(argv) {
  const json = argv.includes("--json");
  const positional = argv.filter((value) => value !== "--json");
  if (argv.includes("--help")) {
    console.log(USAGE);
    return 0;
  }
  const unknown = positional.find((value) => value.startsWith("--"));
  if (positional.length !== 1 || unknown) {
    console.error(unknown ? `Unknown option ${unknown}.\n\n${USAGE}` : USAGE);
    return 2;
  }
  const bytes = new Uint8Array(await readFile(positional[0]));
  const report = await inspectVrm(bytes);
  console.log(json ? JSON.stringify(report, null, 2) : formatReport(report));
  return 0;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}

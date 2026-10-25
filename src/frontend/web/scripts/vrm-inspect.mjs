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
 * (three.js reads mesh-level `extras.targetNames` only), the expressions the
 * file authors, and the ARKit face shapes the app resolves after loading.
 * Use it on converted Avatars before importing them; see
 * docs/frontend/runtime/avatar-animation.md.
 */

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const USAGE = "Usage: pnpm -s vrm:inspect <file.vrm> [--json]";

/** The backend's VRM upload limit (`MAX_VRM_SOURCE_BYTES`). */
export const VRM_UPLOAD_LIMIT_BYTES = 100 * 1024 * 1024;

/**
 * Where a mesh keeps its morph-target names, as three.js will see them, and
 * the names themselves (from the primitives when only they carry them).
 */
function morphNames(mesh) {
  const targets = mesh.primitives?.[0]?.targets?.length ?? 0;
  if (targets === 0) return { storage: "no morph targets", names: [] };
  if (Array.isArray(mesh.extras?.targetNames))
    return { storage: "mesh", names: mesh.extras.targetNames };
  const primitive = mesh.primitives.find((candidate) =>
    Array.isArray(candidate.extras?.targetNames),
  );
  return primitive
    ? { storage: "primitives only", names: primitive.extras.targetNames }
    : { storage: "none", names: [] };
}

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

/** Summarize a GLB document's JSON without loading it. */
export function inspectDocument(document, fileBytes) {
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
      const { storage, names } = morphNames(mesh);
      return {
        name: mesh.name ?? "",
        primitives: mesh.primitives?.length ?? 0,
        bytes: meshBytes(json, mesh),
        morphTargets: mesh.primitives?.[0]?.targets?.length ?? 0,
        morphNames: storage,
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
 * Load the file as the app does and resolve its ARKit face shapes, mesh by
 * mesh, from the morph-target names three.js produced.
 */
async function inspectLoadedFace(bytes) {
  const web = await loadWebModule(
    path.join(webRoot, "src/lib/avatar/motion-authoring/headlessVrm.ts"),
  );
  try {
    const { resolveArkitFacesPerMesh } = await web.load(
      path.join(webRoot, "src/lib/avatar/arkitFaceCapability.ts"),
    );
    const { registerArkitFace } = await web.load(
      path.join(webRoot, "src/lib/avatar/arkitFaceExpressions.ts"),
    );
    const vrm = await web.module.loadHeadlessVrm(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
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
    // The same decision `Avatar.load` makes (after `authored` is read, since
    // registering adds the canonical names).
    const { playsFacesWithArkit } = registerArkitFace(vrm);
    return {
      morphNames: new Set(meshNames.flat()).size,
      arkit: {
        resolved: capability.resolved.size,
        total: capability.resolved.size + capability.missing.length,
        playsFacesWithArkit,
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
  } finally {
    await web.close();
  }
}

/** The full report for a VRM file's bytes. */
export async function inspectVrm(bytes) {
  return {
    ...inspectDocument(readGlb(bytes), bytes.byteLength),
    loaded: await inspectLoadedFace(bytes),
  };
}

const megabytes = (bytes) => `${(bytes / 1e6).toFixed(2)} MB`;

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
      mesh.morphNames === "primitives only"
        ? " — three.js ignores these names"
        : mesh.morphNames === "none"
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
        ? "  Animama plays this Avatar's faces as ARKit mixes"
        : "  Animama plays its own presets (it lacks a table shape or has VRoid mood parts)",
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

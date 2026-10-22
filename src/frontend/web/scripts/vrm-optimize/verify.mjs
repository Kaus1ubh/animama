import sharp from "sharp";

import { denseAccessorBytes, readGlb, viewBytes } from "./glb.mjs";
import {
  THUMBNAIL_MAX,
  imageRoles,
  rgbaPixels,
  textureImage,
} from "./optimize.mjs";

/**
 * Compare a source VRM with its optimized copy. Everything except what the
 * optimizer may change must be identical: the JSON document with buffer
 * storage normalized away, every accessor's values, each image's size and
 * every data texture's pixels. Returns human-readable differences; an empty
 * list means equivalent.
 */
export async function compareVrm(sourceBytes, optimizedBytes, { meta } = {}) {
  const source = readGlb(sourceBytes);
  const optimized = readGlb(optimizedBytes);
  if (
    !source.json.extensions?.VRMC_vrm ||
    !optimized.json.extensions?.VRMC_vrm
  ) {
    throw new Error("Both files must be VRM 1.0 (VRMC_vrm).");
  }
  const differences = [];

  const sourceJson = normalizedJson(source.json);
  const optimizedJson = normalizedJson(optimized.json);
  const sourceMeta = source.json.extensions?.VRMC_vrm?.meta ?? {};
  const expectedMeta = meta
    ? { ...meta, thumbnailImage: sourceMeta.thumbnailImage }
    : sourceMeta;
  if (sourceMeta.thumbnailImage === undefined)
    delete expectedMeta.thumbnailImage;
  sourceJson.extensions.VRMC_vrm.meta = expectedMeta;
  for (const path of diffPaths(sourceJson, optimizedJson))
    differences.push(`JSON differs at ${path}`);

  for (const [index, accessor] of source.json.accessors.entries()) {
    const other = optimized.json.accessors[index];
    if (!other) continue;
    if (
      !sameValues(
        accessor,
        denseAccessorBytes(source, accessor),
        denseAccessorBytes(optimized, other),
      )
    ) {
      differences.push(`accessor ${index} values differ`);
    }
  }

  const thumbnail = sourceMeta.thumbnailImage;
  const roles = imageRoles(source.json);
  for (const [index, image] of (source.json.images ?? []).entries()) {
    const other = optimized.json.images?.[index];
    if (!other) continue;
    const sourceBytesOf = viewBytes(source, image.bufferView);
    const optimizedBytesOf = viewBytes(optimized, other.bufferView);
    const [before, after] = await Promise.all([
      sharp(sourceBytesOf).metadata(),
      sharp(optimizedBytesOf).metadata(),
    ]);
    const size = (value) => `${value.width}x${value.height}`;
    if (index === thumbnail && !roles.has(index)) {
      const largest = Math.max(before.width, before.height);
      if (
        Math.max(after.width, after.height) > Math.min(largest, THUMBNAIL_MAX)
      ) {
        differences.push(`thumbnail image ${index} is ${size(after)}`);
      }
      continue;
    }
    if (size(before) !== size(after)) {
      differences.push(
        `image ${index} changed size from ${size(before)} to ${size(after)}`,
      );
    } else if (
      roles.get(index) === "data" &&
      !(await rgbaPixels(sourceBytesOf)).equals(
        await rgbaPixels(optimizedBytesOf),
      )
    ) {
      differences.push(`data image ${index} pixels differ`);
    }
  }
  return differences;
}

/** The document without buffer storage and image encoding, which may change. */
function normalizedJson(json) {
  const copy = structuredClone(json);
  delete copy.buffers;
  delete copy.bufferViews;
  for (const key of ["extensionsUsed", "extensionsRequired"]) {
    if (!copy[key]) continue;
    copy[key] = copy[key].filter((name) => name !== "EXT_texture_webp").sort();
    if (!copy[key].length) delete copy[key];
  }
  for (const accessor of copy.accessors ?? []) {
    delete accessor.bufferView;
    delete accessor.byteOffset;
    delete accessor.sparse;
  }
  for (const image of copy.images ?? []) {
    delete image.bufferView;
    delete image.mimeType;
  }
  for (const texture of copy.textures ?? []) {
    // Compare the image a texture draws, plus any fallback it already had
    // beside EXT_texture_webp, which the optimizer must keep.
    const image = textureImage(texture);
    if (texture.extensions?.EXT_texture_webp) {
      texture.webpFallback = texture.source;
      delete texture.extensions.EXT_texture_webp;
      if (!Object.keys(texture.extensions).length) delete texture.extensions;
    }
    texture.source = image;
  }
  return copy;
}

function diffPaths(left, right, path = "$") {
  if (Object.is(left, right)) return [];
  if (
    typeof left !== "object" ||
    typeof right !== "object" ||
    left === null ||
    right === null
  ) {
    return left === right ? [] : [path];
  }
  if (Array.isArray(left) !== Array.isArray(right)) return [path];
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].flatMap((key) =>
    diffPaths(left[key], right[key], `${path}.${key}`),
  );
}

/** Byte equality, except float values compare numerically so -0 equals 0. */
function sameValues(accessor, left, right) {
  if (left.length !== right.length) return false;
  if (accessor.componentType !== 5126) return left.equals(right);
  for (let offset = 0; offset < left.length; offset += 4) {
    if (left.readFloatLE(offset) !== right.readFloatLE(offset)) return false;
  }
  return true;
}

import { describe, expect, it } from "vitest";

import fixture from "../content/fixtures/effect-art-limits.json";
import {
  PARTICLE_TEXTURE_LIMITS,
  SCENE_IMAGE_LIMITS,
  inspectEffectArt,
} from "./effectArtLimits";

/** A PNG signature and IHDR declaring `width`×`height`, padded to `size` bytes. */
function pngHeader(width: number, height: number, size = 64): Blob {
  const bytes = new Uint8Array(Math.max(size, 33));
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0, 0, 0, 13], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return new Blob([bytes], { type: "image/png" });
}

/** A JPEG start-of-image marker followed by a baseline frame header. */
function jpegHeader(width: number, height: number): Blob {
  const bytes = new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x03,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  ]);
  return new Blob([bytes], { type: "image/jpeg" });
}

describe("effect art limits", () => {
  it("match the shared fixture the scripts and backend also check", () => {
    expect(PARTICLE_TEXTURE_LIMITS).toEqual(fixture.particleTexture);
    expect(SCENE_IMAGE_LIMITS).toEqual(fixture.sceneImage);
  });

  it("accept a PNG within the limits and report its header size", async () => {
    await expect(
      inspectEffectArt(pngHeader(512, 256), PARTICLE_TEXTURE_LIMITS, {
        formats: ["png"],
      }),
    ).resolves.toEqual({ ok: true, format: "png", width: 512, height: 256 });
  });

  it("refuse oversized files before reading their header", async () => {
    const blob = pngHeader(64, 64, PARTICLE_TEXTURE_LIMITS.bytes + 1);
    await expect(
      inspectEffectArt(blob, PARTICLE_TEXTURE_LIMITS, { formats: ["png"] }),
    ).resolves.toEqual({
      ok: false,
      reason: "bytes",
      limit: PARTICLE_TEXTURE_LIMITS.bytes,
    });
  });

  it("refuse a side or pixel count over the limit, naming the limit", async () => {
    await expect(
      inspectEffectArt(pngHeader(2049, 16), PARTICLE_TEXTURE_LIMITS),
    ).resolves.toEqual({
      ok: false,
      reason: "dimension",
      limit: PARTICLE_TEXTURE_LIMITS.dimension,
    });
    await expect(
      inspectEffectArt(pngHeader(4096, 4097), SCENE_IMAGE_LIMITS),
    ).resolves.toEqual({
      ok: false,
      reason: "dimension",
      limit: SCENE_IMAGE_LIMITS.dimension,
    });
  });

  it("refuse other formats and unreadable headers as format errors", async () => {
    await expect(
      inspectEffectArt(jpegHeader(64, 64), PARTICLE_TEXTURE_LIMITS, {
        formats: ["png"],
      }),
    ).resolves.toEqual({ ok: false, reason: "format", limit: null });
    await expect(
      inspectEffectArt(new Blob([new Uint8Array(40)]), PARTICLE_TEXTURE_LIMITS),
    ).resolves.toEqual({ ok: false, reason: "format", limit: null });
    await expect(
      inspectEffectArt(new Blob([]), PARTICLE_TEXTURE_LIMITS),
    ).resolves.toEqual({ ok: false, reason: "format", limit: null });
  });

  it("accept other raster formats when the caller allows them", async () => {
    await expect(
      inspectEffectArt(jpegHeader(300, 200), SCENE_IMAGE_LIMITS),
    ).resolves.toEqual({ ok: true, format: "jpeg", width: 300, height: 200 });
  });
});

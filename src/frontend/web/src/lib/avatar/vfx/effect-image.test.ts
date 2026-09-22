import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadEffectImage } from "./effect-image";

/** Keep image completion under test control without a browser or network. */
class TestImage {
  decoding = "";
  src = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
}

describe("effect image lifetime", () => {
  let images: TestImage[];

  beforeEach(() => {
    images = [];
    vi.stubGlobal(
      "Image",
      class extends TestImage {
        constructor() {
          super();
          images.push(this);
        }
      },
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("shares a pending load but leaves completed images with their consumers", async () => {
    const first = loadEffectImage("blob:shared-effect");
    const concurrent = loadEffectImage("blob:shared-effect");
    expect(images).toHaveLength(1);
    const image = images[0]!;
    image.onload!();
    expect(await first).toBe(image);
    expect(await concurrent).toBe(image);

    // A completed URL is no longer held in the shared loading cache.
    const later = loadEffectImage("blob:shared-effect");
    expect(images).toHaveLength(2);
    images[1]!.onload!();
    expect(await later).toBe(images[1]);
    // Releasing the cache must not invalidate another effect's active image.
    expect(image.src).toBe("blob:shared-effect");
  });

  it("detaches completion handlers after a successful load", async () => {
    const loading = loadEffectImage("blob:success");
    images[0]!.onload!();
    await loading;
    expect(images[0]!.onload).toBeNull();
    expect(images[0]!.onerror).toBeNull();
  });

  it("releases failed loads and lets all consumers retry", async () => {
    const first = loadEffectImage("blob:retry");
    const concurrent = loadEffectImage("blob:retry");
    const settled = Promise.allSettled([first, concurrent]);
    images[0]!.onerror!();
    const results = await settled;
    expect(results).toEqual([
      {
        status: "rejected",
        reason: new Error('Failed to load VFX asset "blob:retry".'),
      },
      {
        status: "rejected",
        reason: new Error('Failed to load VFX asset "blob:retry".'),
      },
    ]);
    expect(images[0]!.onload).toBeNull();
    expect(images[0]!.onerror).toBeNull();

    const retry = loadEffectImage("blob:retry");
    expect(images).toHaveLength(2);
    images[1]!.onload!();
    expect(await retry).toBe(images[1]);
  });
});

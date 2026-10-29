/**
 * A canvas whose 2D context accepts every call, enough for the effect
 * controller's composites in Node tests. Drawing does nothing except carry
 * `color`: a canvas drawn from another takes that canvas's colour, and every
 * pixel reads back as that opaque colour (light grey by default), so a test
 * can make a texture or an effect's art dark, light or tinted.
 */
export class StubCanvas {
  width = 256;
  height = 256;
  /** The red, green and blue levels (0–255) every pixel reads back as. */
  color: readonly [number, number, number] = [200, 200, 200];

  getContext() {
    const state: Record<string | symbol, unknown> = {
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      fillStyle: "",
      drawImage: (image: unknown) => {
        if (image instanceof StubCanvas) this.color = image.color;
      },
      getImageData: (_x: number, _y: number, width: number, height: number) => {
        const data = new Uint8ClampedArray(width * height * 4);
        for (let at = 0; at < data.length; at += 4) {
          data.set([...this.color, 255], at);
        }
        return { data };
      },
      createRadialGradient: () => ({ addColorStop: () => {} }),
    };
    return new Proxy(state, {
      get: (target, key) => (key in target ? target[key] : () => {}),
      set: (target, key, value) => {
        target[key] = value;
        return true;
      },
    });
  }
}

/** A {@link StubCanvas} that reads back as `color` (0–255 per channel). */
export function stubCanvasOf(
  color: readonly [number, number, number],
): StubCanvas {
  return Object.assign(new StubCanvas(), { color });
}

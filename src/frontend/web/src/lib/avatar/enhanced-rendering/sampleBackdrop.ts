import { averageOpaqueColor, type Rgb } from "./backdropGlow";

/** Images are averaged at this size; the glow needs only the overall tint. */
const SAMPLE_SIZE = 16;
/** Sampled images kept (oldest dropped first) for revisited backdrops. */
const MAX_CACHED_IMAGES = 32;

const imageColors = new Map<string, Promise<Rgb | null>>();

function sampleContext(): CanvasRenderingContext2D | null {
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  return canvas.getContext("2d", { willReadFrequently: true });
}

async function averageImageColor(src: string): Promise<Rgb | null> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = src;
  await image.decode();
  const context = sampleContext();
  if (!context) return null;
  context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  return averageOpaqueColor(
    context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data,
  );
}

/**
 * The average colour of the image at `src`, or null when it cannot be loaded
 * or read (for example a cross-origin image without CORS).
 */
export function sampleImageColor(src: string): Promise<Rgb | null> {
  const cached = imageColors.get(src);
  if (cached) return cached;
  const color = averageImageColor(src).catch(() => {
    // Not cached, so a later visit can retry a transient load failure.
    if (imageColors.get(src) === color) imageColors.delete(src);
    return null;
  });
  imageColors.set(src, color);
  if (imageColors.size > MAX_CACHED_IMAGES) {
    const oldest = imageColors.keys().next().value;
    if (oldest !== undefined) imageColors.delete(oldest);
  }
  return color;
}

/** Any CSS colour the canvas understands (including oklch), as opaque sRGB. */
export function cssColorToRgb(cssColor: string): Rgb | null {
  const context = sampleContext();
  if (!context) return null;
  context.fillStyle = cssColor;
  context.fillRect(0, 0, 1, 1);
  return averageOpaqueColor(context.getImageData(0, 0, 1, 1).data);
}

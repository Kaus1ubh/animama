import { assertAvatarEffectImageDimensions } from "./effect-image-limits";

const pendingEffectImages = new Map<string, Promise<CanvasImageSource>>();

/** Share only pending loads; completed images belong to the active effects. */
export async function loadEffectImage(
  assetPath: string,
): Promise<CanvasImageSource> {
  const pending = pendingEffectImages.get(assetPath);
  if (pending) {
    return pending;
  }

  const image = new Image();
  const task = new Promise<CanvasImageSource>((resolve, reject) => {
    image.decoding = "async";
    image.onload = () => {
      // Decoded size is checked before any canvas or GPU upload uses it.
      if (typeof image.naturalWidth === "number") {
        try {
          assertAvatarEffectImageDimensions({
            width: image.naturalWidth,
            height: image.naturalHeight,
          });
        } catch {
          reject(
            new Error(`VFX asset "${assetPath}" exceeds the image size limit.`),
          );
          return;
        }
      }
      resolve(image);
    };
    image.onerror = () =>
      reject(new Error(`Failed to load VFX asset "${assetPath}".`));
    image.src = assetPath;
  }).finally(() => {
    // Blob URLs change with each preview/catalog. Retaining settled promises
    // would pin their decoded images even after the URL owner revokes them.
    pendingEffectImages.delete(assetPath);
    image.onload = null;
    image.onerror = null;
  });

  pendingEffectImages.set(assetPath, task);
  return task;
}

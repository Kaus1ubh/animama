/** Resolve glTF's relative dependencies only to verified mount Blobs. */
export function preparedModelUrlResolver(
  modelUrl: string,
  resourceUrls: Readonly<Record<string, string>>,
): (url: string) => string {
  const base = modelUrl.slice(0, modelUrl.lastIndexOf("/") + 1);
  const resources = new Map<string, string>();
  for (const [name, url] of Object.entries(resourceUrls)) {
    if (!url.startsWith("blob:"))
      throw new Error("Model dependencies must be verified Blob resources.");
    resources.set(name, url);
    resources.set(`${base}${name}`, url);
    resources.set(`${base}${encodeURI(name)}`, url);
  }
  return (url) => {
    const prepared = resources.get(url);
    if (prepared) return prepared;
    // Embedded buffers/images and glTF's own temporary Blob URLs are already
    // inside the verified model; never fall back to an HTTP texture/buffer.
    if (url === modelUrl || url.startsWith("data:") || url.startsWith("blob:"))
      return url;
    throw new Error(
      "The model referenced a resource outside its verified closure.",
    );
  };
}

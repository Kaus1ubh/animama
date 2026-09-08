/** Advisory browser checks prevent provisional VRMs from fetching external resources. */
export async function checkCreationVrm(
  file: File,
  maxBytes = 100 * 1024 * 1024,
): Promise<void> {
  if (!/\.vrm$/i.test(file.name) || file.size < 20 || file.size > maxBytes)
    throw new Error(
      `Choose a self-contained .vrm file up to ${Math.floor(maxBytes / 1024 / 1024)} MiB.`,
    );
  const header = new DataView(await file.slice(0, 20).arrayBuffer());
  if (
    header.getUint32(0, true) !== 0x46546c67 ||
    header.getUint32(4, true) !== 2 ||
    header.getUint32(8, true) !== file.size ||
    header.getUint32(16, true) !== 0x4e4f534a
  )
    throw new Error("This is not a binary VRM/GLB file.");
  const length = header.getUint32(12, true);
  if (length > 16 * 1024 * 1024 || length + 20 > file.size)
    throw new Error("The VRM document exceeds the supported limit.");
  let document: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(
      await file.slice(20, 20 + length).text(),
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
    document = parsed as Record<string, unknown>;
  } catch {
    throw new Error("This file does not contain a valid VRM document.");
  }
  const extensions =
    document.extensions && typeof document.extensions === "object"
      ? (document.extensions as Record<string, unknown>)
      : {};
  const vrm1 =
    extensions.VRMC_vrm && typeof extensions.VRMC_vrm === "object"
      ? (extensions.VRMC_vrm as Record<string, unknown>)
      : null;
  const vrm0 =
    extensions.VRM && typeof extensions.VRM === "object"
      ? (extensions.VRM as Record<string, unknown>)
      : null;
  const version = vrm1?.specVersion ?? vrm0?.specVersion;
  if (version !== "1.0" && version !== "0.0")
    throw new Error("Choose a VRM 0.x (0.0) or VRM 1.0 model.");
  const resources = [document.buffers, document.images].flatMap((value) =>
    Array.isArray(value) ? value : [],
  );
  for (const item of resources) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as Record<string, unknown>).uri === "string" &&
      !(item as Record<string, string>).uri.startsWith("data:")
    )
      throw new Error(
        "External model resources are not allowed. Export a self-contained VRM.",
      );
  }
}

/**
 * The sha256 of a review page's Avatar file. The app passes the catalog's
 * digest to `Avatar.load`, which selects verified per-Avatar calibrations such
 * as the eyelid closure profile; review renders pass the same digest so they
 * match chat and the creators.
 */
export async function avatarFileSha256(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Cannot read the Avatar file ${url}: ${response.status}`);
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await response.arrayBuffer(),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

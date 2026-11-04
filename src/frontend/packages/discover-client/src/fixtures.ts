/**
 * Construct an inert GET request for public contract fixtures, without fetching.
 * The supplied path belongs to a test fixture, not an implemented Discover API.
 */
export function createDiscoverContractFixtureRequest(
  serviceOrigin: string,
  fixturePath: string,
): Request {
  const origin = new URL(serviceOrigin);
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new Error(
      "Fixture service must be an HTTP(S) origin without credentials or a path.",
    );
  }
  if (
    !fixturePath.startsWith("/") ||
    fixturePath.startsWith("//") ||
    fixturePath.includes("\\")
  ) {
    throw new Error(
      "Fixture paths must be relative to the configured service origin.",
    );
  }
  const url = new URL(fixturePath, origin);
  if (
    url.origin !== origin.origin ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error(
      "Fixture paths cannot change origin or contain credentials/fragments.",
    );
  }
  return new Request(url, {
    method: "GET",
    credentials: "omit",
    redirect: "error",
  });
}

import { spawn } from "node:child_process";

/**
 * Request helpers shared by the owner's local review pages
 * (`animation-preview.mjs`, `content-tune.mjs`, `landing-stage.mjs`): Vite
 * servers on 127.0.0.1 with a small JSON API. Keeping the origin check in one
 * place keeps every page equally strict.
 */

/**
 * Whether a request comes from the page itself: the exact local origin as
 * Host (no DNS rebinding), our Origin on every write, and no other site's
 * fetch metadata on a read (a cross-site `<audio>` or `<img>` sends none
 * of Origin).
 */
export function trustedRequest(request, origin) {
  if (`http://${request.headers.host ?? ""}` !== origin) return false;
  const site = request.headers["sec-fetch-site"];
  if (site !== undefined && site !== "same-origin" && site !== "none")
    return false;
  const requestOrigin = request.headers.origin;
  // Browsers send Origin on cross-origin GETs; writes must always carry ours.
  return requestOrigin === undefined
    ? request.method === "GET"
    : requestOrigin === origin;
}

export function sendJson(response, status, value) {
  if (response.headersSent) return;
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

/** Answer with `action()`'s value, or a 400 naming its error. */
export async function respond(response, action) {
  try {
    sendJson(response, 200, await action());
  } catch (error) {
    sendJson(response, 400, { error: error.message });
  }
}

/** A request's JSON body, refused over `maxBytes`. */
export function readJsonBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("Request body too large."));
        request.destroy();
      } else chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Expected a JSON body."));
      }
    });
    request.on("error", reject);
  });
}

/** Open the URL in the system's default (non-headless) browser. */
export function openBrowser(url) {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () =>
    console.log(`Could not open a browser; open ${url} yourself.`),
  );
  child.unref();
}

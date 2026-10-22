import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { contentTypeFor, webRoot } from "./landing-stage-content.mjs";
import { openBrowser } from "./local-page-server.mjs";

/**
 * Serve a landing build (`pnpm -s landing:build`) as its host will: only the
 * built folder, with the headers its `_headers` file sets, on 127.0.0.1.
 *
 *   pnpm -s landing:preview [--port <n>] [--no-open] [--dir <build>]
 */

/**
 * The header rules in a Cloudflare `_headers` file: each unindented line is
 * a path (a trailing `*` matches any rest), followed by indented
 * `Name: value` lines. Every rule whose path matches applies.
 */
export function parseHeaders(text) {
  const rules = [];
  for (const line of text.split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) rules.push({ pattern: line.trim(), headers: {} });
    else {
      const at = line.indexOf(":");
      rules.at(-1).headers[line.slice(0, at).trim()] = line
        .slice(at + 1)
        .trim();
    }
  }
  return (pathname) =>
    Object.assign(
      {},
      ...rules
        .filter(({ pattern }) =>
          pattern.endsWith("*")
            ? pathname.startsWith(pattern.slice(0, -1))
            : pathname === pattern,
        )
        .map(({ headers }) => headers),
    );
}

/** Start serving `dir`. Resolves once it listens. */
export async function startLandingPreview({
  dir = path.join(webRoot, "dist-landing"),
  port = 0,
} = {}) {
  const root = path.resolve(dir);
  const headersFile = path.join(root, "_headers");
  if (!existsSync(path.join(root, "index.html")))
    throw new Error(`No landing build in ${root}; run pnpm -s landing:build.`);
  const headersFor = parseHeaders(
    existsSync(headersFile) ? readFileSync(headersFile, "utf8") : "",
  );
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      pathname = "";
    }
    const file = path.join(
      root,
      pathname.endsWith("/") ? `${pathname}index.html` : pathname,
    );
    const servable =
      (request.method === "GET" || request.method === "HEAD") &&
      file.startsWith(`${root}${path.sep}`) &&
      path.basename(file) !== "_headers" &&
      existsSync(file) &&
      statSync(file).isFile();
    const headers = headersFor(url.pathname);
    if (!servable) {
      response.writeHead(404, {
        ...headers,
        "content-type": "text/plain; charset=utf-8",
      });
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      ...headers,
      "content-type": contentTypeFor(file),
    });
    if (request.method === "HEAD") response.end();
    else
      createReadStream(file)
        .on("error", () => response.destroy())
        .pipe(response);
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const USAGE =
  "Usage: pnpm -s landing:preview [--port <n>] [--no-open] [--dir <build>]";

async function main(argv) {
  let port = 0;
  let open = true;
  let dir;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--no-open") open = false;
    else if (
      (argument === "--port" || argument === "--dir") &&
      argv[index + 1] &&
      !argv[index + 1].startsWith("--")
    ) {
      const value = argv[index + 1];
      if (argument === "--port") port = Number(value);
      else dir = path.resolve(value);
      index += 1;
    } else {
      console.log(USAGE);
      return argument === "--help" ? 0 : 2;
    }
  }
  if (!Number.isInteger(port) || port < 0) {
    console.log(USAGE);
    return 2;
  }
  const preview = await startLandingPreview({ dir, port });
  console.log(`Preview: ${preview.url}`);
  console.log("Press Ctrl+C to stop.");
  if (open) openBrowser(preview.url);
  await new Promise((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await preview.close();
  return 0;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  process.exit(await main(process.argv.slice(2)));
}

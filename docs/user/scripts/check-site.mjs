import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "parse5";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const origin = "https://docs.animama.ai";
const pages = new Set([
  "index.html",
  "desktop.html",
  "self-host.html",
  "troubleshooting.html",
  "404.html",
]);
const assetPatterns = [
  /^assets\/app\.[\w-]+\.js$/,
  /^assets\/style\.[\w-]+\.css$/,
  /^assets\/chunks\/(framework|theme)\.[\w-]+\.js$/,
  /^assets\/(index|desktop|self-host|troubleshooting)\.md\.[\w-]+\.(lean\.)?js$/,
  /^assets\/inter-(roman|italic)-(latin|greek|cyrillic|vietnamese)(-ext)?\.[\w-]+\.woff2$/,
];

function inventory(directory, prefix = "") {
  return readdirSync(directory).flatMap((name) => {
    const relative = prefix + name;
    const path = join(directory, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink())
      throw new Error(`Symlink in output: ${relative}`);
    if (stat.isDirectory()) return inventory(path, `${relative}/`);
    if (
      !stat.isFile() ||
      !(
        pages.has(relative) ||
        ["hashmap.json", "vp-icons.css"].includes(relative) ||
        assetPatterns.some((pattern) => pattern.test(relative))
      )
    ) {
      throw new Error(`Unexpected publication file: ${relative}`);
    }
    return [relative];
  });
}

function walk(node, visit) {
  visit(node);
  for (const child of node.childNodes ?? []) walk(child, visit);
  if (node.content) walk(node.content, visit);
}

function textContent(node) {
  if (node.nodeName === "#text") return node.value;
  return (node.childNodes ?? []).map(textContent).join("");
}

function pagePath(pathname, files) {
  const relative = decodeURIComponent(pathname).replace(/^\//, "");
  if (!relative || relative.endsWith("/")) return `${relative}index.html`;
  return files.has(relative) ? relative : `${relative}.html`;
}

/** Audit selected output and links locally; readiness is a reviewed assertion. */
export function checkSite(
  outputDirectory,
  destinations = JSON.parse(
    readFileSync(join(packageRoot, "site-links.json"), "utf8"),
  ),
) {
  if (
    !destinations ||
    Object.keys(destinations).sort().join(",") !== "download,home" ||
    typeof destinations.home !== "boolean" ||
    typeof destinations.download !== "boolean"
  ) {
    throw new Error(
      "Destination readiness must contain home/download booleans",
    );
  }
  const root = lstatSync(outputDirectory);
  if (root.isSymbolicLink() || !root.isDirectory()) {
    throw new Error("Publication output must be an ordinary directory");
  }
  const files = new Set(inventory(outputDirectory));
  for (const page of pages) {
    if (!files.has(page)) throw new Error(`Missing reader page: ${page}`);
  }

  // The generator's router map must never reveal pages outside this small site.
  if (files.has("hashmap.json")) {
    const hashes = JSON.parse(
      readFileSync(join(outputDirectory, "hashmap.json"), "utf8"),
    );
    const sourcePages = [
      "desktop.md",
      "index.md",
      "self-host.md",
      "troubleshooting.md",
    ];
    if (Object.keys(hashes).sort().join(",") !== sourcePages.join(",")) {
      throw new Error("Unexpected publication file in router map");
    }
    for (const [page, hash] of Object.entries(hashes)) {
      for (const suffix of ["js", "lean.js"]) {
        if (!files.has(`assets/${page}.${hash}.${suffix}`)) {
          throw new Error(`Broken router asset: ${page}`);
        }
      }
    }
  }

  const documents = new Map();
  for (const page of pages) {
    const tree = parse(readFileSync(join(outputDirectory, page), "utf8"));
    const ids = new Set();
    walk(tree, (node) => {
      const id = node.attrs?.find((attr) => attr.name === "id");
      if (id) ids.add(id.value);
    });
    documents.set(page, { tree, ids });
  }

  let links = 0;
  for (const [page, { tree }] of documents) {
    const base = new URL(`/${page === "index.html" ? "" : page}`, origin);
    walk(tree, (node) => {
      for (const attr of node.attrs ?? []) {
        if (!["href", "src"].includes(attr.name)) continue;
        const navigation = node.tagName === "a" && attr.name === "href";
        if (navigation && /coming soon/i.test(textContent(node))) {
          throw new Error(`Coming soon has an active link in ${page}`);
        }
        const url = new URL(attr.value, base);
        if (!["https:", "http:"].includes(url.protocol)) {
          throw new Error(`Unsupported link scheme in ${page}: ${attr.value}`);
        }
        if (url.origin !== origin) {
          if (!navigation) {
            throw new Error(`External runtime asset in ${page}: ${attr.value}`);
          }
          const allowed =
            (destinations.home && url.href === "https://animama.ai/") ||
            (destinations.download &&
              url.href === "https://animama.ai/download");
          if (!allowed) {
            throw new Error(
              `Unverified external destination in ${page}: ${attr.value}`,
            );
          }
        } else {
          const target = pagePath(url.pathname, files);
          if (
            !files.has(target) ||
            (url.hash &&
              !documents
                .get(target)
                ?.ids.has(decodeURIComponent(url.hash.slice(1))))
          ) {
            throw new Error(`Broken internal link in ${page}: ${attr.value}`);
          }
        }
        links++;
      }
    });
  }
  return { pages: documents.size, files: files.size, links };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    console.log(
      JSON.stringify(checkSite(join(packageRoot, ".vitepress/dist"))),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

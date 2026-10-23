import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, createServer } from "vite";

import { javascriptLicenses } from "../../desktop/scripts/runtime/licenses.mjs";
import {
  MEDIA_ROUTE,
  pagePlugin,
  programPlugin,
  renderPageHtml,
  resolveStageProgram,
  siteIcons,
  stageDir,
  stageViteConfig,
  webRoot,
} from "./landing-stage-content.mjs";

/**
 * Production build of the landing page: a static site Animama Cloud deploys.
 *
 *   pnpm -s landing:build [--out <dir>]
 *
 * Writes `web/dist-landing/` (or `--out`): the page and its minified bundle
 * without source maps; the content its stops play, with the clips and effect
 * definitions bundled into the JavaScript and their files (textures, Avatars,
 * portraits) copied under content-hashed names; the emotion mascots and
 * brand marks; the page's `static/` files (including the `_headers` the host
 * applies); icons, `robots.txt`, `sitemap.xml` and `notices.txt`. Nothing in
 * it calls the stage server. The build fails if a source does not resolve or
 * the output holds a local path or a source map.
 */
const frontendRoot = path.resolve(webRoot, "..");
const repoRoot = path.resolve(frontendRoot, "../..");
const CONTENT = "assets/content";

/** Build the site into `outDir`; resolves to the list of written files. */
export async function buildLanding({
  outDir = path.join(webRoot, "dist-landing"),
} = {}) {
  // The build empties `outDir` first: refuse any folder that holds the
  // source, the repository or the home folder, and any other folder with
  // files in it unless it is a previous build.
  for (const kept of [webRoot, repoRoot, homedir()]) {
    const relative = path.relative(path.resolve(outDir), kept);
    if (!relative.startsWith("..") && !path.isAbsolute(relative))
      throw new Error(`Refusing to build into ${outDir}: it contains ${kept}.`);
  }
  const previousBuild = ["index.html", "_headers"].every((name) =>
    existsSync(path.join(outDir, name)),
  );
  if (existsSync(outDir) && readdirSync(outDir).length > 0 && !previousBuild)
    throw new Error(
      `Refusing to build into ${outDir}: it has files and is not a landing build.`,
    );
  // What the stops play and the page's text, through a server that never
  // listens (it only loads the app's modules).
  const server = await createServer({
    ...stageViteConfig(),
    appType: "custom",
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  let content;
  let page;
  let site;
  try {
    content = await resolveStageProgram(server);
    page = await renderPageHtml(server);
    site = await server.ssrLoadModule("/scripts/landing-stage/stops.ts");
  } finally {
    await server.close();
  }
  if (site.CLOSED_BETA && site.BETA_ACCESS_URL.includes("REPLACE"))
    console.warn(
      `Warning: BETA_ACCESS_URL in stops.ts is still a placeholder (${site.BETA_ACCESS_URL}).`,
    );
  if (content.program.problems.length)
    throw new Error(
      `Unresolved landing content:\n  ${content.program.problems.join("\n  ")}`,
    );

  const { program, copies } = publishProgram(content);
  let moduleIds = [];
  // The content server set development mode for this process; the bundle
  // must use React's production build and JSX transform.
  process.env.NODE_ENV = "production";
  await build({
    ...stageViteConfig({ root: stageDir }),
    mode: "production",
    // The page's own `static/` files; the rest are copied below, only those
    // the page uses.
    publicDir: path.join(stageDir, "static"),
    base: "/",
    logLevel: "warn",
    build: {
      outDir,
      emptyOutDir: true,
      sourcemap: false,
      // Small fonts and images stay files: the CSP admits no `data:` fonts.
      assetsInlineLimit: 0,
      reportCompressedSize: false,
      // three.js and the Avatar runtime make one large chunk by design.
      chunkSizeWarningLimit: 4096,
    },
    plugins: [
      programPlugin(() => program),
      pagePlugin(() => page),
      {
        name: "animama-landing-modules",
        generateBundle() {
          moduleIds = [...this.getModuleIds()];
        },
      },
    ],
  });

  const write = (relative, data) => {
    const target = path.join(outDir, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, data);
  };
  const copy = (from, relative) => {
    const target = path.join(outDir, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(from, target);
  };
  for (const [relative, from] of copies) copy(from, relative);
  for (const folder of ["emotions", "brand"])
    for (const name of readdirSync(path.join(webRoot, "public", folder)))
      if (/\.(webp|png)$/.test(name))
        copy(path.join(webRoot, "public", folder, name), `${folder}/${name}`);
  for (const [name, data] of await siteIcons()) write(name, data);
  write(
    "robots.txt",
    `User-agent: *\nAllow: /\n\nSitemap: ${new URL("sitemap.xml", site.SITE.url)}\n`,
  );
  write(
    "sitemap.xml",
    [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
      `  <url><loc>${site.SITE.url}</loc></url>`,
      `</urlset>`,
      "",
    ].join("\n"),
  );
  write(
    site.SITE.notices.replace(/^\//, ""),
    noticesText({ site, moduleIds, published: [...copies.values()] }),
  );
  return checkOutput(outDir);
}

/**
 * The program with every URL swapped for a published path, and the files to
 * copy there. Each effect folder keeps its layout under a hash of its
 * contents, since a particle manifest names its textures relative to itself;
 * Avatars, portraits and entrance clips get hashed file names.
 */
function publishProgram({
  program,
  files,
  avatarFiles,
  portraitFiles,
  walkFiles,
}) {
  const copies = new Map();
  const hashOf = (...parts) => {
    const hash = createHash("sha256");
    for (const part of parts) hash.update(part);
    return hash.digest("hex").slice(0, 12);
  };
  const publishFile = (file) => {
    const ext = file.endsWith(".clip.json") ? ".clip.json" : path.extname(file);
    const base = path.basename(file, ext).replace(/[^\w.-]/g, "-");
    const relative = `${CONTENT}/${base}-${hashOf(readFileSync(file))}${ext}`;
    copies.set(relative, file);
    return `/${relative}`;
  };
  const folders = new Map();
  for (const { token, folder, files: names } of files.registered()) {
    const sorted = [...names].sort();
    const hash = hashOf(
      ...sorted.flatMap((name) => [
        name,
        readFileSync(path.join(folder, name)),
      ]),
    );
    for (const name of sorted)
      copies.set(`${CONTENT}/${hash}/${name}`, path.join(folder, name));
    folders.set(token, hash);
  }
  const rewrite = (value) => {
    if (typeof value === "string") {
      if (!value.startsWith(MEDIA_ROUTE)) return value;
      const [token, ...rest] = value
        .slice(MEDIA_ROUTE.length)
        .split("?")[0]
        .split("/");
      const hash = folders.get(token);
      if (!hash) throw new Error(`Unregistered landing file: ${value}`);
      return `/${CONTENT}/${hash}/${rest.join("/")}`;
    }
    if (Array.isArray(value)) return value.map(rewrite);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, rewrite(item)]),
      );
    return value;
  };
  return {
    copies,
    program: {
      ...program,
      avatars: program.avatars.map(({ id }) => ({
        id,
        url: publishFile(avatarFiles.get(id)),
      })),
      portraits: Object.fromEntries(
        [...portraitFiles].map(([id, file]) => [id, publishFile(file)]),
      ),
      walk: Object.fromEntries(
        [...walkFiles].map(([name, file]) => [name, publishFile(file)]),
      ),
      sources: rewrite(program.sources),
    },
  };
}

/**
 * `notices.txt`: the page's copyright, its Avatars' credits and terms, the
 * notices for any third-party artwork among its files, and the licence of
 * every npm package with code or fonts in the bundle.
 */
function noticesText({ site, moduleIds, published }) {
  const sections = [
    `Animama landing page — third-party notices\n\n${site.SITE.copyright}`,
  ];

  const review = JSON.parse(
    readFileSync(
      path.join(repoRoot, "licenses/third-party/art-vroid-review.json"),
      "utf8",
    ),
  );
  const avatars = site.STAGE_AVATARS.map(({ id, name }) => {
    const entry = review.files.find(
      (file) => file.path === `content/included/avatars/${id}.vrm`,
    );
    if (!entry) throw new Error(`No licence review for Avatar ${id}.`);
    const meta = entry.embedded_vrm_meta ?? {};
    return [
      `${name} (${id}.vrm)`,
      `  Copyright: ${entry.copyright.join(", ")}`,
      `  Licence: ${entry.license}${meta.otherLicenseUrl ? ` (${meta.otherLicenseUrl})` : ""}`,
      `  Redistribution: ${meta.allowRedistribution ? "allowed" : "not allowed"}`,
    ].join("\n");
  });
  sections.push(`Avatars\n\n${avatars.join("\n\n")}`);

  // Third-party particle artwork, if any shipped file is one.
  const art = JSON.parse(
    readFileSync(
      path.join(repoRoot, "licenses/third-party/art-particles.json"),
      "utf8",
    ),
  );
  const artHashes = new Set(art.files.map(({ sha256 }) => sha256));
  const usesArt = published.some((file) =>
    artHashes.has(
      createHash("sha256").update(readFileSync(file)).digest("hex"),
    ),
  );
  sections.push(
    usesArt
      ? readFileSync(
          path.join(repoRoot, "licenses/third-party/art-NOTICES.md"),
          "utf8",
        )
      : "Artwork\n\nNo third-party artwork is included.",
  );

  // npm packages with modules in the bundle, by the last `node_modules/` in
  // each module id (Vite's own helpers come from the `vite` package).
  const used = new Set();
  for (const id of moduleIds) {
    if (id.startsWith("\0vite/")) used.add("vite");
    const at = id.lastIndexOf("node_modules/");
    if (at < 0) continue;
    const parts = id.slice(at + "node_modules/".length).split("/");
    used.add(parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0]);
  }
  used.delete(".pnpm");
  const { records } = javascriptLicenses(frontendRoot, ["web"]);
  const require = createRequire(path.join(webRoot, "package.json"));
  const packages = [...used].sort().map((name) => {
    const record = records.find((candidate) => candidate.name === name);
    if (record) return record;
    // Not a runtime dependency of the app (such as Vite's preload helper).
    const folder = path.dirname(require.resolve(`${name}/package.json`));
    const pkg = JSON.parse(readFileSync(path.join(folder, "package.json")));
    const notice = readdirSync(folder).find((file) =>
      /^licen[cs]e/i.test(file),
    );
    return {
      id: `npm:${pkg.name}@${pkg.version}`,
      license: pkg.license,
      notices: notice
        ? [
            {
              path: notice,
              text: readFileSync(path.join(folder, notice), "utf8"),
            },
          ]
        : [],
    };
  });
  for (const record of packages) {
    if (!record.license || record.license === "NOASSERTION")
      throw new Error(`No licence found for bundled package ${record.id}.`);
    sections.push(
      [
        `${record.id.replace(/^npm:/, "")} — ${record.license}`,
        ...record.notices.map(({ text }) => text.trim()),
      ].join("\n\n"),
    );
  }
  return `${sections.join(`\n\n${"=".repeat(72)}\n\n`)}\n`;
}

/**
 * Refuse output that would leak this machine's layout or the source, or need
 * the stage server: no source maps, and no absolute local path or stage
 * server route in any text file. Resolves to the
 * written files, relative to `outDir`.
 */
function checkOutput(outDir) {
  const written = [];
  const visit = (relative) => {
    for (const entry of readdirSync(path.join(outDir, relative), {
      withFileTypes: true,
    })) {
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) visit(name);
      else written.push(name);
    }
  };
  visit("");
  const problems = [];
  for (const name of written) {
    if (name.endsWith(".map")) problems.push(`source map ${name}`);
    if (!/\.(html|js|css|json|txt|xml)$/.test(name) && name !== "_headers")
      continue;
    const text = readFileSync(path.join(outDir, name), "utf8");
    for (const root of [repoRoot, homedir()])
      if (text.includes(root)) problems.push(`local path in ${name}`);
    for (const route of [MEDIA_ROUTE, "/__stage/", "/@fs/"])
      if (text.includes(route)) problems.push(`stage server route in ${name}`);
  }
  if (problems.length)
    throw new Error(`Unsafe landing build:\n  ${problems.join("\n  ")}`);
  return written.sort();
}

async function main(argv) {
  let outDir;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index + 1];
    if (argv[index] === "--out" && value && !value.startsWith("--")) {
      outDir = path.resolve(value);
      index += 1;
    } else {
      console.log("Usage: pnpm -s landing:build [--out <dir>]");
      return argv[index] === "--help" ? 0 : 2;
    }
  }
  const written = await buildLanding({ outDir });
  console.log(`Built ${written.length} files.`);
  return 0;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  process.exit(await main(process.argv.slice(2)));
}

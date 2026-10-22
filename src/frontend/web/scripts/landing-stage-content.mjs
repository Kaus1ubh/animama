import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  MEDIA_ROUTE,
  PreviewMediaFiles,
  createPreviewMediaAdapter,
} from "./animation-preview-media.mjs";

/*
 * What the landing page plays, shared by its local stage server
 * (`landing-stage.mjs`) and its production build (`landing-build.mjs`): the
 * Vite settings both use, and the content its stops name, resolved through
 * the app's preview session into one "program" the page imports as
 * `virtual:landing-program`. The server's program points at its own routes;
 * the build swaps every URL for a copied, content-hashed file.
 */

export const webRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = path.resolve(webRoot, "../../..");
const includedDir = path.join(repoRoot, "content/included");
export const avatarDir = path.join(includedDir, "avatars");
const portraitDir = path.join(includedDir, "appearances/avatar-portraits");
/** The page's own folder: `index.html`, its modules and `static/` files. */
export const stageDir = path.join(webRoot, "scripts/landing-stage");
const PROGRAM_MODULE = "virtual:landing-program";
export { MEDIA_ROUTE };

/** Stage server routes for the program's own files. */
export const PORTRAIT_ROUTE = "/__stage/portrait/";
export const WALK_ROUTE = "/__stage/walk/";
/**
 * Entrance clips by plain file name, from the page's `clips/` folder and the
 * server's `--walk-clips`, and nothing else.
 */
const WALK_FILE = /^[\w.-]+\.(vrma|clip\.json)$/;
const BUNDLED_CLIPS = path.join(stageDir, "clips");
const PREVIEW_MODULES = "/src/lib/avatar/motion-authoring/preview";

/** Content types for the files the site serves, by extension. */
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".wasm": "application/wasm",
  ".vrm": "model/gltf-binary",
  ".vrma": "model/gltf-binary",
};

/** The content type to serve `file` as. */
export function contentTypeFor(file) {
  return (
    CONTENT_TYPES[path.extname(file).toLowerCase()] ??
    "application/octet-stream"
  );
}

/** Vite settings shared by the stage server and the production build. */
export function stageViteConfig({ root = webRoot } = {}) {
  return {
    configFile: false,
    root,
    logLevel: "error",
    cacheDir: path.join(webRoot, "node_modules/.vite-landing-stage"),
    define: {
      __ANIMAMA_DEV_BUILD__: "false",
      __ANIMAMA_APP_VERSION__: '"landing-stage"',
    },
    resolve: {
      alias: {
        "@": path.join(webRoot, "src"),
        "@web": path.join(webRoot, "src"),
      },
    },
  };
}

/** Serves `getProgram()` to the page as `virtual:landing-program`. */
export function programPlugin(getProgram) {
  const resolved = `\0${PROGRAM_MODULE}`;
  return {
    name: "animama-landing-program",
    resolveId: (id) => (id === PROGRAM_MODULE ? resolved : null),
    load: (id) =>
      id === resolved
        ? `export default ${JSON.stringify(getProgram())};`
        : null,
  };
}

/**
 * Resolve every clip and effect the stops name, using a Vite server rooted at
 * the web app to load the app's preview modules. A source that fails to
 * resolve is listed in `program.problems` rather than stopping the stage.
 * Returns the program (with stage server URLs) and the files behind them.
 */
export async function resolveStageProgram(server, { walkClips = null } = {}) {
  const roots = { cwd: process.cwd(), included: includedDir, local: null };
  // Every folder stays registered: the build copies them all.
  const files = new PreviewMediaFiles({ maxFolders: Infinity });
  const media = createPreviewMediaAdapter({ files });
  const { PreviewSession } = await server.ssrLoadModule(
    `${PREVIEW_MODULES}/previewSession.ts`,
  );
  const { STAGE_AVATARS, stageSources } = await server.ssrLoadModule(
    "/scripts/landing-stage/stops.ts",
  );

  const program = {
    avatars: [],
    portraits: {},
    sources: {},
    problems: [],
    walk: {},
  };
  // Entrance clips by file name: the bundled ones, then `--walk-clips`
  // (which wins on a shared name).
  const walkFiles = new Map();
  for (const folder of [BUNDLED_CLIPS, walkClips].filter(Boolean)) {
    try {
      for (const name of readdirSync(folder).filter((n) => WALK_FILE.test(n)))
        walkFiles.set(name, path.join(folder, name));
    } catch (error) {
      program.problems.push(`walk clips: ${error.message}`);
    }
  }
  program.walk = Object.fromEntries(
    [...walkFiles.keys()].map((name) => [name, `${WALK_ROUTE}${name}`]),
  );
  const avatarFiles = new Map(
    STAGE_AVATARS.map(({ id }) => [id, path.join(avatarDir, `${id}.vrm`)]),
  );
  program.avatars = [...avatarFiles].map(([id, file]) => ({
    id,
    url: `/@fs${file}`,
  }));
  const portraitFiles = new Map(
    STAGE_AVATARS.map(({ id, portrait }) => [
      id,
      path.join(portraitDir, portrait),
    ]),
  );
  program.portraits = Object.fromEntries(
    [...portraitFiles.keys()].map((id) => [id, `${PORTRAIT_ROUTE}${id}`]),
  );
  for (const spec of stageSources()) {
    try {
      const session = await PreviewSession.open({
        sources: [spec],
        roots,
        media,
      });
      const [row] = session.state().rows;
      if (row.error) program.problems.push(`${spec}: ${row.error.message}`);
      else
        program.sources[spec] = {
          clip: row.clip,
          effect: row.effect,
          media: row.media,
        };
    } catch (error) {
      program.problems.push(`${spec}: ${error.message}`);
    }
  }
  return { program, files, walkFiles, avatarFiles, portraitFiles };
}

// ── Page HTML ──────────────────────────────────────────────────────────────

const ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const escapeHtml = (text) => text.replace(/[&<>"']/g, (char) => ESCAPES[char]);

/** Theme colours for the browser's chrome (the app's `--background`). */
const THEME_COLORS = { light: "#faf9f5", dark: "#1a1d23" };

/**
 * The site's icons, made from the brand mark: a 32px favicon (as both
 * `favicon.ico` and PNG), a 192px icon and a 180px Apple touch icon on the
 * page's cream (iOS fills transparency with black).
 */
export async function siteIcons() {
  const { default: sharp } = await import("sharp");
  const mark = path.join(webRoot, "public/brand/animama-mark.png");
  const png = (size) =>
    sharp(mark)
      .resize(size, size, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
  const favicon = await png(32);
  const touch = await sharp(await png(144))
    .extend({
      top: 18,
      bottom: 18,
      left: 18,
      right: 18,
      background: THEME_COLORS.light,
    })
    .flatten({ background: THEME_COLORS.light })
    .png()
    .toBuffer();
  return new Map([
    ["favicon.ico", icoFrom(favicon, 32)],
    ["favicon-32x32.png", favicon],
    ["icon-192.png", await png(192)],
    ["apple-touch-icon.png", touch],
  ]);
}

/** An ICO file holding one PNG image (supported by every current browser). */
function icoFrom(png, size) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // icon
  header.writeUInt16LE(1, 4); // one image
  header.writeUInt8(size, 6);
  header.writeUInt8(size, 7);
  header.writeUInt16LE(1, 10); // colour planes
  header.writeUInt16LE(32, 12); // bits per pixel
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18); // offset of the image data
  return Buffer.concat([header, png]);
}

/**
 * The page's `<head>` additions and its text for `#overlay`, from `stops.ts`:
 * title, description, canonical URL, sharing tags, icons, theme colours and
 * schema.org data; then the header links, each stop's heading, line and
 * links, the scene's description and the copyright line. The overlay
 * replaces the text when it mounts; until then (and without JavaScript)
 * search engines, link previews and readers have it.
 */
export async function renderPageHtml(server) {
  const {
    STAGE_STOPS,
    STAGE_AVATARS,
    SITE,
    CLOSED_BETA,
    BETA_ACCESS_URL,
    voice,
  } = await server.ssrLoadModule("/scripts/landing-stage/stops.ts");
  const avatar = STAGE_AVATARS[0];
  const text = (value) =>
    escapeHtml(voice(value ?? "", avatar).replaceAll("**", ""));
  const [hero, ...stops] = STAGE_STOPS;
  const last = STAGE_STOPS.at(-1);
  const description = `${voice(hero.body, avatar)} ${voice(last.body ?? "", avatar)}`;
  const image = new URL(SITE.shareImage, SITE.url).href;
  const logo = new URL("brand/animama-mark.png", SITE.url).href;
  const action = CLOSED_BETA
    ? { label: "Request Beta Access", href: BETA_ACCESS_URL }
    : { label: "Download", href: `#stop-${last.id}` };
  const link = ({ label, href }) =>
    `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;

  const structured = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE.url}#organization`,
        name: "Animama",
        url: SITE.url,
        logo,
      },
      {
        "@type": "SoftwareApplication",
        name: "Animama",
        description,
        url: SITE.url,
        applicationCategory: "LifestyleApplication",
        operatingSystem: "macOS, Windows",
        image,
        screenshot: image,
        publisher: { "@id": `${SITE.url}#organization` },
      },
    ],
  };
  const meta = (attribute, name, content) =>
    `<meta ${attribute}="${name}" content="${escapeHtml(content)}" />`;
  const head = [
    `<title>${escapeHtml(SITE.title)}</title>`,
    meta("name", "description", description),
    `<link rel="canonical" href="${SITE.url}" />`,
    `<meta name="theme-color" content="${THEME_COLORS.light}" media="(prefers-color-scheme: light)" />`,
    `<meta name="theme-color" content="${THEME_COLORS.dark}" media="(prefers-color-scheme: dark)" />`,
    `<link rel="icon" href="/favicon.ico" sizes="32x32" />`,
    `<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png" />`,
    `<link rel="apple-touch-icon" href="/apple-touch-icon.png" />`,
    meta("property", "og:type", "website"),
    meta("property", "og:site_name", "Animama"),
    meta("property", "og:url", SITE.url),
    meta("property", "og:title", SITE.title),
    meta("property", "og:description", description),
    meta("property", "og:image", image),
    meta("property", "og:image:width", "1200"),
    meta("property", "og:image:height", "630"),
    meta("property", "og:image:alt", SITE.shareImageAlt),
    meta("name", "twitter:card", "summary_large_image"),
    meta("name", "twitter:title", SITE.title),
    meta("name", "twitter:description", description),
    meta("name", "twitter:image", image),
    meta("name", "twitter:image:alt", SITE.shareImageAlt),
    // JSON, not code: the CSP does not apply to it. `<` is escaped so no
    // text can close the element.
    `<script type="application/ld+json">${JSON.stringify(structured).replace(/</g, "\\u003c")}</script>`,
  ].join("\n    ");

  // The hero's line, its feature words linking to their stops.
  let heroLine = text(hero.body);
  for (const { word, stop } of hero.links ?? [])
    heroLine = heroLine.replace(
      new RegExp(`\\b${word}\\b`),
      `<a href="#stop-${stop}">${word}</a>`,
    );
  const sections = stops.map((stop) => {
    const actions =
      stop.id === last.id
        ? `<p class="actions">${link(action)} ${link({ label: "Read the docs", href: SITE.docsUrl })}</p>`
        : "";
    return `<section id="stop-${stop.id}"><h2>${text(stop.title)}</h2><p>${text(stop.body)}</p>${actions}</section>`;
  });
  const content = [
    `<div class="prerender">`,
    `<header><p><a href="/">Animama</a></p><nav aria-label="Site">${[
      { label: "Home", href: `#stop-${hero.id}` },
      { label: "About", href: `#stop-${stops[0].id}` },
      { label: "Docs", href: SITE.docsUrl },
      action,
    ]
      .map(link)
      .join(" ")}</nav></header>`,
    `<main><section id="stop-${hero.id}"><h1>${text(hero.title)}</h1><p>${heroLine}</p><p class="scene">${text(SITE.sceneDescription)}</p></section>`,
    ...sections,
    `</main>`,
    `<footer><p>${escapeHtml(SITE.copyright)} ${link({ label: "Third-party notices", href: SITE.notices })}</p></footer>`,
    `</div>`,
  ].join("");
  return { head, content };
}

/** Fills `index.html`'s `<!--landing:head-->` and `<!--landing:content-->`. */
export function pagePlugin(getPage) {
  return {
    name: "animama-landing-page",
    transformIndexHtml(html) {
      const { head, content } = getPage();
      // Functions, so a `$` in the copy is not read as a pattern.
      return html
        .replace("<!--landing:head-->", () => head)
        .replace("<!--landing:content-->", () => content);
    },
  };
}

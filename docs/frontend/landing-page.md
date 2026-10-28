# Landing page

The animama.ai home page is a scroll-driven 3D page: one Included Avatar on a
full-viewport canvas, played through the app's own `Avatar` runtime, with a
React overlay built from the app's components and theme. Its source is
`src/frontend/web/scripts/landing-stage/`; Animama Cloud deploys its
production build.

## Commands

From `src/frontend/web`:

```bash
pnpm -s landing:stage --port 4310
pnpm -s landing:build
pnpm -s landing:preview --port 4320
```

- `landing:stage` is the development server. It resolves the page's content
  from the Library on start, serves the whole web app's source with hot
  reload, and reads files by local path. It listens on 127.0.0.1 only and
  must never be deployed.
- `landing:build` writes the public site to `web/dist-landing/`
  (`--out <dir>` for elsewhere), including the site header for Animama
  Cloud's pages (below). It fails if a clip or effect does not resolve, or if
  the output contains a source map or a local path.
- `landing:preview` serves only a build, applying its `_headers`, as the host
  will. Run the page there before a package set ships it.
- `landing:stills` recaptures the fallback's stills (below). It starts its
  own stage server and renders on the GPU.

Cloud receives the site only through the package set: `build.py build` runs
`landing:build` in the exact source snapshot and packs the output as the
format-3 `animama-landing-<version>.tar.gz` (see the
[hosted contract](../../contracts/hosted-web.md#landing-site-archive)). Its
verifier is stricter than the build's own check. It rejects any file type
missing from the archive's MIME table in `scripts/package-sets/landing_site.py`,
and it looks for a fixed list of local-path forms rather than this checkout's
paths, so a root-relative route such as `/home/` fails packaging. Pack a build
with `build.pack_site` to check it before relying on the package set.

## What the page shows

`stops.ts` holds the copy, camera stops, clips and site settings:

- `STAGE_STOPS`: each stop's title, line, camera, backdrop and clips.
- `CLOSED_BETA`: while on, the header offers one **Request Beta Access**
  button (the form at `BETA_ACCESS_URL`) instead of Download, Log in, Sign up
  and the language picker, and stops show their `beta` copy. Turn it off at
  launch to restore the rest.
- `SITE`: the canonical address, docs link, title, share image, copyright
  line, the 3D scene's description for screen readers, the contact address,
  the social links (Discord and YouTube icons, `social-icons.tsx`; also the
  schema.org `sameAs`), and the
  About, Privacy and Terms pages that Animama Cloud publishes on the same
  host. The header's About and the footer under the last stop
  (`FOOTER_LINKS`) link them; the development server does not serve the
  Cloud pages.

The page's text, title, description, sharing tags, icons and schema.org data
are generated from these settings into `index.html`
(`landing-stage-content.mjs`). The text sits visually hidden in `#overlay`
for search engines, link previews and readers without JavaScript; the React
overlay replaces it when it mounts.

`static/og-image.jpg` is the 1200×630 share image: a capture of the hero at
that size with `?nointro`, the header links and progress thread hidden.
Recapture it when the hero changes.

## Live stage and fallback

`main.ts` decides before anything heavy loads. Visitors get the live stage
(`stage.ts`) unless WebGL 2 is missing, runs only in software (no usable
graphics card), or their browser asks to save data. Those visitors get
`fallback.ts` instead and never download three.js or the Avatars: a still of
Annie at each stop (`stills/<stop>-<wide|tall>.webp`) where the canvas would
be, with the captions, notebook and mood bloom as usual. Reactions keep
cycling so the bloom changes; the gesture chips and Avatar switcher, which
need her live, are hidden. If the live stage cannot load her, it switches to
the same stills in place.

Recapture the stills with `pnpm -s landing:stills` after changing an Avatar,
a stop's camera or its clips. `?fallback` forces the fallback on the
development server.

On the live stage:

- The canvas resolution adapts (`quality.ts`): a two-second window averaging
  under about 45 fps steps it down (2×, 1.5×, 1.25×, 1×, 0.75×); eight
  seconds of smooth frames step it back up.
- If she has not loaded four seconds after the page opened, the hero's text
  shows at once and she walks on under it, as when a visitor clicks during
  the entrance.

## Content in the build

The build ships only what the stops play. Their clips and effect
definitions are bundled into the JavaScript; effect folders, the Avatars,
portraits and the entrance clip are copied under content-hashed paths in
`assets/content/`, so they can be cached for a year. Effect folders keep their
layout because particle manifests name their textures relative to
themselves. The emotion mascots and brand marks are copied from
`web/public`; nothing else from it is.

`notices.txt` lists the copyright, both Avatars' credits and terms (from
`licenses/third-party/art-vroid-review.json`), third-party artwork notices
when any shipped texture is third-party, and the licence of every npm package
with code or fonts in the bundle.

## The site header on Cloud's pages

Every page on animama.ai shows the same header: `site-header.tsx`. The
overlay renders it over the tour (`tour`: fixed, Home and Download scroll the
stops, the Avatar choice shows), and the build also makes it for the pages
Animama Cloud publishes on the same host (About, Download, Privacy, Terms and
404), where it sits at the top of the page and Home and Download are links:

- `site-chrome.tsx` is a separate Vite build, so it carries only the header's
  code (about 100 kB of compressed JavaScript, mostly React and the menus)
  rather than chunks shared with the stage. `site-chrome.css` holds the app's
  Tailwind setup and theme, light and dark, with the header's glass
  (`site-header.css`, which `stage.css` also imports).
- `site-chrome.json` names the entry script and its stylesheets and holds the
  header prerendered three times (`renderSiteHeaders`): marking About, then
  Download, as the current page, and for every other page. Cloud wraps the markup in each page's
  `#site-header`, so the header shows and its links work without JavaScript;
  the script renders the same component over it.
- Prerendered markup must not need inline `style` attributes, which the CSP
  refuses: the wordmark's mask is the `.wordmark-mask` class.
- The header imports nothing from product-ui's components bundle, which would
  bring its Markdown rendering along; its solid button copies product-ui's
  `Button` classes (`solidButton`).
- The saved theme is one key (`landing-stage-theme`) for the whole site;
  Cloud's pages load `theme.js` before paint as `index.html` does.

Changing the header's links or buttons (Request Beta Access, Log in, Sign up)
changes every page, through the next package set and Cloud repin. Cloud's own
build fails if a pinned site has no `site-chrome.json`.

## Security headers

`static/_headers` sets the CSP, `frame-ancestors 'none'`, nosniff, referrer
and permissions policies, HSTS and caching. The CSP admits only the site's
own scripts, styles, fonts and images, plus Cloudflare Web Analytics: the
host injects its beacon from `static.cloudflareinsights.com/beacon.min.js/`
into served HTML, and the beacon reports to the site's own `/cdn-cgi/rum`.
Neither the build nor the preview contains the beacon. Otherwise:

- `index.html` has no inline code; its pre-paint theme script is
  `static/theme.js` and its pre-paint styles are `static/boot.css`.
- Zod runs without compiling validators (`zod-config.ts`, imported first).
- Fonts are self-hosted through `@fontsource` packages, and the build inlines
  no assets as `data:` URLs.

After a change that adds a library, worker, font or external request, build,
preview and visit every stop with the browser console open; any CSP
violation is a failure. Loosen the CSP only for a reviewed need.

## Development switches

`?stop=<id>` opens at a stop and `?nointro` skips the entrance, in every
build. Only the development server honours `?hud`, `?walk=<id>` (with
`--walk-clips`), `?nopuzzle`, `?classic`, `?washes`, `?wave=small`,
`?fallback` and `window.landingStage.renderInfo()`; the production build
compiles them out.

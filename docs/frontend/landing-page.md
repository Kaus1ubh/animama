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
  (`--out <dir>` for elsewhere). It fails if a clip or effect does not
  resolve, or if the output contains a source map or a local path.
- `landing:preview` serves only a build, applying its `_headers`, as the host
  will. Run the page there before handing a build to Cloud.

## What the page shows

`stops.ts` holds the copy, camera stops, clips and site settings:

- `STAGE_STOPS`: each stop's title, line, camera, backdrop and clips.
- `CLOSED_BETA`: while on, the header offers one **Request Beta Access**
  button (the form at `BETA_ACCESS_URL`) instead of Download, Log in, Sign up
  and the language picker, and stops show their `beta` copy. Turn it off at
  launch to restore the rest.
- `SITE`: the canonical address, docs link, title, share image, copyright
  line and the 3D scene's description for screen readers.

The page's text, title, description, sharing tags, icons and schema.org data
are generated from these settings into `index.html`
(`landing-stage-content.mjs`). The text sits visually hidden in `#overlay`
for search engines, link previews and readers without JavaScript; the React
overlay replaces it when it mounts.

`static/og-image.jpg` is the 1200×630 share image: a capture of the hero at
that size with `?nointro`, the header links and progress thread hidden.
Recapture it when the hero changes.

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

## Security headers

`static/_headers` sets the CSP, `frame-ancestors 'none'`, nosniff, referrer
and permissions policies, HSTS and caching. The CSP admits only the site's
own scripts, styles, fonts and images, so:

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
`--walk-clips`), `?nopuzzle`, `?classic`, `?washes`, `?wave=small` and
`window.landingStage.renderInfo()`; the production build compiles them out.

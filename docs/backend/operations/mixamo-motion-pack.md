# Mixamo-motion pack

Desktop and hosted builds ship the pack's 29 Mixamo-derived Gestures and idle
loops, plus one Idle Style, as **non-portable** Included content once the tracked
manifest lists them (until then no build includes the pack)
([ADR 0015](../../adr/0015-non-portable-included-content.md),
[issue #242](https://github.com/raymond-van/animama/issues/242)). The files
never enter Git, Docker build contexts, self-host images or the public package
set. This guide covers the owner workflow and the checks that keep that true.

## What is tracked

| File | Purpose |
| --- | --- |
| `src/backend/animama/resources/mixamo-motion-manifest.json` | Public-safe manifest: pack version and every file's path, size and SHA-256. The backend restricts these hashes in every build. |
| `scripts/mixamo-motion/inventory.json` | Public-safe licence inventory copied into the staged pack. One `**` rule with `"distribution": "non-portable"`. |

Changing either file needs owner review. Neither contains an Adobe ID,
credentials, private paths or download URLs.

## Private inputs

The pack's files and its private provenance inventory live under one owner-only
prefix in a private R2 bucket (not the public desktop release bucket):
`<prefix>/<version>/<path>` and `<prefix>/<version>/private-inventory.json`.
The bucket must have no public access: no `r2.dev` URL and no custom domain.
Check this in the Cloudflare dashboard before the first upload and before each
release.

The private inventory, `{"clips": {"gestures/<id>": {…}}}`, has one record
per folder that holds a `.vrma` payload (the Included Idle Style needs none): `animation_name`, `animation_id`, `character`,
`export_settings`, `download_date`, `licensee`, `conversion_tool`,
`conversion_version`, `conversion_steps` and `sha256`, which must equal the
payload's manifest hash. It stays
in the private store and in the ignored `build-inputs/` directory, and is never
staged.

Keep credentials in an owner-only file, never in the repository or a worktree
`.env`, and export them only for these commands:

```text
ANIMAMA_R2_ACCOUNT_ID
ANIMAMA_MIXAMO_R2_BUCKET
ANIMAMA_MIXAMO_R2_PREFIX
ANIMAMA_MIXAMO_R2_READ_ACCESS_KEY_ID / ANIMAMA_MIXAMO_R2_READ_SECRET_ACCESS_KEY    (fetch)
ANIMAMA_MIXAMO_R2_WRITE_ACCESS_KEY_ID / ANIMAMA_MIXAMO_R2_WRITE_SECRET_ACCESS_KEY  (publish)
```

Scope the read token to read-only access, and both tokens to the bucket (and
prefix, where R2 supports it).

## Commands

From `src/frontend`:

```bash
pnpm desktop:mixamo-motion verify
pnpm desktop:mixamo-motion fetch
pnpm desktop:mixamo-motion publish --confirm
pnpm desktop:mixamo-motion scan --git
pnpm desktop:mixamo-motion scan <path-or-archive>...
pnpm desktop:mixamo-motion manifest <pack-dir> <version>
```

- `fetch` downloads into `build-inputs/mixamo-motion/` and
  `build-inputs/mixamo-motion.private.json`, verifies them, and only then
  replaces the previous input.
- `verify` requires an exact match (no missing, extra, changed or linked file)
  and a complete private record for every clip. Problems name paths only.
- `publish` uploads a verified input; without `--confirm` it is a dry run. A
  version is immutable: publishing refuses any object that already exists, so
  corrections need a new manifest version. The same applies after an
  interrupted publish: publish again under a new version; the partial objects
  stay unused.
- `manifest` prints a manifest for a locally assembled pack, for review before
  the tracked file changes. Assemble the pack without a `licenses/` directory
  (staging adds the tracked inventory), and run `scan --git` against the new
  manifest before committing it: every listed file becomes restricted
  everywhere, so no pack file may be byte-identical to a tracked file.

## Desktop staging

`pnpm desktop:runtime:stage` stages the pack as `runtime/content/mixamo-motion`
only from a verified `build-inputs/mixamo-motion/`, and adds the pack licence to
the redistribution inventory. Without the input it stages no pack. Release
candidates set `ANIMAMA_REQUIRE_MIXAMO_MOTION=1`, which fails a stage that lacks
the pack. The runtime manifest and audit cover the pack like other runtime files,
and the supervisor mounts it as the `mixamo-motion` Included source.
`desktop:release:scan` fails if pack bytes appear anywhere outside
`runtime/content/mixamo-motion`.

## Hosted deploy

Hosted Cloud consumes the same contract: it fetches the pack from the same
private prefix with read-only credentials, verifies it against the manifest in
the deployed backend package, and mounts it read-only as an Included source
(`ANIMAMA_INCLUDED_CONTENT_SOURCES_JSON` entry with `pack_id: "mixamo-motion"`)
beside `core`. Bytes are served only through the authenticated content file
routes, never from a public asset location. Cloud owns its deploy steps.

## Leak checks

Run `scan` on every public surface for a candidate. It hashes files and expands
zip, wheel and tar archives:

```bash
pnpm desktop:mixamo-motion scan --git
pnpm desktop:mixamo-motion scan <context.tar> <wheel> <npm tarballs>
pnpm desktop:mixamo-motion scan <exported self-host image tar> ../../content/included
```

Produce `<context.tar>` from the repository root with a throwaway build that
copies the whole context: `docker buildx build -f - --output
type=tar,dest=<context.tar> .` with the Dockerfile `FROM scratch` / `COPY . /`.
Export a self-host image with `docker create --name pack-scan <image>`,
`docker export -o <image.tar> pack-scan` and `docker rm pack-scan`. The scan
hashes only files whose size equals a pack file's, so large images stay cheap;
archives nested more than three levels deep are reported, not skipped.

The Docker build context listing honours `.dockerignore`, which excludes
`build-inputs/`. The self-host Compose stack bind-mounts `./content/included`
at runtime, so ignored files left there would be served: scan that directory
too.

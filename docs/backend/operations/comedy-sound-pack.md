# Comedy sound pack

Desktop and hosted builds give each built-in Avatar Effect a sound from WOW
Sound's Anime Comedy Sound Effects Pack, licensed by the owner under the Media
tier (formerly Rare). The sounds are a second **non-portable** private Included
source, `wow-comedy-sfx`, handled like the
[Mixamo-motion pack](mixamo-motion-pack.md): never in Git, Docker build contexts,
self-host images or the public package set. See
[ADR 0022](../../adr/0022-optional-licensed-effect-sounds.md) and
[issue #399](https://github.com/raymond-van/animama/issues/399).

## How effects use the sounds

Each built-in effect descriptor under `content/included/vfx/avatar/` declares
one optional sound edge and names it in `definition.soundAlias`:

```json
"dependencies": [
  {"ref": "builtin:sound-effect:funny_sweat_02", "content_type": "sound_effect",
   "alias": "on-apply", "optional": true}
]
```

Where the pack isn't mounted (self-host, public source, a desktop build without
the input), the Included scan drops that edge and the alias, and the effect plays
silently. Where several effects start together in a Reaction, only one plays its
sound; the others set `playAccompanyingSound: false` on their clip events.
`tests/test_included_content_integrity.py` enforces both rules.

Licensed sounds never appear in the Library or creator pickers, can't be used
by Local content, and are left out of exports.

## What is tracked

| File | Purpose |
| --- | --- |
| `src/backend/animama/resources/wow-comedy-sfx-manifest.json` | Public-safe manifest: pack version and each file's path, size and SHA-256. The backend restricts these hashes in every build. |
| `src/backend/animama/resources/wow-comedy-sfx-preview-deny.json` | Sizes and hashes of the vendor's watermarked preview files, restricted everywhere and allowed nowhere in a release. |
| `scripts/wow-comedy-sfx/inventory.json` | Public-safe licence inventory copied into the staged pack: one `**` rule with `"distribution": "non-portable"`. |

The pack layout is `sfx/wow-comedy/<key>.ogg` with a `<key>.meta.json` sidecar
(`builtin:sound-effect:<key>`, name, short description, `duration_seconds`).
Keys come from the vendor file name: `AC_Funny_Sweat_02.ogg` →
`funny_sweat_02`.

## Private inputs

The pack and its private provenance live in the same owner-only private bucket
as the Mixamo pack, under the prefix `built-in/wow-comedy-sfx` (override with
`ANIMAMA_WOW_COMEDY_SFX_R2_PREFIX`): `<prefix>/<version>/<path>` and
`<prefix>/<version>/private-inventory.json`. A separate prefix is required
because each version writes its own private inventory. The private inventory,
`{"sounds": {"sfx/wow-comedy/<key>.ogg": {…}}}`, needs `vendor`, `product`,
`license_tier`, `purchase_date`, `licensee`, `order_reference`, `source_file`
and `sha256` for every sound; it never enters Git.

The pack reuses the Mixamo pack's bucket-scoped credentials and owner-only env
files, so the release workflow needs no extra secrets: `ANIMAMA_R2_ACCOUNT_ID`,
`ANIMAMA_MIXAMO_R2_BUCKET` and the `ANIMAMA_MIXAMO_R2_READ_*` (fetch) or
`ANIMAMA_MIXAMO_R2_WRITE_*` (publish) token pair.

## Commands

From `src/frontend`, the shared private-pack tool takes the pack with `--pack`
(`pnpm desktop:mixamo-motion` remains an alias for the Mixamo pack):

```bash
pnpm desktop:private-pack --pack wow-comedy-sfx verify
pnpm desktop:private-pack --pack wow-comedy-sfx fetch
pnpm desktop:private-pack --pack wow-comedy-sfx publish --confirm
pnpm desktop:private-pack --pack wow-comedy-sfx scan --git
pnpm desktop:private-pack --pack wow-comedy-sfx scan <path-or-archive>...
pnpm desktop:private-pack --pack wow-comedy-sfx manifest <pack-dir> <version>
```

They behave as described in the [Mixamo-motion guide](mixamo-motion-pack.md#commands).
For this pack, `scan` also reports watermarked preview bytes. A published
version is immutable, so a new or changed sound means a new pack version and a
new tracked manifest.

### Adding or changing a sound

1. Copy the chosen vendor files into `build-inputs/wow-comedy-sfx/sfx/wow-comedy/`
   under their keys, with sidecars, and add each sound's record to
   `build-inputs/wow-comedy-sfx.private.json`.
2. Point the effect's optional edge at the new key.
3. Print a manifest with a new version, then run `scan --git`, `verify`,
   `publish --confirm` and commit the manifest with the descriptor change.
   Only sounds that built-in effects use belong in the pack.

## Desktop staging and release

`pnpm desktop:runtime:stage` stages the pack as `runtime/content/wow-comedy-sfx`
from a verified build input, and the supervisor mounts it. Release candidates set
`ANIMAMA_REQUIRE_WOW_COMEDY_SFX=1`. `desktop:release:scan` fails if pack bytes
appear outside `runtime/content/wow-comedy-sfx`, or preview bytes anywhere.

## Reviewing the pack on a task stack

To hear the sounds on a development stack, mount a staged copy (pack files plus
`licenses/inventory.json`) as a second Included source with an untracked Compose
override that sets `ANIMAMA_INCLUDED_CONTENT_SOURCES_JSON` on `animama-server`
(`core` first, then `wow-comedy-sfx` with `pack_id: "wow-comedy-sfx"`) and
bind-mounts the copy read-only. A stack that already scanned with a single
Included root needs its existing Included catalog rows tagged with the core
mount (`core@<version>`) before the first source-list scan; a fresh stack needs
nothing.

## Hosted deploy and leak checks

Hosted Cloud mounts the pack the same way as the Mixamo pack, with its own
`pack_id`; see the [Mixamo-motion guide](mixamo-motion-pack.md#hosted-deploy).
Run the [leak checks](mixamo-motion-pack.md#leak-checks) with
`--pack wow-comedy-sfx` on every public surface of a candidate.

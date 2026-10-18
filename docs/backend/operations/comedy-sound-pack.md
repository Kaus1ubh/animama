# Comedy sound pack

Desktop and hosted builds give built-in Avatar Effects, Gestures and Reactions
their sounds from WOW Sound's Anime Comedy Sound Effects Pack, licensed by the owner under the Media
tier (formerly Rare). The sounds are a second **non-portable** private Included
source, `wow-comedy-sfx`, handled like the
[Mixamo-motion pack](mixamo-motion-pack.md): never in Git, Docker build contexts,
self-host images or the public package set. See
[ADR 0022](../../adr/0022-optional-licensed-effect-sounds.md) and
[issue #399](https://github.com/raymond-van/animama/issues/399).

## How built-in content uses the sounds

A built-in effect descriptor under `content/included/vfx/avatar/` declares its
sounds as optional edges and names the one it plays by default in
`definition.soundAlias`. A merged effect declares each of its uses' sounds, and
a Gesture or Reaction event picks another with its override's `soundAlias`
([ADR 0025](../../adr/0025-per-use-avatar-effect-overrides.md)). An effect the
owner chose to keep quiet (for example one used only by idles) has none:

```json
"dependencies": [
  {"ref": "builtin:sound-effect:funny_sweat_02", "content_type": "sound_effect",
   "alias": "on-apply", "optional": true}
]
```

A built-in Gesture or Reaction can also play a pack sound directly, from an
`sfx` clip event whose `cueId` names an optional `sound_effect` edge in its
`.meta.json`:

```json
{"id": "pop", "time": 0.2, "kind": "sfx", "cueId": "pop", "volume": 0.8}
```

```json
"dependencies": [
  {"ref": "builtin:sound-effect:bubble_pop_01", "content_type": "sound_effect",
   "alias": "pop", "optional": true, "config": {}}
]
```

`pnpm -s animation promote` and `pnpm -s effects promote` accept such an edge
only for a sound in the tracked pack manifest, and write the edges they add
as optional. A replace keeps the item's existing edges, so a hand-written
required pack edge is caught by the Included-content integrity test.

Where the pack isn't mounted (self-host, public source, a desktop build without
the input), the Included scan drops those edges and the alias, and the effect
plays silently, as does an event that picks one of the dropped sounds. A
Gesture or Reaction stays valid and offered in chat: the scan records the
dropped alias in the item's provenance (`optional_omitted`), the runtime
projection reports it in `missing_references`, and the player skips just that
`sfx` event. Where several effects start together in a Reaction, only one plays its
sound; the others set `playAccompanyingSound: false` on their clip events.
Audible effect events and `sfx` events in one clip start at least 0.3 s apart.
`tests/test_included_content_integrity.py` enforces these rules and requires
every built-in pack-sound edge to be optional.

Licensed sounds never appear in the Library or creator pickers, can't be used
by Local content, and are left out of exports and customized copies. An
exported or customized Gesture or Reaction loses the `sfx` events that play
them.

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
2. Point the effect's, Gesture's or Reaction's optional edge at the new key.
3. Print a manifest with a new version, then run `scan --git`, `verify`,
   `publish --confirm` and commit the manifest with the descriptor change.
   Only sounds that built-in content uses belong in the pack, so making an
   effect silent (`"sound": null` on promote) can also need a new pack
   version without its sound.

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

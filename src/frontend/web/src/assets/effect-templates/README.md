# Avatar FX template thumbnails

The Effects template picker shows these images on its Avatar FX templates. Each
`<id>.webp` belongs to the template with that ID in
`src/lib/effects/effectTemplates.ts`; a test checks that every template has a
thumbnail and every thumbnail a template. The picker imports them lazily.

## Regenerating

From `src/frontend/web`, after changing the template list or an Included Avatar
Effect it uses:

```bash
pnpm -s effects:thumbnails              # every template; removes stale files
pnpm -s effects:thumbnails eye_vv star3  # only the named templates
```

The command uses the `effects:render --thumbnail` renderer: headless Chromium
with SwiftShader, Annie (`content/included/avatars/AvatarSample_A_1_New.vrm`)
with the portrait capture's head framing and lighting, the effect applied from
its Included descriptor and held for 1 s, at 320×320 px. A template marked
`thumbnail: { framing: "wide" }` (art on the chest or beside the head) is
framed 2.2 times wider; one with a `time` is captured at that moment instead
(looping art that has faded out at 1 s). Renders are
deterministic, so unchanged inputs reproduce the same pixels. Review the images
before committing them.

## Provenance and terms

Each thumbnail is a direct Animama renderer capture of Annie, the unmodified
pixiv VRoid Project preset, wearing an owner-authored Included Avatar Effect
from `content/included/vfx/avatar/`. No other artwork is used. Like Annie's
Library portrait, the images follow Annie's model terms
(`LicenseRef-pixiv-VRoidPreset`, the
[VRoidPreset A–Z conditions](https://vroid.pixiv.help/hc/en-us/articles/4402394424089-VRoidPreset-A-Z));
they are not CC0 or AGPL. Credit pixiv VRoid Project. See
`licenses/third-party/art-NOTICES.md`, `licenses/source-review.json` and the
desktop runtime notice `effect-template-thumbnails-attribution.txt`.

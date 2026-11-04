# Adapted third-party code

These files contain code adapted from other open-source projects. Each keeps
its upstream licence for the adapted portions; Animama's own changes are
AGPL-3.0-only. Files adapted from Apache-2.0 projects say in their first line
that they were modified. Each adapted file except the two Lucide icons and the
landing `text-shimmer.tsx`, which keep their existing in-file credits, starts
with a two-line header naming its upstream. The upstream licence texts are in
this folder. A
provenance sweep on 2026-11-03 compared the repository with the likely
upstreams and found these; the owner approved recording them.

| File | Upstream | Licence | Revision compared | Adapted |
| --- | --- | --- | --- | --- |
| `src/frontend/packages/product-ui/src/components/avatar.tsx` | [shadcn/ui](https://github.com/shadcn-ui/ui): `apps/v4/registry/new-york-v4/ui/avatar.tsx` | MIT | shadcn 2.5.0–3.7.0 | Component structure and classes; local styling |
| `src/frontend/packages/product-ui/src/components/button.tsx` | [shadcn/ui](https://github.com/shadcn-ui/ui): `apps/v4/registry/new-york-v4/ui/button.tsx` | MIT | shadcn 3.6.0–3.7.0 | Component and variants; local variants and styling |
| `src/frontend/packages/product-ui/src/components/tooltip.tsx` | [shadcn/ui](https://github.com/shadcn-ui/ui): `apps/v4/registry/new-york-v4/ui/tooltip.tsx` | MIT | shadcn 3.4.0–3.8.0 | Tooltip primitives; local content and behaviour additions |
| `src/frontend/packages/product-ui/src/components/textarea.tsx` | [shadcn/ui](https://github.com/shadcn-ui/ui): `apps/www/registry/new-york/ui/textarea.tsx` | MIT | shadcn 2.1.0–2.5.0 | Component and classes |
| `src/frontend/packages/product-ui/src/components/shine-border.tsx` | [Magic UI](https://github.com/magicuidesign/magicui): `apps/www/registry/magicui/shine-border.tsx` | MIT | main, fetched 2026-11-03 (sha256 c9344b56…) | Component; local conic gradient and data-slot |
| `src/frontend/packages/product-ui/src/components/sparkles-text.tsx` | [Magic UI](https://github.com/magicuidesign/magicui): `apps/www/registry/magicui/sparkles-text.tsx` | MIT | main, fetched 2026-11-03 (sha256 bab902a2…) | Sparkle SVG path, keyframes and colour pick; layout logic is original |
| `src/frontend/packages/product-ui/src/components/text-effect.tsx` | [Motion Primitives](https://github.com/ibelick/motion-primitives): `components/core/text-effect.tsx` | MIT | main, fetched 2026-11-03 (sha256 4b93c0ea…) | Component, presets and variants, with formatting changes |
| `src/frontend/packages/product-ui/src/components/chat-transcript.tsx` | [ElevenLabs UI and Vercel AI Elements](https://github.com/elevenlabs/ui): `apps/www/registry/elevenlabs-ui/ui/conversation.tsx (itself close to AI Elements 1.3.0 conversation.tsx)` | MIT AND Apache-2.0 | ElevenLabs UI main, fetched 2026-11-03 (sha256 34009c45…) | Conversation container; local transcript behaviour |
| `src/frontend/packages/product-ui/src/components/message.tsx` | [ElevenLabs UI and Vercel AI Elements](https://github.com/elevenlabs/ui): `apps/www/registry/elevenlabs-ui/ui/message.tsx (itself close to AI Elements 1.3.0 message.tsx)` | MIT AND Apache-2.0 | ElevenLabs UI main, fetched 2026-11-03 (sha256 bf8a16fb…) | Message and MessageAvatar; the split variants and motion are original |
| `src/frontend/packages/product-ui/src/components/streamdown-response.tsx` | [ElevenLabs UI and Vercel AI Elements](https://github.com/elevenlabs/ui): `apps/www/registry/elevenlabs-ui/ui/response.tsx (itself close to AI Elements 1.3.0 response.tsx)` | MIT AND Apache-2.0 | ElevenLabs UI main, fetched 2026-11-03 (sha256 129a7e7a…) | Streamdown response wrapper |
| `src/frontend/web/src/ui/components/command.tsx` | [shadcn/ui](https://github.com/shadcn-ui/ui): `apps/v4/registry/new-york-v4/ui/command.tsx` | MIT | shadcn 2.7.0–4.0.0 | Command primitives |
| `src/frontend/web/src/ui/components/dialog.tsx` | [shadcn/ui](https://github.com/shadcn-ui/ui): `apps/v4/registry/new-york-v4/ui/dialog.tsx` | MIT | shadcn 4.0.0 | Dialog primitives; local layout additions |
| `src/frontend/web/src/ui/components/input.tsx` | [shadcn/ui](https://github.com/shadcn-ui/ui): `apps/v4/registry/new-york-v4/ui/input.tsx` | MIT | shadcn new-york-v4 | Input class block only; ControlledNumberInput is original |
| `src/frontend/web/src/ui/components/input-group.tsx` | [shadcn/ui](https://github.com/shadcn-ui/ui): `apps/v4/registry/new-york-v4/ui/input-group.tsx` | MIT | shadcn 3.4.0–4.0.0 | Input group primitives |
| `src/frontend/web/src/ui/components/popover.tsx` | [shadcn/ui](https://github.com/shadcn-ui/ui): `apps/v4/registry/new-york-v4/ui/popover.tsx` | MIT | shadcn 2.5.0–3.7.0 | Popover primitives; local additions |
| `src/frontend/web/src/ui/components/select.tsx` | [shadcn/ui](https://github.com/shadcn-ui/ui): `apps/v4/registry/new-york-v4/ui/select.tsx` | MIT | shadcn 3.6.0–3.8.0 | Select primitives |
| `src/frontend/web/src/ui/components/sonner.tsx` | [shadcn/ui](https://github.com/shadcn-ui/ui): `apps/v4/registry/new-york-v4/ui/sonner.tsx` | MIT | shadcn 3.4.2–4.0.0 | Toaster wrapper; local theme handling |
| `src/frontend/web/src/ui/components/switch.tsx` | [shadcn/ui](https://github.com/shadcn-ui/ui): `apps/v4/registry/new-york-v4/ui/switch.tsx` | MIT | shadcn 2.5.0–3.7.0 | Switch primitive |
| `src/frontend/web/src/ui/components/card.tsx` | [shadcn/ui](https://github.com/shadcn-ui/ui): `apps/www/registry/new-york/ui/card.tsx` | MIT | shadcn 2.1.0–2.5.0 | Card primitives |
| `src/frontend/web/src/ui/components/checkbox.tsx` | [shadcn/ui](https://github.com/shadcn-ui/ui): `apps/www/registry/new-york/ui/checkbox.tsx` | MIT | shadcn 2.1.0–2.5.0 | Checkbox primitive |
| `src/frontend/web/src/ui/components/context-menu.tsx` | [shadcn/ui](https://github.com/shadcn-ui/ui): `apps/www/registry/new-york/ui/context-menu.tsx` | MIT | shadcn 2.1.0–2.5.0 | A subset of the context-menu primitives |
| `src/frontend/web/src/ui/components/dropdown-menu.tsx` | [shadcn/ui](https://github.com/shadcn-ui/ui): `apps/www/registry/new-york/ui/dropdown-menu.tsx` | MIT | shadcn 2.1.0–2.5.0 | Dropdown-menu primitives |
| `src/frontend/web/src/ui/components/label.tsx` | [shadcn/ui](https://github.com/shadcn-ui/ui): `apps/www/registry/new-york/ui/label.tsx` | MIT | shadcn 2.1.0–2.5.0 | Label primitive |
| `src/frontend/web/src/ui/components/slider.tsx` | [shadcn/ui](https://github.com/shadcn-ui/ui): `apps/www/registry/new-york/ui/slider.tsx` | MIT | shadcn 2.1.0–2.5.0 | Slider primitive; local additions |
| `src/frontend/web/src/ui/components/tabs.tsx` | [shadcn/ui](https://github.com/shadcn-ui/ui): `apps/www/registry/new-york/ui/tabs.tsx` | MIT | shadcn 2.1.0–2.5.0 | Tabs primitives; local additions |
| `src/frontend/web/src/ui/components/live-waveform.tsx` | [ElevenLabs UI](https://github.com/elevenlabs/ui): `apps/www/registry/elevenlabs-ui/ui/live-waveform.tsx` | MIT | main, fetched 2026-11-03 (sha256 ca011f65…) | Live waveform component |
| `src/frontend/web/src/ui/components/model-selector.tsx` | [Vercel AI Elements](https://github.com/vercel/ai-elements): `packages/elements/src/model-selector.tsx` | Apache-2.0 | ai-elements 1.8.0–1.9.0 | Model selector component; local provider data handling |
| `src/frontend/web/src/ui/components/PencilSparklesIcon.tsx` | [Lucide](https://github.com/lucide-icons/lucide): `icons/pencil-sparkles.svg` | ISC | 1.20.0 | Icon paths, unchanged; the ISC notice is in the file |
| `src/frontend/web/src/ui/components/TimelineIcon.tsx` | [Lucide](https://github.com/lucide-icons/lucide): `icons/timeline.svg` | ISC | main, fetched 2026-11-03 | Icon paths, unchanged; the ISC notice is in the file |
| `src/frontend/web/scripts/landing-stage/text-shimmer.tsx` | [Motion Primitives](https://github.com/ibelick/motion-primitives): `components/core/text-shimmer.tsx` | MIT | main, fetched 2026-11-03 (sha256 a294c8a1…) | Text shimmer, adapted for the landing page; the file header lists the changes |
| `src/backend/animama/app/contracts/base.py` | [Letta](https://github.com/letta-ai/letta): `letta/schemas/letta_base.py` | Apache-2.0 | 0.8.10–archive (identical; sha256 2e154a69…) | ID-prefix helpers and MetadataBase |
| `src/backend/animama/orm/archive.py` | [Letta](https://github.com/letta-ai/letta): `letta/orm/archive.py` | Apache-2.0 | 0.11.0–archive | Archive table layout, ID default and field documentation |
| `src/backend/animama/orm/archive_passage.py` | [Letta](https://github.com/letta-ai/letta): `letta/orm/passage.py` | Apache-2.0 | archive | Docstring and field documentation |
| `src/backend/animama/domain/usage.py` | [OpenAI Agents SDK](https://github.com/openai/openai-agents-python): `src/agents/usage.py` | MIT | v0.0.17–v0.2.0 | Usage accumulation (Usage.add) |

The generated API client in `src/frontend/packages/runtime-contracts/src/generated/`
contains Hey API's client runtime: `@hey-api/openapi-ts` 0.90.10 copies its
`dist/clients/fetch` and `dist/clients/core` files into `client/` and `core/`
(MIT, Copyright (c) Hey API). Regenerate them with `pnpm openapi-ts`; never edit
them by hand. The two pnpm patches in `src/frontend/patches/` carry upstream MIT
lines from `@mochiya/three-liltoon` 0.1.9 and `@vitejs/plugin-react` 6.0.1 in
their diff context; the latter quotes its `dist/refresh-runtime.js`, which
carries Meta's MIT React Refresh notice.

The provider marks in `src/frontend/web/public/provider-logos/` are copied
unmodified from models.dev and llama.cpp; that folder's README and licence
files record them. The marks identify the providers and grant no trademark
rights.

Upstream notices:

- shadcn/ui: [code-shadcn-ui-LICENSE.md](code-shadcn-ui-LICENSE.md)
- Magic UI: [code-magic-ui-LICENSE.md](code-magic-ui-LICENSE.md)
- Motion Primitives: [code-motion-primitives-LICENSE.md](code-motion-primitives-LICENSE.md)
  (upstream `LICENCE.md`)
- ElevenLabs UI: [code-elevenlabs-ui-LICENSE.md](code-elevenlabs-ui-LICENSE.md)
- Vercel AI Elements: [code-ai-elements-LICENSE.txt](code-ai-elements-LICENSE.txt), with the
  [Apache License 2.0](code-Apache-2.0.txt)
- Lucide: [code-lucide-LICENSE.txt](code-lucide-LICENSE.txt)
- Letta: [code-letta-LICENSE.txt](code-letta-LICENSE.txt)
- OpenAI Agents SDK: [code-openai-agents-LICENSE.txt](code-openai-agents-LICENSE.txt)
- Hey API: [code-hey-api-LICENSE.md](code-hey-api-LICENSE.md)
- `@mochiya/three-liltoon`: [code-three-liltoon-LICENSE.txt](code-three-liltoon-LICENSE.txt)
- `@vitejs/plugin-react`: [code-vite-plugin-react-LICENSE.txt](code-vite-plugin-react-LICENSE.txt)

Checked and kept as original work: `src/frontend/packages/product-ui/src/theme.css`
(its palette was inspired by tweakcn's Candyland preset; no code was copied),
the three-line `cn()` helper, `field.tsx`, `message-loader-v2.tsx`, the
remaining chat and Library components, and the backend ORM models other than
those listed above.

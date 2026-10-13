# Electron implementation guide

Electron owns native windows, service supervision, protected credentials and the
preload bridge. React owns shared product behavior and uses the neutral
runtime-owner context. Electron imports stay out of browser modules.

## Implementation references

- [Runtime architecture](../../docs/frontend/desktop/overview.md): startup,
  stable origin, private readiness, IPC authority, credential storage and recovery.
- [Platform builds](../../docs/frontend/desktop/platforms.md): external-stack and
  isolated embedded development, packaging commands and native checks.
- [Runtime staging](../../docs/frontend/desktop/runtime-staging.md): exact inputs,
  inventories and native runtime audits.
- [Release process](../../docs/frontend/desktop/release-process.md): signing,
  isolated acceptance and separate publication gates. No public release is accepted.
- [Troubleshooting](../../docs/frontend/desktop/troubleshooting.md): logs, data
  preservation, backups and recovery.

## Code ownership

| Area                                                  | Responsibility                                                                                 |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `desktop/src/main-process/runtime/`                   | Paths, manifests, vault, processes, PGDATA, migrations, readiness, recovery, guarded IPC       |
| `desktop/src/main-process/feature-packs/`             | Catalog-bound download, strict extraction, inventory/signature verification, atomic activation |
| `desktop/src/main-process/updates/`                   | Stable public feed policy, consent, disk/pack preflight, native updater adapter                |
| `desktop/scripts/runtime/release-macos.mjs`           | Audited candidate packaging; publication is a separate gated command                           |
| `desktop/src/main-process/runtime/product-windows.ts` | Product-document destruction, remembered routes and request gating                             |
| `src/backend/animama/local/http/`                     | Exact Host/Origin, metadata, CSRF, capability, static/model delivery and quiescence            |
| `shared/desktop-runtime.ts`                           | Serializable API version 2 runtime and credential contracts                                    |
| `web/src/ui/settings/DesktopCredentialsPanel.tsx`     | Optional OpenAI/Anthropic/ElevenLabs key entry and status, no readback                         |
| `web/src/ui/settings/DesktopFeaturePacksPanel.tsx`    | Bounded main-window pack controls and affected-content labels                                  |
| `src/backend/animama/runtime/`                        | Frozen CLI and packaged resources                                                              |
| `src/backend/animama/server/local_runtime.py`         | Immutable Included source configuration and writable local roots                               |

The renderer receives bounded state and explicit actions through
`window.animamaDesktop`. Never expose arbitrary paths, commands or key readback.
Packaged builds always supervise embedded services; development overrides are
limited to unpackaged testing. Preserve the vault, database, installation owner
and saved origin through restart and recovery.

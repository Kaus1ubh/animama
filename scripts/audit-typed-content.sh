#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

patterns='AssetKind|AssetVersion|PyAssetDownloadAuthorization|ORMAnimaAssetLoadout|/v1/assets|/runtime-assets|runtime-assets|anima_asset_bindings|LibraryAsset|asset-equip|asset-packs|asset_count|ANIMAMA_TYPED_(CONTENT|LOADOUT)_WRITES|R2_ASSET_(UPLOAD|DOWNLOAD)|ASSET_UPLOAD_CLEANUP|app_asset_(id|version)|__ANIMAMA_APP_AVATAR_PORTRAIT_GENERATOR__|avatar_model_url|requestAuthorizedAssetDownloadUrl|asset_avatar_portrait_model_not_ready'

if rg -n "$patterns" \
  src/backend/animama \
  src/frontend/web/src \
  src/frontend/scripts \
  src/backend/docs \
  src/frontend/docs \
  docker-compose.yml \
  .env.example \
  --glob '!**/plans/**'; then
  echo "Typed-content audit failed: removed Asset-model vocabulary is still present." >&2
  exit 1
fi

echo "Typed-content audit passed."

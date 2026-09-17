#!/usr/bin/env bash

# Shared, read-only configuration helpers for Animama's self-hosted state
# backup and restore commands. This file is sourced by the executable scripts.

ANIMAMA_STATE_RUNNING_SERVICES=()

animama_state_die() {
  printf 'Error: %s\n' "$1" >&2
  exit 2
}

animama_state_normalize_name() {
  local raw="$1"
  local normalized
  normalized="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9-]+/-/g; s/^-+//; s/-+$//')"
  if [ -z "$normalized" ] || [[ ! "$normalized" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
    return 1
  fi
  if [[ "$normalized" == "animama" || "$normalized" == animama-* ]]; then
    printf '%s\n' "$normalized"
  else
    printf 'animama-%s\n' "$normalized"
  fi
}

animama_state_absolute_path() {
  local raw="$1"
  if [[ "$raw" = /* ]]; then
    printf '%s\n' "${raw%/}"
  else
    printf '%s\n' "${ANIMAMA_STATE_REPO_ROOT}/${raw#./}"
  fi
}

animama_state_validate_root() {
  local label="$1"
  local path="$2"
  [ -n "$path" ] || animama_state_die "$label is empty"
  case "$path" in
    / | "$ANIMAMA_STATE_REPO_ROOT" | "$HOME")
      animama_state_die "$label resolves to an unsafe broad path: $path"
      ;;
  esac
  case "$ANIMAMA_STATE_REPO_ROOT" in
    "$path"/*)
      animama_state_die "$label is an ancestor of the Animama checkout: $path"
      ;;
  esac
}

animama_state_resolve_live_roots() {
  # Restore deletes children of these directories. Resolve existing symlinks
  # before the final safety check so a custom path cannot disguise a broad
  # target such as the checkout, home directory, or filesystem root.
  ANIMAMA_STATE_LOCAL_ROOT="$(cd "$ANIMAMA_STATE_LOCAL_ROOT" && pwd -P)"
  ANIMAMA_STATE_DATA_ROOT="$(cd "$ANIMAMA_STATE_DATA_ROOT" && pwd -P)"
  ANIMAMA_STATE_INCLUDED_ROOT="$(cd "$ANIMAMA_STATE_INCLUDED_ROOT" && pwd -P)"
  animama_state_validate_root "Local content root" "$ANIMAMA_STATE_LOCAL_ROOT"
  animama_state_validate_root "private data root" "$ANIMAMA_STATE_DATA_ROOT"
  if [ "$ANIMAMA_STATE_LOCAL_ROOT" = "$ANIMAMA_STATE_DATA_ROOT" ]; then
    animama_state_die "Local content and private data roots must differ"
  fi
  case "$ANIMAMA_STATE_LOCAL_ROOT/" in
    "$ANIMAMA_STATE_DATA_ROOT/"*)
      animama_state_die "Local content cannot be inside the private data root"
      ;;
  esac
  case "$ANIMAMA_STATE_DATA_ROOT/" in
    "$ANIMAMA_STATE_LOCAL_ROOT/"*)
      animama_state_die "Private data cannot be inside the Local content root"
      ;;
  esac
  case "$ANIMAMA_STATE_LOCAL_ROOT/" in
    "$ANIMAMA_STATE_INCLUDED_ROOT/"*)
      animama_state_die "Local content cannot be inside the read-only Included root"
      ;;
  esac
}

animama_state_configure() {
  local requested_name="$1"
  local script_dir local_default data_default stack_root
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  ANIMAMA_STATE_REPO_ROOT="$(cd "${script_dir}/.." && pwd)"

  if [ -n "$requested_name" ]; then
    ANIMAMA_STATE_PROJECT="$(animama_state_normalize_name "$requested_name")" ||
      animama_state_die "invalid stack name: $requested_name"
  elif [ -n "${COMPOSE_PROJECT_NAME:-}" ]; then
    ANIMAMA_STATE_PROJECT="$(animama_state_normalize_name "$COMPOSE_PROJECT_NAME")" ||
      animama_state_die "invalid COMPOSE_PROJECT_NAME: $COMPOSE_PROJECT_NAME"
  else
    ANIMAMA_STATE_PROJECT="animama"
  fi

  if [ "$ANIMAMA_STATE_PROJECT" = "animama" ]; then
    local_default="${ANIMAMA_STATE_REPO_ROOT}/content/local"
    data_default="${ANIMAMA_STATE_REPO_ROOT}/data"
  else
    stack_root="${ANIMAMA_STATE_REPO_ROOT}/.animama-stacks/${ANIMAMA_STATE_PROJECT}"
    local_default="${stack_root}/content/local"
    data_default="${stack_root}/data"
  fi

  ANIMAMA_STATE_LOCAL_ROOT="$(animama_state_absolute_path "${ANIMAMA_LOCAL_CONTENT_HOST_PATH:-$local_default}")"
  ANIMAMA_STATE_DATA_ROOT="$(animama_state_absolute_path "${ANIMAMA_DATA_HOST_PATH:-$data_default}")"
  ANIMAMA_STATE_INCLUDED_ROOT="$(animama_state_absolute_path "${ANIMAMA_INCLUDED_CONTENT_HOST_PATH:-${ANIMAMA_STATE_REPO_ROOT}/content/included}")"

  animama_state_validate_root "Local content root" "$ANIMAMA_STATE_LOCAL_ROOT"
  animama_state_validate_root "private data root" "$ANIMAMA_STATE_DATA_ROOT"
  if [ "$ANIMAMA_STATE_LOCAL_ROOT" = "$ANIMAMA_STATE_DATA_ROOT" ]; then
    animama_state_die "Local content and private data roots must differ"
  fi
  case "$ANIMAMA_STATE_LOCAL_ROOT/" in
    "$ANIMAMA_STATE_DATA_ROOT/"* )
      animama_state_die "Local content cannot be inside the private data root"
      ;;
  esac
  case "$ANIMAMA_STATE_DATA_ROOT/" in
    "$ANIMAMA_STATE_LOCAL_ROOT/"* )
      animama_state_die "Private data cannot be inside the Local content root"
      ;;
  esac
  case "$ANIMAMA_STATE_LOCAL_ROOT/" in
    "$ANIMAMA_STATE_INCLUDED_ROOT/"* )
      animama_state_die "Local content cannot be inside the read-only Included root"
      ;;
  esac
}

animama_state_compose() {
  # A sourced stack record is authoritative. Otherwise use the same explicit
  # build selector as reset.sh so backup/restore includes development services.
  if [ -z "${COMPOSE_FILE:-}" ]; then
    local build_mode="${ANIMAMA_WEB_BUILD_MODE:-}"
    if [ -z "${ANIMAMA_WEB_BUILD_MODE+x}" ]; then
      build_mode="$(ANIMAMA_PARAKEET_MODEL_DIR=/__animama_model_selector_only__ ANIMAMA_BROWSER_MODEL_DIR=/__animama_model_selector_only__ docker compose -f "${ANIMAMA_STATE_REPO_ROOT}/docker-compose.yml" config --environment | python3 -c '
import sys
values = dict(line.rstrip("\n").partition("=")[::2] for line in sys.stdin)
print(values.get("ANIMAMA_WEB_BUILD_MODE") or "development")
')" || return
    fi
    case "$build_mode" in
      production) COMPOSE_FILE="${ANIMAMA_STATE_REPO_ROOT}/docker-compose.yml" ;;
      development) COMPOSE_FILE="${ANIMAMA_STATE_REPO_ROOT}/docker-compose.yml:${ANIMAMA_STATE_REPO_ROOT}/docker-compose.development.yml" ;;
      *) animama_state_die "ANIMAMA_WEB_BUILD_MODE must be development or production" ;;
    esac
    export COMPOSE_FILE
  fi
  # Prefer the exact verified version recorded by reset.sh. A caller without a
  # record must resolve its selected store offline before any Compose action.
  if [ -z "${ANIMAMA_PARAKEET_MODEL_DIR:-}" ]; then
    local model_root="${ANIMAMA_MODEL_ROOT:-}"
    if [ -z "${ANIMAMA_MODEL_ROOT+x}" ]; then
      model_root="$(ANIMAMA_PARAKEET_MODEL_DIR=/__animama_model_selector_only__ ANIMAMA_BROWSER_MODEL_DIR=/__animama_model_selector_only__ docker compose -f "${ANIMAMA_STATE_REPO_ROOT}/docker-compose.yml" config --environment | python3 -c '
import sys
values = dict(line.rstrip("\n").partition("=")[::2] for line in sys.stdin)
print(values.get("ANIMAMA_MODEL_ROOT", ""))
')" || return
    fi
    local model_path_args=()
    if [ -n "$model_root" ]; then
      model_path_args=(--root "$model_root")
    fi
    ANIMAMA_PARAKEET_MODEL_DIR="$(python3 "${ANIMAMA_STATE_REPO_ROOT}/scripts/models/parakeet.py" path "${model_path_args[@]}")" || return
    export ANIMAMA_PARAKEET_MODEL_DIR
  fi
  docker compose -p "$ANIMAMA_STATE_PROJECT" "$@"
}

animama_state_require_stack() {
  command -v docker >/dev/null 2>&1 || animama_state_die "docker is required"
  animama_state_compose ps --status running postgres 2>/dev/null | grep -q postgres ||
    animama_state_die "PostgreSQL is not running for stack $ANIMAMA_STATE_PROJECT"
}

animama_state_pause_services() {
  ANIMAMA_STATE_RUNNING_SERVICES=()
  while IFS= read -r service; do
    [ -n "$service" ] || continue
    [ "$service" = "postgres" ] && continue
    ANIMAMA_STATE_RUNNING_SERVICES+=("$service")
  done < <(animama_state_compose ps --services --filter status=running)
  if [ "${#ANIMAMA_STATE_RUNNING_SERVICES[@]}" -gt 0 ]; then
    printf 'Quiescing application services: %s\n' "${ANIMAMA_STATE_RUNNING_SERVICES[*]}"
    animama_state_compose stop "${ANIMAMA_STATE_RUNNING_SERVICES[@]}"
  fi
}

animama_state_resume_services() {
  if [ "${#ANIMAMA_STATE_RUNNING_SERVICES[@]}" -gt 0 ]; then
    printf 'Restarting application services: %s\n' "${ANIMAMA_STATE_RUNNING_SERVICES[*]}"
    animama_state_compose start "${ANIMAMA_STATE_RUNNING_SERVICES[@]}"
    ANIMAMA_STATE_RUNNING_SERVICES=()
  fi
}

animama_state_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    animama_state_die "sha256sum or shasum is required"
  fi
}

animama_state_validate_tar_paths() {
  local archive="$1"
  local mode="$2"
  local entry
  while IFS= read -r entry; do
    [ -n "$entry" ] || continue
    case "$entry" in
      /* | ../* | */../* | */..)
        animama_state_die "archive contains an unsafe path: $entry"
        ;;
    esac
    if [ "$mode" = "outer" ]; then
      case "$entry" in
        animama-backup | animama-backup/ | animama-backup/*) ;;
        *) animama_state_die "archive contains an unexpected entry: $entry" ;;
      esac
    fi
  done < <(tar -tzf "$archive")

  # The supported library is made of ordinary files and directories. Reject
  # links and special nodes so extraction cannot redirect writes outside the
  # validated destination even if an archive has been modified intentionally.
  while IFS= read -r listing; do
    [ -n "$listing" ] || continue
    case "${listing:0:1}" in
      - | d) ;;
      *) animama_state_die "archive contains a link or special filesystem entry" ;;
    esac
  done < <(tar -tvzf "$archive")
}

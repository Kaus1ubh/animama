#!/bin/bash

# Local stack restart/reset script. Durable state is preserved unless --purge
# is supplied explicitly.

set -eo pipefail  # Rendering/preflight failures must stop before any container changes.

usage() {
  printf '%s\n' \
    "Usage: $0 [--name NAME] [--base-port PORT] [--host HOST] [--profile PROFILE] [--stack-env-file PATH] [--purge] [--build [service ...]]" \
    "" \
    "Options:" \
    "  --name NAME            Compose stack name. NAME becomes animama-NAME unless it already starts with animama-." \
    "                         Example: $0 --name abc --base-port 8200" \
    "  --base-port PORT       Assign the application to PORT; dev-tools use PORT+4 (pgAdmin) and PORT+20 (Dozzle)." \
    "  --host HOST            Public hostname used in browser-facing URLs." \
    "                         Defaults to localhost, or animama-NAME.localhost for named stacks." \
    "  --profile PROFILE      Enable a Docker Compose profile. May be repeated or comma-separated." \
    "                         Example: $0 --profile dev-tools (localhost pgAdmin and Dozzle)." \
    "                         Remove dev-tools from COMPOSE_PROFILES to disable; no --purge needed." \
    "  --stack-env-file PATH  Write generated stack env vars to PATH." \
    "                         Defaults to .animama-stack.env in the checkout/worktree root." \
    "  --purge                Delete only this stack's database volumes and derived Local/private roots." \
    "                         Exact targets are printed before deletion. Normal runs preserve state." \
    "  --build [service ...]  Build all services, or only the listed services, before starting." \
    "                         Example: $0 --build animama-server" \
    "  -h, --help             Show this help." \
    "" \
    "Models: python3 scripts/models/parakeet.py acquire (explicit one-time setup)." \
    "        ANIMAMA_MODEL_ROOT selects an absolute shared store root; startup verifies offline."
}

die() {
  echo "$1" >&2
  usage >&2
  exit 2
}

sanitize_name() {
  local raw="$1"
  local normalized
  normalized="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9-]+/-/g; s/^-+//; s/-+$//')"
  if [ -z "$normalized" ] || [[ ! "$normalized" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
    return 1
  fi
  printf '%s\n' "$normalized"
}

project_name_from_stack() {
  local normalized
  normalized="$(sanitize_name "$1")" || return 1
  if [[ "$normalized" == "animama" || "$normalized" == animama-* ]]; then
    printf '%s\n' "$normalized"
  else
    printf 'animama-%s\n' "$normalized"
  fi
}

assign_port() {
  local var_name="$1"
  local port_value="$2"
  export "$var_name=$port_value"
}

write_env_var() {
  local name="$1"
  printf 'export %s=%q\n' "$name" "${!name:-}"
}

append_profile_list() {
  local raw="$1"
  local item
  local -a profile_items
  local trimmed
  IFS=',' read -ra profile_items <<< "$raw"
  for item in "${profile_items[@]}"; do
    trimmed="${item#"${item%%[![:space:]]*}"}"
    trimmed="${trimmed%"${trimmed##*[![:space:]]}"}"
    if [ -z "$trimmed" ]; then
      continue
    fi
    if [[ ! "$trimmed" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]]; then
      die "Invalid Compose profile: $trimmed"
    fi
    if [ "$trimmed" = "obs" ]; then
      die "The obs profile has been retired. Remove obs from --profile, COMPOSE_PROFILES and .env; existing observability volumes are preserved."
    fi
    REQUESTED_PROFILES+=("$trimmed")
  done
}

BUILD_REQUESTED=false
BUILD_SERVICES=()
REQUESTED_PROFILES=()
STACK_NAME=""
BASE_PORT=""
BASE_PORT_REQUESTED=false
APP_HOST_ARG=""
STACK_ENV_FILE_ARG=""
PURGE_REQUESTED=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    --name)
      [ "$#" -ge 2 ] || die "Missing value for --name"
      STACK_NAME="$2"
      shift 2
      ;;
    --name=*)
      STACK_NAME="${1#--name=}"
      [ -n "$STACK_NAME" ] || die "Missing value for --name"
      shift
      ;;
    --base-port)
      [ "$#" -ge 2 ] || die "Missing value for --base-port"
      BASE_PORT="$2"
      BASE_PORT_REQUESTED=true
      shift 2
      ;;
    --base-port=*)
      BASE_PORT="${1#--base-port=}"
      [ -n "$BASE_PORT" ] || die "Missing value for --base-port"
      BASE_PORT_REQUESTED=true
      shift
      ;;
    --host)
      [ "$#" -ge 2 ] || die "Missing value for --host"
      APP_HOST_ARG="$2"
      shift 2
      ;;
    --host=*)
      APP_HOST_ARG="${1#--host=}"
      [ -n "$APP_HOST_ARG" ] || die "Missing value for --host"
      shift
      ;;
    --profile)
      [ "$#" -ge 2 ] || die "Missing value for --profile"
      append_profile_list "$2"
      shift 2
      ;;
    --profile=*)
      profile_arg="${1#--profile=}"
      [ -n "$profile_arg" ] || die "Missing value for --profile"
      append_profile_list "$profile_arg"
      shift
      ;;
    --profiles)
      [ "$#" -ge 2 ] || die "Missing value for --profiles"
      append_profile_list "$2"
      shift 2
      ;;
    --profiles=*)
      profile_arg="${1#--profiles=}"
      [ -n "$profile_arg" ] || die "Missing value for --profiles"
      append_profile_list "$profile_arg"
      shift
      ;;
    --stack-env-file)
      [ "$#" -ge 2 ] || die "Missing value for --stack-env-file"
      STACK_ENV_FILE_ARG="$2"
      shift 2
      ;;
    --stack-env-file=*)
      STACK_ENV_FILE_ARG="${1#--stack-env-file=}"
      [ -n "$STACK_ENV_FILE_ARG" ] || die "Missing value for --stack-env-file"
      shift
      ;;
    --build)
      BUILD_REQUESTED=true
      shift
      while [ "$#" -gt 0 ] && [[ "$1" != --* ]]; do
        BUILD_SERVICES+=("$1")
        shift
      done
      ;;
    --build=*)
      BUILD_REQUESTED=true
      build_service="${1#--build=}"
      if [ -n "$build_service" ]; then
        BUILD_SERVICES+=("$build_service")
      fi
      shift
      ;;
    --purge)
      PURGE_REQUESTED=true
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script_name="$(basename "$script_dir")"
STACK_ENV_FILE="${STACK_ENV_FILE_ARG:-${script_dir}/.animama-stack.env}"

# Read only these non-secret selectors through Compose's dotenv parser. The
# explicitly selected base file prevents a stale sourced graph from deciding
# which parser/build configuration reset uses.
if [ -z "${COMPOSE_PROFILES+x}" ] || [ -z "${ANIMAMA_WEB_BUILD_MODE+x}" ] || [ -z "${ANIMAMA_MODEL_ROOT+x}" ]; then
  local_selectors="$(ANIMAMA_PARAKEET_MODEL_DIR=/__animama_model_selector_only__ ANIMAMA_BROWSER_MODEL_DIR=/__animama_model_selector_only__ docker compose -f "${script_dir}/docker-compose.yml" config --environment | python3 -c '
import sys
values = dict(line.rstrip("\n").partition("=")[::2] for line in sys.stdin)
print(values.get("COMPOSE_PROFILES", ""))
print(values.get("ANIMAMA_WEB_BUILD_MODE", "development"))
print(values.get("ANIMAMA_MODEL_ROOT", ""))
')"
  dotenv_profiles="${local_selectors%%$'\n'*}"
  dotenv_build_mode="$(printf '%s\n' "$local_selectors" | sed -n '2p')"
  dotenv_model_root="$(printf '%s\n' "$local_selectors" | sed -n '3p')"
fi
# Resolve and fully verify without network access before writing state, stopping
# services, or allowing Compose to create mounts. Ignore any stale derived path.
ANIMAMA_MODEL_ROOT="${ANIMAMA_MODEL_ROOT-${dotenv_model_root:-}}"
model_path_args=()
if [ -n "$ANIMAMA_MODEL_ROOT" ]; then
  model_path_args=(--root "$ANIMAMA_MODEL_ROOT")
fi
if ! ANIMAMA_PARAKEET_MODEL_DIR="$(python3 "${script_dir}/scripts/models/parakeet.py" path "${model_path_args[@]}")"; then
  exit 2
fi
if ! ANIMAMA_BROWSER_MODEL_DIR="$(python3 "${script_dir}/scripts/models/browser_speech.py" path "${model_path_args[@]}")"; then
  exit 2
fi
ANIMAMA_MODEL_ROOT="$(dirname "$(dirname "$ANIMAMA_PARAKEET_MODEL_DIR")")"
export ANIMAMA_MODEL_ROOT ANIMAMA_PARAKEET_MODEL_DIR ANIMAMA_BROWSER_MODEL_DIR

COMPOSE_PROFILES="${COMPOSE_PROFILES-${dotenv_profiles:-}}"
ANIMAMA_WEB_BUILD_MODE="${ANIMAMA_WEB_BUILD_MODE-${dotenv_build_mode:-development}}"
case "$ANIMAMA_WEB_BUILD_MODE" in
  production) COMPOSE_FILE="${script_dir}/docker-compose.yml" ;;
  development) COMPOSE_FILE="${script_dir}/docker-compose.yml:${script_dir}/docker-compose.development.yml" ;;
  *) die "ANIMAMA_WEB_BUILD_MODE must be development or production" ;;
esac
export COMPOSE_FILE ANIMAMA_WEB_BUILD_MODE
export COMPOSE_PROFILES

if [ -n "${COMPOSE_PROFILES:-}" ]; then
  append_profile_list "$COMPOSE_PROFILES"
fi

if [ "${#REQUESTED_PROFILES[@]}" -gt 0 ]; then
  unique_profiles=()
  for profile in "${REQUESTED_PROFILES[@]}"; do
    profile_seen=false
    for existing_profile in "${unique_profiles[@]}"; do
      if [ "$existing_profile" = "$profile" ]; then
        profile_seen=true
        break
      fi
    done
    if [ "$profile_seen" = false ]; then
      unique_profiles+=("$profile")
    fi
  done
  COMPOSE_PROFILES="$(IFS=,; printf '%s' "${unique_profiles[*]}")"
  export COMPOSE_PROFILES
fi

PROJECT_NAME=""
if [ -n "$STACK_NAME" ]; then
  PROJECT_NAME="$(project_name_from_stack "$STACK_NAME")" || die "Invalid stack name: $STACK_NAME"
elif [ -n "${COMPOSE_PROJECT_NAME:-}" ]; then
  PROJECT_NAME="$COMPOSE_PROJECT_NAME"
elif [ "$BASE_PORT_REQUESTED" = true ]; then
  inferred_name="$(sanitize_name "$script_name")" || die "Could not infer a stack name from directory: $script_name"
  if [ "$inferred_name" != "animama" ]; then
    PROJECT_NAME="$(project_name_from_stack "$inferred_name")" || die "Invalid inferred stack name: $inferred_name"
  fi
fi

COMPOSE_ARGS=()
if [ -n "$PROJECT_NAME" ]; then
  export COMPOSE_PROJECT_NAME="$PROJECT_NAME"
  COMPOSE_ARGS=(-p "$PROJECT_NAME")
fi

if [ -z "${ANIMAMA_CONTAINER_NAME_PREFIX+x}" ]; then
  if [ -n "$PROJECT_NAME" ] && [ "$PROJECT_NAME" != "animama" ]; then
    ANIMAMA_CONTAINER_NAME_PREFIX="${PROJECT_NAME}-"
  else
    ANIMAMA_CONTAINER_NAME_PREFIX=""
  fi
fi
export ANIMAMA_CONTAINER_NAME_PREFIX

if [ -n "$PROJECT_NAME" ] && [ "$PROJECT_NAME" != "animama" ]; then
  STACK_STORAGE_KEY="$PROJECT_NAME"
  DERIVED_STACK_ROOT="${script_dir}/.animama-stacks/${STACK_STORAGE_KEY}"
  DERIVED_LOCAL_CONTENT_HOST_PATH="${DERIVED_STACK_ROOT}/content/local"
  DERIVED_DATA_HOST_PATH="${DERIVED_STACK_ROOT}/data"
  DERIVED_DOCLING_CACHE_HOST_PATH="${DERIVED_STACK_ROOT}/cache/docling"
  DERIVED_HOST_CONTENT_ROOT="${DERIVED_STACK_ROOT}/content"
else
  STACK_STORAGE_KEY="default"
  DERIVED_STACK_ROOT=""
  DERIVED_LOCAL_CONTENT_HOST_PATH="${script_dir}/content/local"
  DERIVED_DATA_HOST_PATH="${script_dir}/data"
  DERIVED_DOCLING_CACHE_HOST_PATH="${script_dir}/cache/docling"
  DERIVED_HOST_CONTENT_ROOT="${script_dir}/content"
fi

if [ -n "$PROJECT_NAME" ] && [ "$PROJECT_NAME" != "animama" ]; then
  [ -z "${ANIMAMA_LOCAL_CONTENT_HOST_PATH:-}" ] || [ "$ANIMAMA_LOCAL_CONTENT_HOST_PATH" = "$DERIVED_LOCAL_CONTENT_HOST_PATH" ] ||
    die "named stacks require their isolated derived ANIMAMA_LOCAL_CONTENT_HOST_PATH"
  [ -z "${ANIMAMA_DATA_HOST_PATH:-}" ] || [ "$ANIMAMA_DATA_HOST_PATH" = "$DERIVED_DATA_HOST_PATH" ] ||
    die "named stacks require their isolated derived ANIMAMA_DATA_HOST_PATH"
  [ -z "${ANIMAMA_DOCLING_CACHE_HOST_PATH:-}" ] ||
    [ "$ANIMAMA_DOCLING_CACHE_HOST_PATH" = "$DERIVED_DOCLING_CACHE_HOST_PATH" ] ||
    die "named stacks require their isolated derived ANIMAMA_DOCLING_CACHE_HOST_PATH"
fi

if [ "$PURGE_REQUESTED" = true ]; then
  [ -z "${ANIMAMA_LOCAL_CONTENT_HOST_PATH:-}" ] || [ "$ANIMAMA_LOCAL_CONTENT_HOST_PATH" = "$DERIVED_LOCAL_CONTENT_HOST_PATH" ] ||
    die "--purge refuses a custom ANIMAMA_LOCAL_CONTENT_HOST_PATH"
  [ -z "${ANIMAMA_DATA_HOST_PATH:-}" ] || [ "$ANIMAMA_DATA_HOST_PATH" = "$DERIVED_DATA_HOST_PATH" ] ||
    die "--purge refuses a custom ANIMAMA_DATA_HOST_PATH"
  [ -z "${ANIMAMA_DOCLING_CACHE_HOST_PATH:-}" ] ||
    [ "$ANIMAMA_DOCLING_CACHE_HOST_PATH" = "$DERIVED_DOCLING_CACHE_HOST_PATH" ] ||
    die "--purge refuses a custom ANIMAMA_DOCLING_CACHE_HOST_PATH"
fi

ANIMAMA_INCLUDED_CONTENT_HOST_PATH="${ANIMAMA_INCLUDED_CONTENT_HOST_PATH:-${script_dir}/content/included}"
ANIMAMA_LOCAL_CONTENT_HOST_PATH="${ANIMAMA_LOCAL_CONTENT_HOST_PATH:-$DERIVED_LOCAL_CONTENT_HOST_PATH}"
ANIMAMA_DATA_HOST_PATH="${ANIMAMA_DATA_HOST_PATH:-$DERIVED_DATA_HOST_PATH}"
ANIMAMA_DOCLING_CACHE_HOST_PATH="${ANIMAMA_DOCLING_CACHE_HOST_PATH:-$DERIVED_DOCLING_CACHE_HOST_PATH}"
ANIMAMA_CONTENT_ROOT="${ANIMAMA_CONTENT_ROOT:-$DERIVED_HOST_CONTENT_ROOT}"
ANIMAMA_DATA_ROOT="${ANIMAMA_DATA_ROOT:-$ANIMAMA_DATA_HOST_PATH}"
export ANIMAMA_INCLUDED_CONTENT_HOST_PATH ANIMAMA_LOCAL_CONTENT_HOST_PATH ANIMAMA_DATA_HOST_PATH
export ANIMAMA_DOCLING_CACHE_HOST_PATH ANIMAMA_CONTENT_ROOT ANIMAMA_DATA_ROOT

if [ "$BASE_PORT_REQUESTED" = true ]; then
  if [[ ! "$BASE_PORT" =~ ^[0-9]+$ ]] || [ "$BASE_PORT" -lt 1 ] || [ "$BASE_PORT" -gt 65535 ]; then
    die "--base-port must be an integer from 1 to 65535"
  fi
  assign_port WEB_SERVER_PORT "$BASE_PORT"
  assign_port PGADMIN_PORT "$((BASE_PORT + 4))"
  assign_port DOZZLE_PORT "$((BASE_PORT + 20))"
fi

if [ -n "$APP_HOST_ARG" ]; then
  APP_HOST="$APP_HOST_ARG"
elif [ -z "${APP_HOST:-}" ]; then
  if [ -n "$PROJECT_NAME" ] && [ "$PROJECT_NAME" != "animama" ]; then
    APP_HOST="${PROJECT_NAME}.localhost"
  else
    APP_HOST="localhost"
  fi
fi

APP_SCHEME="${APP_SCHEME:-http}"
WEB_SERVER_PORT="${WEB_SERVER_PORT:-8000}"
export APP_HOST APP_SCHEME WEB_SERVER_PORT

is_loopback_host() {
  local normalized_host
  normalized_host="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$normalized_host" in
    localhost | *.localhost | 127.* | ::1 | \[::1\]) return 0 ;;
    *) return 1 ;;
  esac
}

case "$APP_SCHEME" in
  http | https) ;;
  *) die "APP_SCHEME must be http or https" ;;
esac
is_loopback_host "$APP_HOST" || die "reset.sh supports only localhost public origins; remote access requires an operator-owned proxy"

ANIMAMA_PUBLIC_ORIGIN="${APP_SCHEME}://${APP_HOST}:${WEB_SERVER_PORT}"
ANIMAMA_DESKTOP_WEB_URL="$ANIMAMA_PUBLIC_ORIGIN"
export ANIMAMA_PUBLIC_ORIGIN ANIMAMA_DESKTOP_WEB_URL

POSTGRES_USER="${POSTGRES_USER:-animama}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-a}"
POSTGRES_DB="${POSTGRES_DB:-animama}"
export POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB

compose() {
  docker compose "${COMPOSE_ARGS[@]}" "$@"
}

write_stack_env_file() {
  {
    printf '%s\n' "# Generated by reset.sh. Source this file for stack-aware local commands."
    printf '%s\n' "# Example: source ${STACK_ENV_FILE}"
    if [ -n "$PROJECT_NAME" ]; then
      write_env_var COMPOSE_PROJECT_NAME
    fi
    # Persist empty as well, so sourcing this file cannot reactivate stale profiles.
    write_env_var COMPOSE_PROFILES
    write_env_var COMPOSE_FILE
    write_env_var ANIMAMA_WEB_BUILD_MODE
    write_env_var ANIMAMA_MODEL_ROOT
    write_env_var ANIMAMA_PARAKEET_MODEL_DIR
    write_env_var ANIMAMA_BROWSER_MODEL_DIR
    write_env_var ANIMAMA_CONTAINER_NAME_PREFIX
    write_env_var APP_HOST
    write_env_var APP_SCHEME
    write_env_var WEB_SERVER_PORT
    write_env_var ANIMAMA_PUBLIC_ORIGIN
    write_env_var ANIMAMA_DESKTOP_WEB_URL
    if [ "$DEV_TOOLS_ENABLED" = true ]; then
      write_env_var PGADMIN_PORT
      write_env_var DOZZLE_PORT
      write_env_var PGADMIN_URL
      write_env_var DOZZLE_URL
    fi
    write_env_var ANIMAMA_CONTENT_ROOT
    write_env_var ANIMAMA_DATA_ROOT
    write_env_var ANIMAMA_INCLUDED_CONTENT_HOST_PATH
    write_env_var ANIMAMA_LOCAL_CONTENT_HOST_PATH
    write_env_var ANIMAMA_DATA_HOST_PATH
    write_env_var ANIMAMA_DOCLING_CACHE_HOST_PATH
  } > "$STACK_ENV_FILE"
}

prepare_host_roots() {
  mkdir -p \
    "$ANIMAMA_INCLUDED_CONTENT_HOST_PATH/avatars" \
    "$ANIMAMA_INCLUDED_CONTENT_HOST_PATH/gestures" \
    "$ANIMAMA_INCLUDED_CONTENT_HOST_PATH/pose-clips" \
    "$ANIMAMA_INCLUDED_CONTENT_HOST_PATH/reactions" \
    "$ANIMAMA_INCLUDED_CONTENT_HOST_PATH/vfx/particle" \
    "$ANIMAMA_INCLUDED_CONTENT_HOST_PATH/vfx/avatar" \
    "$ANIMAMA_INCLUDED_CONTENT_HOST_PATH/vfx/scene" \
    "$ANIMAMA_INCLUDED_CONTENT_HOST_PATH/sfx" \
    "$ANIMAMA_INCLUDED_CONTENT_HOST_PATH/idle-styles" \
    "$ANIMAMA_INCLUDED_CONTENT_HOST_PATH/music" \
    "$ANIMAMA_INCLUDED_CONTENT_HOST_PATH/appearances" \
    "$ANIMAMA_INCLUDED_CONTENT_HOST_PATH/voices" \
    "$ANIMAMA_INCLUDED_CONTENT_HOST_PATH/animas" \
    "$ANIMAMA_INCLUDED_CONTENT_HOST_PATH/licenses" \
    "$ANIMAMA_LOCAL_CONTENT_HOST_PATH/avatars" \
    "$ANIMAMA_LOCAL_CONTENT_HOST_PATH/gestures" \
    "$ANIMAMA_LOCAL_CONTENT_HOST_PATH/pose-clips" \
    "$ANIMAMA_LOCAL_CONTENT_HOST_PATH/reactions" \
    "$ANIMAMA_LOCAL_CONTENT_HOST_PATH/vfx/particle" \
    "$ANIMAMA_LOCAL_CONTENT_HOST_PATH/vfx/avatar" \
    "$ANIMAMA_LOCAL_CONTENT_HOST_PATH/vfx/scene" \
    "$ANIMAMA_LOCAL_CONTENT_HOST_PATH/sfx" \
    "$ANIMAMA_LOCAL_CONTENT_HOST_PATH/idle-styles" \
    "$ANIMAMA_LOCAL_CONTENT_HOST_PATH/music" \
    "$ANIMAMA_LOCAL_CONTENT_HOST_PATH/appearances" \
    "$ANIMAMA_LOCAL_CONTENT_HOST_PATH/voices" \
    "$ANIMAMA_LOCAL_CONTENT_HOST_PATH/animas" \
    "$ANIMAMA_DATA_HOST_PATH/user-files" \
    "$ANIMAMA_DATA_HOST_PATH/staging/uploads" \
    "$ANIMAMA_DATA_HOST_PATH/staging/imports" \
    "$ANIMAMA_DATA_HOST_PATH/staging/exports" \
    "$ANIMAMA_DATA_HOST_PATH/internal/operations" \
    "$ANIMAMA_DATA_HOST_PATH/internal/runtime" \
    "$ANIMAMA_DATA_HOST_PATH/internal/derivatives" \
    "$ANIMAMA_DATA_HOST_PATH/internal/reconciliation" \
    "$ANIMAMA_DOCLING_CACHE_HOST_PATH" \
    "${script_dir}/.animama-logs"
}

HOST_UID="${HOST_UID:-$(id -u)}"
HOST_GID="${HOST_GID:-$(id -g)}"
export HOST_UID HOST_GID

# Validate the fully rendered graph before stopping or changing this stack.
# The validator consumes the configuration without echoing environment values.
if ! compose --profile "*" config --format json | python3 "${script_dir}/scripts/validate_local_compose.py"; then
  exit 2
fi
if ! tool_ports="$(compose config --format json | python3 "${script_dir}/scripts/validate_local_compose.py" --check-ports --print-tool-ports)"; then
  exit 2
fi
DEV_TOOLS_ENABLED=false
read -r selected_pgadmin_port selected_dozzle_port <<< "$tool_ports"
if [ "$selected_pgadmin_port" != "-" ] && [ "$selected_dozzle_port" != "-" ]; then
  DEV_TOOLS_ENABLED=true
  PGADMIN_PORT="$selected_pgadmin_port"
  DOZZLE_PORT="$selected_dozzle_port"
  PGADMIN_URL="http://localhost:${PGADMIN_PORT}"
  DOZZLE_URL="http://localhost:${DOZZLE_PORT}"
  export PGADMIN_PORT DOZZLE_PORT PGADMIN_URL DOZZLE_URL
fi

prepare_host_roots
write_stack_env_file

echo "🔄 Starting local stack..."
echo "Animama: ${ANIMAMA_PUBLIC_ORIGIN}"
echo "Compose profiles: ${COMPOSE_PROFILES:-none}"
if [ -n "$PROJECT_NAME" ] && [ "$PROJECT_NAME" != "animama" ] && [ "$BASE_PORT_REQUESTED" = false ]; then
  echo "⚠️  Named stack is using default host ports. Use --base-port to run alongside other stacks."
fi

# Step 1: Stop this Compose project without deleting durable state.
echo "📦 Stopping Docker containers..."
# Include inactive profiles to close listeners from previously enabled tools.
compose --profile "*" down --remove-orphans

# Step 2: Purge only when explicitly requested. Overrides are refused above,
# so every filesystem target is derived from the selected validated stack.
if [ "$PURGE_REQUESTED" = true ]; then
  volume_project="${PROJECT_NAME:-$(sanitize_name "$script_name")}"
  DATA_VOLUMES=(postgres-data pgadmin-data)
  VOLUME_NAMES=()
  for volume in "${DATA_VOLUMES[@]}"; do
    VOLUME_NAMES+=("${volume_project}_${volume}")
  done

  echo "🗑️  Purging selected stack state:"
  printf '  volume: %s\n' "${VOLUME_NAMES[@]}"
  printf '  local content: %s\n' "$ANIMAMA_LOCAL_CONTENT_HOST_PATH"
  printf '  private data: %s\n' "$ANIMAMA_DATA_HOST_PATH"
  docker volume rm "${VOLUME_NAMES[@]}" 2>/dev/null || echo "⚠️  Some volumes may not exist yet"

  if [ "$STACK_STORAGE_KEY" = "default" ]; then
    find "$ANIMAMA_LOCAL_CONTENT_HOST_PATH" -mindepth 1 -maxdepth 1 ! -name README.md -exec rm -rf -- {} +
    find "$ANIMAMA_DATA_HOST_PATH" -mindepth 1 -maxdepth 1 ! -name README.md -exec rm -rf -- {} +
  else
    rm -rf -- "$DERIVED_STACK_ROOT"
  fi
  prepare_host_roots
else
  echo "💾 Preserving PostgreSQL, Local content, and private data (use --purge to delete this stack only)."
fi

# Step 3: Optionally build requested images, then start containers
if [ "$BUILD_REQUESTED" = true ]; then
  if [ "${#BUILD_SERVICES[@]}" -gt 0 ]; then
    echo "🏗️  Building Docker services: ${BUILD_SERVICES[*]}"
    compose build "${BUILD_SERVICES[@]}"
  else
    echo "🏗️  Building Docker services..."
    compose build
  fi
fi

echo "🚀 Starting private PostgreSQL..."
compose up -d postgres

echo "⏳ Waiting for database to be ready..."
database_attempt=1
while [ "$database_attempt" -le 60 ]; do
  if compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
    break
  fi
  if [ "$database_attempt" -eq 60 ]; then
    echo "❌ PostgreSQL did not become ready within 120 seconds." >&2
    compose ps >&2
    exit 1
  fi
  database_attempt=$((database_attempt + 1))
  sleep 2
done

# Step 4: Use the same serialized schema and seed bootstrap as desktop.
echo "🔨 Bootstrapping database schema and catalogs..."
# Use a one-off backend container because the long-running FastAPI process stays
# fail-closed until this migration creates the installation principal.
compose run --rm --no-deps --build animama-server python -m animama.server.db_bootstrap --quiet

echo "🚀 Starting private services and the ${ANIMAMA_WEB_BUILD_MODE} application..."
compose up -d

# FastAPI owns accountless admission after bootstrap. In development, check it
# through Vite's public proxy as well as the served React document.
echo "⏳ Waiting for the application and installation bootstrap..."
ready_attempt=1
while [ "$ready_attempt" -le 90 ]; do
  if [ "$ANIMAMA_WEB_BUILD_MODE" = development ]; then
    ready_command=(web node scripts/check-compose-ready.mjs)
  else
    ready_command=(animama-server python -c '
import os, urllib.parse, urllib.request
host = urllib.parse.urlsplit(os.environ["ANIMAMA_PUBLIC_ORIGIN"]).netloc
for path, content_type in (("/health", "application/json"), ("/", "text/html")):
    request = urllib.request.Request(
        "http://127.0.0.1:8000" + path, headers={"Host": host, "Accept": content_type}
    )
    with urllib.request.urlopen(request, timeout=2) as response:
        if response.status != 200 or response.headers.get_content_type() != content_type:
            raise SystemExit(1)
')
  fi
  if compose exec -T "${ready_command[@]}" >/dev/null 2>&1; then
    break
  fi
  if [ "$ready_attempt" -eq 90 ]; then
    echo "❌ Application or installation bootstrap did not become ready after 90 checks. Inspect the stack logs." >&2
    compose ps >&2
    exit 1
  fi
  ready_attempt=$((ready_attempt + 1))
  sleep 2
done

# Keep a command-level reconciliation as an observable repair check after the
# startup bootstrap. It resolves the generated installation principal itself.
echo "📚 Verifying accountless content reconciliation..."
compose exec -T animama-server python -m animama.server.content_cli

# Step 7: Clear today's log file (best-effort with permission fallbacks)
echo "🧹 Clearing today's log file..."
log_dir="${script_dir}/.animama-logs"
today_log="${log_dir}/$(date +%F).log"

if [ -d "$log_dir" ]; then
  if [ -f "$today_log" ]; then
    set +e  # don't exit on failure in this block
    # 1) Try truncating
    : > "$today_log"
    rc=$?
    if [ $rc -ne 0 ]; then
      echo "⚠️  Truncate failed; attempting delete: ${today_log}"
      rm -f "$today_log"
      rc=$?
    fi
    # 2) If still failing, try adding write permission then truncate
    if [ $rc -ne 0 ]; then
      chmod u+w "$today_log" 2>/dev/null
      : > "$today_log"
      rc=$?
    fi
    # 3) If still failing, use sudo to delete
    if [ $rc -ne 0 ]; then
      echo "🔐 Using sudo to remove ${today_log} (you may be prompted for your password)"
      sudo rm -f "$today_log"
      rc=$?
    fi
    # 4) As a last resort, take ownership of the log directory and retry delete
    if [ $rc -ne 0 ]; then
      echo "🔧 Trying to take ownership of ${log_dir} and remove today's log"
      sudo chown -R "$(id -u)":"$(id -g)" "$log_dir" 2>/dev/null
      rm -f "$today_log" 2>/dev/null || :
      rc=$?
    fi
    set -e  # restore strict mode

    if [ $rc -eq 0 ]; then
      echo "🧼 Cleared ${today_log}"
    else
      echo "❗ Unable to clear or delete ${today_log}. Try manually running:"
      echo "   sudo rm -f '${today_log}'"
    fi
  else
    echo "ℹ️  No log file to clear at ${today_log}"
  fi
else
  echo "ℹ️  Log directory not found at ${log_dir}; skipping log clearance."
fi

echo "✅ Local stack ready!"
echo "Animama: ${ANIMAMA_PUBLIC_ORIGIN}"
if [ "$DEV_TOOLS_ENABLED" = true ]; then
  echo "pgAdmin (local development only): ${PGADMIN_URL}"
  echo "Dozzle (local development only): ${DOZZLE_URL}"
fi

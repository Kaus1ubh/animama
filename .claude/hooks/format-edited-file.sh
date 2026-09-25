#!/usr/bin/env bash
# PostToolUse hook: format the file Claude just edited with the repository's
# own formatter. Python uses ruff; frontend sources use the workspace prettier
# config. A formatter failure exits 2 so Claude sees it; missing dependencies in
# a fresh worktree skip formatting silently.
set -uo pipefail

file_path="$(jq -r '.tool_input.file_path // empty')"
[ -n "$file_path" ] && [ -f "$file_path" ] || exit 0

repo_root="${CLAUDE_PROJECT_DIR:-$(git -C "$(dirname "$file_path")" rev-parse --show-toplevel 2>/dev/null)}"
frontend_root="$repo_root/src/frontend"

case "$file_path" in
  *.py)
    ruff="$repo_root/.venv/bin/ruff"
    [ -x "$ruff" ] || exit 0
    output="$(cd "$repo_root" && "$ruff" format "$file_path" 2>&1)" || {
      echo "ruff format failed for $file_path: $output" >&2
      exit 2
    }
    ;;
  "$frontend_root"/*.ts | "$frontend_root"/*.tsx | "$frontend_root"/*.mts | "$frontend_root"/*.cts)
    # Each package resolves prettier and its Tailwind plugin from its own deps.
    case "$file_path" in
      "$frontend_root"/desktop/*) package_root="$frontend_root/desktop" ;;
      *) package_root="$frontend_root/web" ;;
    esac
    prettier="$package_root/node_modules/.bin/prettier"
    [ -x "$prettier" ] || exit 0
    output="$(cd "$package_root" && "$prettier" --config ../prettier.config.mjs \
      --ignore-path ../.prettierignore --write --log-level warn "$file_path" 2>&1)" || {
      echo "prettier failed for $file_path: $output" >&2
      exit 2
    }
    ;;
esac
exit 0

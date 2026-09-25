#!/usr/bin/env bash
# PostToolUse hook: format the file Claude just edited with the repository's
# own formatter. Python uses ruff; frontend sources use the workspace prettier
# config. A formatter failure exits 2 so Claude sees it; missing dependencies in
# a fresh worktree skip formatting silently.
set -uo pipefail

file_path="$(jq -r '.tool_input.file_path // empty')"
[ -n "$file_path" ] && [ -f "$file_path" ] || exit 0

# Use the edited file's own checkout so a session rooted elsewhere still formats
# worktree files with that worktree's dependencies.
repo_root="$(git -C "$(dirname "$file_path")" rev-parse --show-toplevel 2>/dev/null)" || exit 0
frontend_root="$repo_root/src/frontend"

case "$file_path" in
  "$repo_root"/*.py)
    ruff="$repo_root/.venv/bin/ruff"
    [ -x "$ruff" ] || exit 0
    output="$(cd "$repo_root" && "$ruff" format "$file_path" 2>&1)" || {
      echo "ruff format failed for $file_path: $output" >&2
      exit 2
    }
    ;;
  # Only web/ and desktop/ sources are covered by `pnpm prettier:check`.
  "$frontend_root"/web/*.ts | "$frontend_root"/web/*.tsx | "$frontend_root"/web/*.mts | "$frontend_root"/web/*.cts | \
  "$frontend_root"/desktop/*.ts | "$frontend_root"/desktop/*.tsx | "$frontend_root"/desktop/*.mts | "$frontend_root"/desktop/*.cts)
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

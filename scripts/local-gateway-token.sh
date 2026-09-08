#!/usr/bin/env bash

# Shared gateway-token lifecycle. Source this file; it never prints the token.

animama_gateway_token_prepare() {
  local token_path="$1"
  local token_dir
  local temporary_token
  local token_value
  token_dir="$(dirname "$token_path")"

  (
    umask 077
    mkdir -p "$token_dir"
    chmod 700 "$token_dir"

    if [ -L "$token_path" ]; then
      printf 'Internal gateway token must not be a symlink\n' >&2
      return 1
    fi
    if [ -e "$token_path" ]; then
      if [ ! -f "$token_path" ]; then
        printf 'Internal gateway token must be a regular file\n' >&2
        return 1
      fi
      token_value="$(cat "$token_path")"
      if [[ ! "$token_value" =~ ^[a-fA-F0-9]{64}$ ]]; then
        printf 'Internal gateway token is malformed; rotate it while the stack is stopped\n' >&2
        return 1
      fi
      chmod 600 "$token_path"
      return
    fi

    temporary_token="$(mktemp "${token_dir}/.gateway-token.XXXXXX")"
    trap 'rm -f -- "$temporary_token"' EXIT INT TERM
    chmod 600 "$temporary_token"
    openssl rand -hex 32 > "$temporary_token"
    mv -f -- "$temporary_token" "$token_path"
    trap - EXIT INT TERM
  )
}

animama_gateway_token_rotate() {
  local token_path="$1"
  if [ -L "$token_path" ]; then
    printf 'Internal gateway token must not be a symlink\n' >&2
    return 1
  fi
  if [ -e "$token_path" ] && [ ! -f "$token_path" ]; then
    printf 'Internal gateway token must be a regular file\n' >&2
    return 1
  fi
  rm -f -- "$token_path"
  animama_gateway_token_prepare "$token_path"
}

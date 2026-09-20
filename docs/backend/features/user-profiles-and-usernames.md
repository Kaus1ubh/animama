# Local User Profile

The accountless local composition keeps one private personalization record for
the generated installation principal. It is not an account, credential, public
creator profile, or Discover identity.

## Data Contract

`user_profiles` contains only:

- `user_id`, the retained owner column keyed by the installation principal;
- nullable `display_name`, limited to 80 Unicode characters after whitespace
  normalization (null is a pre-setup bootstrap placeholder only);
- `created_at` and `updated_at` timestamps.

Saved display names must be nonblank; missing, null, empty, all-whitespace, and
overlong inputs are rejected with HTTP 422. The local schema has no username,
claim history, biography, visibility, alias, cooldown, deletion, email, or
profile-image fields. Those public identity concepts belong to a future hosted
Animama account service and must not be matched to local personalization.

## Bootstrap And First Run

`OwnerBootstrapService` accepts an explicit owner ID and a composition-supplied
`OwnerProfileBootstrapPort`. The local adapter idempotently creates the missing
profile without teaching the shared service about `installation_settings`.

The same owner bootstrap ensures settings, configured Starter Animas and
receipts, and the initial user-scope `PROFILE.md`. That memory document carries
closed `installation_bootstrap` metadata containing template version `1` and
the managed entry version. Existing profile data, settings, Starter state, and
memory content are never overwritten by bootstrap retries.

`POST /v1/runtime/onboarding:complete` requires a nonblank display name. In one
transaction it locks installation settings, the profile, and `PROFILE.md`; saves
the normalized display name; updates only the template's preferred-name line
when the metadata, version, and expected content still match; appends the normal
memory version; and writes `first_run_completed_at` once. A pre-commit failure
rolls the whole operation back. Replaying a response lost after commit returns
the completed state without adding another memory version.

Runtime context reports first run complete only when the timestamp and a
nonblank stored name both exist. An installation with a completion timestamp
but no name opens setup; adding a name retains its principal, content, and
original completion timestamp. The nullable bootstrap column is not a supported way to
clear an already chosen name.

If the person edits `PROFILE.md` directly, its content no longer matches the
managed template. Later display-name changes update private UI personalization
only and preserve that memory edit.

## HTTP API

All routes resolve the owner from `RequestPrincipal`; clients never submit a
`user_id`.

- `GET /v1/users/me/profile` returns `{ "display_name": string | null }`.
- `PATCH /v1/users/me/profile` requires a nonblank `display_name` and is
  available after first-run completion.
- `GET /v1/runtime-context` includes the same display name with bounded local
  bootstrap and first-run state.
- `POST /v1/runtime/bootstrap:ensure` retries missing defaults.
- `POST /v1/runtime/onboarding:complete` completes first run atomically.

The local HTTP boundary admits requests for the
bootstrap-established installation owner before these handlers run.

## Ownership And Testing

Keep `user_id` as an opaque owner key and filter every profile read/write by the
resolved principal. Tests override `get_current_principal` through FastAPI's
dependency system. There is no auth bypass environment variable or test owner
header.

The future hosted composition may implement `OwnerProfileBootstrapPort` with a
central profile service keyed by its hosted Better Auth user ID. It must use a
separate database and cannot replace or rekey the local installation principal.

# Local Profile

The accountless backend profile is private personalization for one installation.
It contains only a private display name, normalized to at most 80 Unicode
characters. It has no username, biography, visibility, alias, public creator
lookup, credential, or hosted-account link.

The backend exposes `GET /v1/users/me/profile` and
`PATCH /v1/users/me/profile`, plus the local runtime/bootstrap endpoints used by
first run. The generated installation principal owns the row but is not a
secret or public identity.

On first run, `/setup` asks “What should Animama call you?” and accepts a
required nonblank display name up to 80 characters. Continue stores the
normalized name; there is no Skip action. Provider keys and optional downloads
remain optional. Completion is idempotent and controlled by backend runtime
context rather than browser storage. The bootstrap placeholder may be null
before setup. An earlier skipped setup reopens for a name without resetting data.

After setup and on future root launches, `/a` opens `/a/$animaId` for the last
visited owned Anima, or the first in creation order (Annie on a fresh install).
Saved settings and the owned list must load before selecting a fallback. A
deleted selection falls back to the first remaining Anima; an empty list opens
creation. Explicit deep links are preserved.

After setup, `SidebarUserMenu` shows the display name or “You.” Its **App Settings**
action opens the General section with a **Display Name** editor. The editor reads
and patches only that private field, rejecting blank names rather than clearing
it. Save appears beside the input only when the normalized name has changed,
and updates the sidebar name. Closing settings discards unsaved edits. “You” is only a
defensive loading/missing-profile label. There is no separate Personalization action. There is no local handle,
creator page, avatar account image, account settings, sign-in, or logout.

The installation bootstrap service owns initial profile and `profile.md`
creation. Later profile changes update the bootstrap-managed preferred-name line
in the same guarded backend transaction; a person's direct edit to that line
wins. This private display name is not a hosted identity or public creator
handle.

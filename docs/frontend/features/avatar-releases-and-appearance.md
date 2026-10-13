# Avatar Content And Appearance

Avatars and Appearance Images use Included/Local typed catalog items. Reviewed
loadout commands select logical items. A mounted runtime
pins exact revisions and adopts later source edits only after remount.

The Anima management Appearance dialog edits Profile and Background as
independent typed bindings. It can save a Local Appearance Image and frame it
with Fill/Fit, focal point, and zoom before a reviewed loadout commit. Upload
failure never changes the loadout; Cancel discards unsaved framing. Removing a
profile override permits the registered Avatar portrait fallback. Background
offers App background (the default), None, or a Local image. With no bound
image, chat and the Anima page draw the themed app stage image from
`public/background/`; None is stored per Anima as
`preferences.presentation.disable_background` and leaves the plain theme
background. Included
portraits and Local images use protected catalog delivery, not public storage
URLs.

The browser has reusable VRM capture primitives and a development-only
`/avatar-portrait-debug` harness. The Create Anima journey selects an Avatar
and submits null Profile and
Background bindings; it does not capture or save portraits. Browsing Avatar
cards alone saves nothing. Appearance management and the typed portrait API
remain separate from creation. Background Default means the normal app stage.

`/animas/new` accepts a logical Avatar handoff, with a saved draft taking
precedence. Confirmed uploads survive cancellation; unsaved files require
reselection after reload. See the
[live creation guide](custom-anima-creation.md) and its
[acceptance status](custom-anima-creation.md#acceptance-and-regression-coverage).

# Using the Scene Effect creator

The creator is at `/scene-effects/new` and `/scene-effects/<item>/edit` (also
from the Effects template picker: the sidebar's Create menu **Effects**, the
Create page's Scene FX card or `/effects/new`; `/scene-effects/new?template=<id>`
starts an unsaved draft from a template). It edits one portable
`animama/scene-effect-editor/1` document, previews it with the production
Scene layers around a preview Avatar, and saves one Local item. It never
changes the live chat scene or equips anything.

## Layout

- **Header:** the name (**Scene FX name**), New, Load, Import, View JSON,
  Undo/Redo, the validation indicator and **Save**.
- **Scene Setup** (left): the kind (**Background** or **Focus Lines**), a
  starting template, then for backgrounds the layer cards front to back:
  Entry flash, Scatter 1–3, Marquee, Screen, Tile, Pattern, Gradient, Solid.
  Each card has an **<Layer> enabled** switch and opens its inspector; **Add
  scatter layer** adds up to three. Below: **Duration (s)** or **Sticky**
  (held), **Cover UI overlays**, **Dismiss on input**, **Sound when applied**
  and **Description**.
- **Inspector** (right): the selected layer's fields, named as in
  [layers](layers.md) (for example *Seconds per turn (0 still)*, *Keep the
  face clear*, *Pulse*). Ranges are enforced as you type; a field outside its
  range blocks Save and names the field.

## Items and images

Marquee and scatter inspectors list their items with move up/down and remove
buttons, a sticker picker (Animama's built-in stickers by family, with
thumbnails; a chosen sticker's PNG is added as the Scene's own image, labelled
with the sticker's name) and **Add private image**; the Tile
inspector has **Choose tile image** / **Replace tile image**. A chosen image
is checked before it is decoded (8 MiB, 4096 px, 16 images and 32 MiB per
Scene; PNG, JPEG, WebP or restricted static SVG) and saved under a name made
from its file name (letters, digits, `.`, `_`, `-`) with the extension of its
bytes. When that name matches an image the document shows but has no bytes
for (after an import or a recovery without images), the file fills every use
of it, whichever image input was used; otherwise it is added as a new item
(bytes the Scene already carries, such as a sticker added twice, are reused).
An old Scene's `emoji` item (Twemoji, no longer provided) shows as *Missing
emoji* with a prompt to replace or remove it, and blocks Save until it is.
The creator is busy (inputs and Import disabled) until each image is placed.

## Import and export

**View JSON** shows the portable document (logical image names and exact
sound sources, never Blob URLs) and can open it in **Import**. **Import**
(*Import Scene Effect JSON*, textbox *Creator JSON*, **Import document**)
replaces the document after the unsaved-change confirmation. Imported images
have no bytes: the creator says to reselect them, and Save refuses until each
is chosen. `pnpm -s effects save` builds this document from an effect folder
and chooses the images for you.

## Save, reopen and recovery

Save sends the definition, the referenced images, sound dependencies and the
authoring document; the backend validates the definition against the shared
limits and the images, then writes the readable Local folder. A new item
moves to its edit route. Unsaved work is kept in browser recovery (images in
IndexedDB when possible); a recovery without images asks for them again.
Discarding recovery never changes the saved item.

## Hand-off

Report the saved name and edit URL, and distinguish creator preview, save and
reopen, Library preview, Action playback and live chat playback.

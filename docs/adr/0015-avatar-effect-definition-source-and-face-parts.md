# 0015: One Avatar Effect definition source and model-agnostic face parts

- Status: accepted
- Recorded: 2026-10-07
- Retrospective: no
- Original decision date: 2026-10-06 (owner decisions and accepted proposals in
  [issue #298](https://github.com/raymond-van/animama/issues/298)); the
  implementation choices were made in planning the same day and confirmed in
  delivery
- Decision basis: [issue #298](https://github.com/raymond-van/animama/issues/298)
  and the [execution plan](../plans/avatar-effects-v2/avatar-effects-v2-execplan.md)
  (Decision Log items 1, 3 and 5)

## Context

The `animama/avatar-effect/1` definition had its fields and enums copied in four
places: the runtime types, the frontend catalog parser, the backend export
validator and the creator. The copies had drifted. The export validator omitted
three fields the creator always wrote, so those effects could not be exported;
Save stored definitions unchecked; and the frontend parser never checked the
schema string. `/1` could also express only face textures, three face decals
and hover planes at fixed positions.

Effects found the face by matching VRoid-style material names. The VRM
specification does not define material names, so a valid model from another
tool could show no effects, and a user had no way to fix that.

The owner decided (2026-10-06) to replace `/1` with a richer `/2` definition,
convert existing effects once rather than read `/1` permanently, find face parts
without relying on material names, and let the user correct a part with the
correction saved with the Avatar.

## Decision

1. **One definition source.** Strict Pydantic models in
   `app/contracts/avatar_effect.py` (`extra="forbid"`, literal enums, an
   attachment union discriminated by `kind`, numeric bounds) define
   `animama/avatar-effect/2`. They type the Avatar Effect API projections, so
   OpenAPI and `pnpm openapi-ts` generate the TypeScript types and zod
   validators that the frontend runtime and creator use. Backend Save, preview,
   loadout and package import and export validate with the same models. Shared
   fixtures prove that both sides agree.
2. **Direct conversion.** One Python converter turns `/1` into `/2`. Local
   content converts in place through the content transition (at startup, on
   Rescan or with `content_cli`), keeping content IDs and the original bytes;
   Included content was converted in the repository with a script. Afterwards
   `/1` is refused everywhere with a hint naming the conversion. Packages are
   not converted, because their manifest and digests cover the original bytes.
3. **Face parts from VRM signals.** The frontend detects face skin, each iris,
   eye highlights, eye lines, eyelashes and hair from humanoid eye bones, skin
   weights, the meshes that the `blink` and `aa` expressions morph, and
   spring-bone joints. Material names are only a per-part fallback. Each part
   records its source and confidence, and an effect whose part is missing is
   skipped with a diagnostic rather than failing its Action.
4. **Corrections saved with the Avatar.** A correction names glTF primitives by
   `node:mesh:primitive` keys and records the VRM file's sha256, so it applies
   only to those exact bytes. A Local Avatar keeps it in its `.meta.json`
   sidecar; an Included Avatar, which is read-only, gets an owner-scoped
   database override bound to its revision. Packages carry the correction with
   the Avatar.

## Alternatives considered

- **A hand-written JSON Schema file** as the definition source. It would need
  new validators on both sides and would not type the API models.
- **Reading `/1` permanently** beside `/2`. Every consumer would keep two
  parsers, and the drift that caused the export bug would continue.
- **A new `<name>.avatar.json` descriptor** for corrections on Local Avatars.
  The content scanner would ignore it; the existing sidecar already changes
  the Avatar's revision.
- **Writing corrections into Included Avatars.** Included content is read-only
  and shared by every installation.
- **Material-name matching only**, with per-model profiles. It cannot cover
  models from other tools and gives users no fix.

## Consequences

- A definition change is made once in the contract, then the SDK is
  regenerated; frontend enums derive from the generated types.
- Every Avatar Effect that can be saved can be exported.
- Installations and packages holding `/1` content must convert before use;
  conversion is deterministic, idempotent and keeps originals.
- Detection matched the old name matching on both Included Avatars with names
  disabled. Other models may still need a user correction, and detection is
  tuned only on those two Avatars.
- Replacing a Local Avatar's VRM bytes or updating an Included Avatar
  invalidates its correction, which is then ignored rather than applied to the
  wrong model.
- The new `avatar_face_part_overrides` table is in the development baseline
  without an Alembic revision, so existing development databases are reset.

## Evidence

- [Avatar VFX guide](../frontend/runtime/avatar-vfx.md): the `/2` definition,
  conversion, face parts and corrections as implemented.
- `src/backend/animama/app/contracts/avatar_effect.py` and
  `avatar_face_parts.py`: the contracts.
- `src/frontend/web/src/lib/avatar/vfx/faceParts.ts`: detection and its tests on
  both Included Avatars.
- [Local content storage](../backend/architecture/local-content-storage.md) and
  [face-part corrections](../backend/features/custom-animas-and-content.md#face-part-corrections):
  the conversion transition and correction storage.

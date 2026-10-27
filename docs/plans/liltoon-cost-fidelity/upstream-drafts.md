# Upstream drafts: three-liltoon and Mochiya Avatar Tools

Drafts for [the ExecPlan's](liltoon-cost-fidelity-execplan.md) Phase 6
(R5). Nothing here is posted until the owner approves the exact text; the
owner chooses where each goes. Figures come from the plan's check records.
Each text stands alone, so each names the versions it was found on.

## three-liltoon A: Opaque passes keep blending enabled

**Title:** Opaque forward and outline passes keep blending enabled, which
blocks hidden-surface removal

Found on three-liltoon 0.1.9 (lilToon `2.3.4-3-g72fc096`).

`applyLilToonPassState` maps lilToon's opaque blend state (colour
`Blend One Zero`, alpha `One OneMinusSrcAlpha`) to `CustomBlending`. lilToon's
opaque forward and outline passes write alpha 1 (`lil_pass_forward_normal.hlsl`
with `LIL_RENDER == 0`), so this blend replaces the target exactly. Leaving
blending enabled still stops tile-based GPUs from removing hidden surfaces and
stops applications from covering these passes with a depth pre-pass.

Measured on an Apple M5 (Chromium, ANGLE Metal, device pixel ratio 2, MSAA)
with a converted VRChat avatar that has six opaque lilToon materials, frames
rendered back to back to keep the GPU at its top clock, scenarios
alternating within one run: with the outlines unblended in every scenario,
unblending the opaque surfaces as well took 7% off the frame, and adding a
depth pre-pass that covers them brought it to 43% of the frame with the
surfaces blended. Unblended alone rendered the same frame with 0 differing
RGB or alpha bytes over 380,619 covered pixels (SwiftShader). In a second
run alternating the unpatched package with our patched build (this change
and those in issues B and D, with issue C's outline fallback in our loader)
plus that pre-pass, the frame took 4.6–4.8 ms
against 9.1–9.3 ms (absolute times vary between runs; the ratio held across
rounds).

Proposal: after `applyLilToonRenderState`, use `NoBlending` for the
`forward` and `outline` passes in `opaque` render mode when the colour blend
is Add One/Zero and the alpha blend is Add One with Zero or
OneMinusSrcAlpha, and reapply it on `setProperty`. Cutout, transparent and
custom blends are unchanged. We carry this as a local patch and can open a
pull request with tests (construction, `setProperty`, outline overrides,
cutout and transparent unchanged).

## three-liltoon B: Morph-weight texture reallocated on every draw

**Title:** Shared materials reallocate the morph-weight texture on every draw

Found on three-liltoon 0.1.9.

`MorphWeights` keeps one texture per material and resizes it to the drawn
mesh's target count. When meshes with different counts share a material
(in a converted VRChat avatar, two materials were each shared by meshes with
155 and 36, and 155 and 20, morph targets), every draw disposes a texture,
creates one and uploads it mid-pass.

Proposal: key the weight texture by mesh (a `WeakMap`), so unchanged weights
upload nothing and `dispose()` releases every mesh's texture. With that
change a timed frame went from six `createTexture`, six `deleteTexture` and
fourteen `texSubImage2D` calls to none, none and eight (the bone textures),
with 0 differing pixels across an animated face loop.

The same alternation flips `MORPHTARGETS_COUNT` in `updateThreeMorphDefines`
on every draw, which marks the material for program re-selection each time
(CPU work). Keying the define by geometry, or one material copy per
morph-target count, would avoid it. Separately, a prototype that read
weights from uniforms in the surface pass when the count fits cut the frame's
vertex time by about 40% (about 6% of the frame) in one GPU trace taken
before the change in issue A; it could be offered as an option.

## three-liltoon C: Outline vertex-colour modes without COLOR_0

**Title:** Outline vertex-colour modes read white when the geometry has no
`COLOR_0`

Found on three-liltoon 0.1.9.

With `_OutlineVertexR2Width` = 2, lilToon takes the outline direction from
`color.rgb * 2 - 1` (a tangent-space normal) and the width from `color.a`.
When a mesh has no `COLOR_0`, the vertex input compiles `color` as
`vec4(1.0)`, so the outline is pushed along tangent + bitangent + normal at
about 1.7 times its width and shows through thin parts such as hair tips.
Unity behaves the same way without vertex colours, but current VRM exports
drop them, so on the web the missing data is the common case.

Proposal: when a material uses mode 2 and its geometry lacks `color`, warn
and optionally fall back to mode 0 (the mesh normal). Animama does this in
its loader. Mode 1 needs no fallback: without colours it keeps the normal
direction at full width, as Unity does for such a mesh.

## three-liltoon D: Directionless ambient makes OpenLit's indirect light undefined

**Title:** `normalize` of a zero SH direction makes indirect light undefined

Found on three-liltoon 0.1.9 (lilToon `2.3.4-3-g72fc096`).

The web lighting ABI supplies only the SH constant term (`unity_SHA*.w`), so
`unity_SHA*.xyz` is zero. OpenLit's `ShadeSH9ToonDouble`
(`openlit_core.hlsl`) computes its dominant direction with
`N = normalize(olSHAr.rgb + olSHAg.rgb + olSHAb.rgb);`, where `olSHA*` are
copied from `unity_SHA*` (12 places in the generated vertex shaders). That
is `normalize(vec3(0))`: undefined in
GLSL and NaN in practice. Indirect light then depends on the GPU's NaN
handling; materials with `_ShadowEnvStrength` lose the environment lift of
their shadows on some backends.

Proposal: use no direction when the sum is zero,
`dot(S, S) < 1e-12 ? vec3(0.0) : normalize(S)`, which gives the constant term,
the limit Unity reaches as the SH direction vanishes. We apply this guard to
the generated GLSL in a local patch; upstream it belongs where the shaders
are generated (the OpenLit include, a compatibility define or the
translation step). Optionally derive an L1 term from a `HemisphereLight` so
materials see a sky and ground direction as in Unity scenes. On a converted
avatar compared with Unity (near-flat ambient, matched camera and key light,
640x800), the share of pixels differing by more than 8 of 255 in a
three-quarter face view fell from 10.8% to 3.0%, and shadowed hair and
sleeves now match.

A related edge case: the light direction
`normalize(SH direction + main light direction * luminance + override)` is
also zero when there is no directional light and an authored
`_LightDirectionOverride` is zero (the default (0.001, 0.002, 0.001, 0)
avoids it), and `normalize(override * M) * length(override)` is NaN for a
zero override with `w != 0`. The same guard would cover both.

## three-liltoon E: MatCap band missing on a converted hair material

**Title:** Question: additive MatCap on a hair material draws nothing

Found on three-liltoon 0.1.9.

On a converted avatar, Unity draws a soft additive MatCap band on the hair
(+3 to +10 of 255) that three-liltoon does not. The material uses an additive
MatCap (`_UseMatCap` 1, `_MatCapBlendMode` 1) with lighting, a shadow mask,
the back-face mask, Z-rotation cancelling and UV1 blending
(`_MatCapBlendUV1`) enabled, without perspective correction, and its
`_MatCapTex` and `_MatCapBlendMask` textures are in the file. Restoring the
second UV set (`TEXCOORD_1`) and removing the blend mask both left the render
unchanged. Is this combination expected to draw, and is there a way to
confirm that the MatCap term is reached?

## Mochiya Avatar Tools: exports drop data lilToon materials read

**Title:** VRM exports drop vertex colours, the second UV set and authored
blendshape weights

Found with Mochiya Avatar Tools 0.1.4 and UniVRM 0.131.2.

VRM exports through UniVRM's VRM 1.0 writer (`MeshWriter.ExportMeshDivided`)
keep positions, normals, the first UV set, skinning and morph targets only;
`VRM10ExportSettings.MeshExportSettings` returns a new `GltfExportSettings`
without `ExportVertexColor` or `ExportUvSecondary`, and Mochiya's default
export profile (`DefaultMochiyaExportProfile`) leaves both off; a test export
with the profile changed to set vertex colours still had no `COLOR_0`.
lilToon materials read:

- vertex colours for outline width and direction (`_OutlineVertexR2Width` 1
  and 2; authors bake smoothed hair normals into them) and for fur vectors;
- the second UV set for MatCap UV blending (`_MatCapBlendUV1`, often used for
  hair highlights) and other UV1 features;
- authored SkinnedMeshRenderer blendshape weights (for example a shape key
  that keeps an accessory clear of clothing), which VRM rest data drops.

On a converted avatar these show as dark outline patches at hair tips and
accessories under clothing.

Proposal: export the colours and the second UV set for meshes whose lilToon
materials use them (as `COLOR_0` and `TEXCOORD_1`, or as attributes named in
`MOCHIYA_materials_liltoon` so glTF fallback materials stay untinted), and
bake or record non-zero authored blendshape weights (glTF `mesh.weights`).

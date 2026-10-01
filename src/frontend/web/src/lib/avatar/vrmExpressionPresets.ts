import { VRMExpressionPresetName, type VRM } from "@pixiv/three-vrm";

const PRESET_NAME_BY_LOWERCASE = new Map<string, string>(
  Object.values(VRMExpressionPresetName).map((name) => [
    name.toLowerCase(),
    name,
  ]),
);

/**
 * Give VRM1 preset names to custom expressions that stand in for them.
 *
 * VRM0 has no preset slot for some VRM1 presets, notably `surprised`, so
 * exporters such as VRoid store them as custom expressions (`preset: unknown`)
 * named, for example, `Surprised`. three-vrm keeps that name verbatim and
 * expression lookups are case-sensitive, so content and emotion presets that
 * use the canonical name would not move the face. Each custom expression whose
 * case-insensitive name matches an unbound preset is re-registered under the
 * preset name. This applies to any VRM version; models that already bind the
 * preset are left unchanged.
 *
 * Call once after loading, before controllers read the expression list.
 *
 * @returns The applied renames, keyed by the original expression name.
 */
export function canonicalizeCustomPresetExpressions(
  vrm: VRM,
): Record<string, string> {
  const manager = vrm.expressionManager;
  if (!manager) return {};

  const renamed: Record<string, string> = {};
  // Copy: re-registration mutates the manager's expression list.
  for (const expression of [...manager.expressions]) {
    const originalName = expression.expressionName;
    const presetName = PRESET_NAME_BY_LOWERCASE.get(
      originalName.trim().toLowerCase(),
    );
    if (!presetName || presetName === originalName) continue;
    if (manager.getExpression(presetName)) continue;

    manager.unregisterExpression(expression);
    expression.expressionName = presetName;
    manager.registerExpression(expression);
    renamed[originalName] = presetName;
  }
  return renamed;
}

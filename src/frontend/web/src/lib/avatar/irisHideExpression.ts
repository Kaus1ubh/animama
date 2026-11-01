import {
  VRMExpression,
  type VRM,
  type VRMExpressionBind,
} from "@pixiv/three-vrm";

/**
 * `Fcl_EYE_Iris_Hide` on models without it (R4).
 *
 * VRoid shrinks the irises with a morph; other models have no such shape, but
 * Animama knows their iris parts (face part detection) and can hide them as
 * eye effects do. The expression is registered at load with a bind that only
 * reports whether it is held (weight at least {@link IRIS_HIDE_THRESHOLD});
 * `Avatar` connects that to its effect controller once the face parts exist.
 */

/** The weight from which `Fcl_EYE_Iris_Hide` hides the irises. */
export const IRIS_HIDE_THRESHOLD = 0.5;

export const IRIS_HIDE_EXPRESSION = "Fcl_EYE_Iris_Hide";

/** Reports `Fcl_EYE_Iris_Hide`'s held state to a listener, once per change. */
export class IrisHideBind implements VRMExpressionBind {
  private _weight = 0;
  private _hidden = false;
  private _listener: ((hidden: boolean) => void) | null = null;

  /** Who hides the irises; null until the Avatar's face parts exist. */
  setListener(listener: ((hidden: boolean) => void) | null): void {
    this._listener = listener;
    if (this._hidden) listener?.(true);
  }

  /**
   * Every manager update clears, then applies the expression's weight, so the
   * held state is decided here, once per update.
   */
  applyWeight(weight: number): void {
    this._weight += weight;
    const hidden = this._weight >= IRIS_HIDE_THRESHOLD;
    if (hidden === this._hidden) return;
    this._hidden = hidden;
    this._listener?.(hidden);
  }

  clearAppliedWeight(): void {
    this._weight = 0;
  }
}

const irisHideBinds = new WeakMap<VRM, IrisHideBind>();
const irisHideExpressions = new WeakSet<VRMExpression>();

/** Whether `registerIrisHideExpression` registered this expression. */
export function isIrisHideExpression(expression: VRMExpression): boolean {
  return irisHideExpressions.has(expression);
}

/**
 * Register `Fcl_EYE_Iris_Hide` on a model that has no expression or morph of
 * that name. Returns its bind (also on a repeated call), or null when the
 * model has its own.
 */
export function registerIrisHideExpression(
  vrm: VRM,
  ownFaceName: (name: string) => boolean,
): IrisHideBind | null {
  const manager = vrm.expressionManager;
  const existing = irisHideBinds.get(vrm);
  if (existing) return existing;
  if (!manager || ownFaceName(IRIS_HIDE_EXPRESSION)) return null;
  const bind = new IrisHideBind();
  const expression = new VRMExpression(IRIS_HIDE_EXPRESSION);
  expression.addBind(bind);
  manager.registerExpression(expression);
  irisHideBinds.set(vrm, bind);
  irisHideExpressions.add(expression);
  return bind;
}

/** The bind Animama registered for `Fcl_EYE_Iris_Hide`, if any. */
export function irisHideBindOf(vrm: VRM): IrisHideBind | null {
  return irisHideBinds.get(vrm) ?? null;
}

import type {
  Document as TransformDocument,
  GLTF as TransformGLTF,
} from "@gltf-transform/core";

import type { Avatar } from "./Avatar";
import { VRMDocument } from "./VRMDocument";
import {
  buildInspectionSnapshot,
  buildRuntimePrimitiveBindings,
  createEmptyVRMEditorSessionSnapshot,
  readRawJsonFromAvatar,
  toErrorMessage,
} from "./vrmEditorInspection";
import type {
  VRMEditorSessionInput,
  VRMEditorSessionSnapshot,
  VRMInspectionSourceMode,
  VRMInspectionSourceSummary,
  VRMRuntimePrimitiveBinding,
} from "./vrm-editor-types";
import type {
  AvatarVFXApplyMode,
  AvatarVFXCatalogEntry,
  AvatarFaceAnchoredVFXEntry,
  AvatarHoverVFXEntry,
  AvatarTextureVFXEntry,
} from "./vfx/types";

type RawGltf = TransformGLTF.IGLTF;
type RuntimePrimitiveBindingEntry = ReturnType<
  typeof buildRuntimePrimitiveBindings
>["entries"][number];
type SessionListener = () => void;

function cloneArrayBuffer(value: ArrayBuffer): ArrayBuffer {
  return value.slice(0);
}

function dedupeWarnings(values: string[]): string[] {
  return Array.from(
    new Set(
      values.map((value) => value.trim()).filter((value) => value.length > 0),
    ),
  );
}

function createFallbackSourceSummary(args: {
  sourceUrl: string | null;
  sourceKey: string | null;
}): VRMInspectionSourceSummary {
  return {
    sourceUrl: args.sourceUrl,
    sourceKey: args.sourceKey,
    byteLength: null,
    fetchedAtMs: null,
  };
}

function toRawJsonRecord(
  value: RawGltf | null,
): Record<string, unknown> | null {
  return value ? (value as unknown as Record<string, unknown>) : null;
}

export class VRMEditorSession {
  private readonly _avatar: Avatar;
  private readonly _sourceUrl: string | null;
  private readonly _sourceKey: string | null;
  private readonly _arrayBuffer: ArrayBuffer | null;

  private _document: VRMDocument | null = null;
  private _rawJson: RawGltf | null = null;
  private _transformDocument: TransformDocument | null = null;
  private _sourceMode: VRMInspectionSourceMode | null = null;
  private _sourceSummary: VRMInspectionSourceSummary;
  private _texturePreviewUrlByIndex = new Map<number, string>();
  private _runtimeBindings: RuntimePrimitiveBindingEntry[] = [];
  private _visibilityOverrides = new Map<string, boolean>();
  private _warnings: string[] = [];
  private _snapshot: VRMEditorSessionSnapshot =
    createEmptyVRMEditorSessionSnapshot();
  private _listeners = new Set<SessionListener>();
  private _vfxUnsubscribe: (() => void) | null = null;
  private _refreshToken = 0;
  private _isDisposed = false;

  private constructor(input: VRMEditorSessionInput) {
    this._avatar = input.avatar;
    this._sourceUrl = input.sourceUrl?.trim() || input.avatar.sourceUrl || null;
    this._sourceKey = input.sourceKey?.trim() || this._sourceUrl;
    this._arrayBuffer = input.arrayBuffer
      ? cloneArrayBuffer(input.arrayBuffer)
      : null;
    this._sourceSummary = createFallbackSourceSummary({
      sourceUrl: this._sourceUrl,
      sourceKey: this._sourceKey,
    });
  }

  static async create(input: VRMEditorSessionInput): Promise<VRMEditorSession> {
    const session = new VRMEditorSession(input);
    await session.refresh();
    return session;
  }

  static createEmptySnapshot(): VRMEditorSessionSnapshot {
    return createEmptyVRMEditorSessionSnapshot();
  }

  getDocument(): VRMDocument | null {
    return this._document;
  }

  getSnapshot(): VRMEditorSessionSnapshot {
    return this._snapshot;
  }

  subscribe(listener: SessionListener): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  async refresh(): Promise<VRMEditorSessionSnapshot> {
    if (this._isDisposed) {
      return this._snapshot;
    }

    const refreshToken = ++this._refreshToken;
    this._bindVFXController();
    this._setSnapshot({
      ...this._snapshot,
      status: "loading",
      error: null,
    });

    const runtimeResult = buildRuntimePrimitiveBindings(this._avatar);
    this._runtimeBindings = runtimeResult.entries;
    this._applyRuntimeOverrides();

    const warnings = [...runtimeResult.warnings];
    let sourceMode: VRMInspectionSourceMode | null = null;
    let sourceSummary = createFallbackSourceSummary({
      sourceUrl: this._sourceUrl,
      sourceKey: this._sourceKey,
    });
    let rawJson: RawGltf | null = null;
    let transformDocument: TransformDocument | null = null;

    if (this._sourceUrl || this._arrayBuffer) {
      try {
        if (!this._document) {
          this._document = await VRMDocument.fromSource({
            sourceUrl: this._sourceUrl,
            sourceKey: this._sourceKey,
            arrayBuffer: this._arrayBuffer,
          });
        } else {
          await this._document.refresh();
        }

        if (this._isStaleRefresh(refreshToken)) {
          return this._snapshot;
        }

        rawJson = this._document.getRawJson();
        transformDocument = this._document.getTransformDocument();
        sourceSummary = this._document.getSourceSummary();
        this._texturePreviewUrlByIndex =
          this._document.getTexturePreviewUrlByIndex();
        warnings.push(...this._document.getWarnings());
        sourceMode = "merged";
      } catch (error) {
        if (this._isStaleRefresh(refreshToken)) {
          return this._snapshot;
        }
        warnings.push(`VRM document parse failed: ${toErrorMessage(error)}`);
        this._document?.dispose();
        this._document = null;
        this._texturePreviewUrlByIndex.clear();
      }
    }

    if (!rawJson) {
      rawJson = readRawJsonFromAvatar(this._avatar);
      transformDocument = null;
      sourceMode = rawJson ? "runtime_fallback" : null;
      if (!this._document) {
        this._texturePreviewUrlByIndex.clear();
      }
      sourceSummary = createFallbackSourceSummary({
        sourceUrl: this._sourceUrl ?? this._avatar.sourceUrl ?? null,
        sourceKey:
          this._sourceKey ?? this._sourceUrl ?? this._avatar.sourceUrl ?? null,
      });
    }

    if (this._isStaleRefresh(refreshToken)) {
      return this._snapshot;
    }

    this._rawJson = rawJson;
    this._transformDocument = transformDocument;
    this._sourceMode = sourceMode;
    this._sourceSummary = sourceSummary;
    this._warnings = dedupeWarnings(warnings);

    if (!rawJson || !sourceMode) {
      this._setSnapshot({
        status: "error",
        error: "Unable to inspect the active VRM avatar.",
        warnings: this._warnings,
        inspection: null,
        vfx: this._avatar.vfxController?.getSnapshot() ?? null,
        rawJson: toRawJsonRecord(this._rawJson),
        primitiveBindings: this._getPublicPrimitiveBindings(),
        activeOverrideCount: this._visibilityOverrides.size,
        canEdit: this._runtimeBindings.length > 0,
      });
      return this._snapshot;
    }

    this._rebuildSnapshot("ready", null);
    return this._snapshot;
  }

  setPrimitiveVisibility(bindingKey: string, visible: boolean): void {
    if (this._isDisposed) return;

    const binding = this._runtimeBindings.find(
      (entry) => entry.bindingKey === bindingKey,
    );
    if (!binding) return;

    if (visible === binding.originalVisible) {
      this._visibilityOverrides.delete(bindingKey);
    } else {
      this._visibilityOverrides.set(bindingKey, visible);
    }

    binding.object.visible = visible;
    binding.visible = visible;
    this._rebuildSnapshot("ready", null);
  }

  async applyVFXEffect(
    bindingKey: string,
    effectId: string,
    applyMode?: AvatarVFXApplyMode,
    effectEntry?: AvatarVFXCatalogEntry,
  ): Promise<void> {
    if (this._isDisposed) return;
    await this._avatar.vfxController?.applyEffect({
      bindingKey,
      effectId,
      applyMode,
      effectEntry,
    });
  }

  async applyHoverVFX(
    effectId: string,
    effectEntry?: AvatarHoverVFXEntry,
  ): Promise<void> {
    if (this._isDisposed) return;
    await this._avatar.vfxController?.applyHoverVFX({
      effectId,
      effectEntry,
    });
  }

  async applyFaceAnchoredVFX(
    effectId: string,
    effectEntry?: AvatarFaceAnchoredVFXEntry,
  ): Promise<void> {
    if (this._isDisposed) return;
    await this._avatar.vfxController?.applyFaceAnchoredVFX({
      effectId,
      effectEntry,
    });
  }

  async applyTextureVFX(
    effectId: string,
    applyMode?: AvatarVFXApplyMode,
    effectEntry?: AvatarTextureVFXEntry,
  ): Promise<void> {
    if (this._isDisposed) return;
    await this._avatar.vfxController?.applyTextureVFX({
      effectId,
      applyMode,
      effectEntry,
    });
  }

  removeVFXEffect(appliedEffectId: string): void {
    if (this._isDisposed) return;
    this._avatar.vfxController?.removeEffect(appliedEffectId);
  }

  clearVFXEffects(): void {
    if (this._isDisposed) return;
    this._avatar.vfxController?.clearAllEffects();
  }

  setFaceFlattenPreview(args: {
    previewEyes?: boolean;
    previewMouth?: boolean;
  }): void {
    if (this._isDisposed) return;
    this._avatar.vfxController?.setFaceFlattenPreview(args);
  }

  resetRuntimeOverrides(): void {
    if (this._isDisposed) return;

    this._restoreRuntimeBindings();
    this._rebuildSnapshot("ready", null);
  }

  dispose(): void {
    if (this._isDisposed) return;

    this._refreshToken += 1;
    this._restoreRuntimeBindings();
    this._vfxUnsubscribe?.();
    this._vfxUnsubscribe = null;
    this._listeners.clear();
    this._document?.dispose();
    this._document = null;
    this._rawJson = null;
    this._transformDocument = null;
    this._texturePreviewUrlByIndex.clear();
    this._runtimeBindings = [];
    this._warnings = [];
    this._snapshot = createEmptyVRMEditorSessionSnapshot();
    this._isDisposed = true;
  }

  private _rebuildSnapshot(
    status: VRMEditorSessionSnapshot["status"],
    error: string | null,
  ): void {
    const primitiveBindings = this._getPublicPrimitiveBindings();
    const activeOverrideCount = this._visibilityOverrides.size;

    if (!this._rawJson || !this._sourceMode) {
      this._setSnapshot({
        status,
        error,
        warnings: this._warnings,
        inspection: null,
        vfx: this._avatar.vfxController?.getSnapshot() ?? null,
        rawJson: toRawJsonRecord(this._rawJson),
        primitiveBindings,
        activeOverrideCount,
        canEdit: this._runtimeBindings.length > 0,
      });
      return;
    }

    const inspection = buildInspectionSnapshot({
      sourceMode: this._sourceMode,
      source: this._sourceSummary,
      rawJson: this._rawJson,
      document: this._transformDocument,
      texturePreviewUrlByIndex: this._texturePreviewUrlByIndex,
      primitiveBindings,
      activeOverrideCount,
      avatar: this._avatar,
      warnings: this._warnings,
    });

    this._setSnapshot({
      status,
      error,
      warnings: inspection.warnings,
      inspection,
      vfx: this._avatar.vfxController?.getSnapshot() ?? null,
      rawJson: toRawJsonRecord(this._rawJson),
      primitiveBindings,
      activeOverrideCount,
      canEdit: this._runtimeBindings.length > 0,
    });
  }

  private _restoreRuntimeBindings(): void {
    this._visibilityOverrides.clear();
    this._runtimeBindings.forEach((binding) => {
      binding.object.visible = binding.originalVisible;
      binding.visible = binding.originalVisible;
    });
  }

  private _applyRuntimeOverrides(): void {
    this._runtimeBindings.forEach((binding) => {
      const override = this._visibilityOverrides.get(binding.bindingKey);
      const visible = override ?? binding.originalVisible;
      binding.object.visible = visible;
      binding.visible = visible;
    });
  }

  private _getPublicPrimitiveBindings(): VRMRuntimePrimitiveBinding[] {
    return this._runtimeBindings.map((binding) => ({
      bindingKey: binding.bindingKey,
      nodeIndex: binding.nodeIndex,
      meshIndex: binding.meshIndex,
      primitiveIndex: binding.primitiveIndex,
      materialIndex: binding.materialIndex,
      materialName: binding.materialName,
      objectName: binding.objectName,
      objectType: binding.objectType,
      visible: binding.object.visible,
      originalVisible: binding.originalVisible,
      isSkinnedMesh: binding.isSkinnedMesh,
    }));
  }

  private _isStaleRefresh(refreshToken: number): boolean {
    return this._isDisposed || refreshToken !== this._refreshToken;
  }

  private _bindVFXController(): void {
    this._vfxUnsubscribe?.();
    this._vfxUnsubscribe = null;

    const controller = this._avatar.vfxController;
    if (!controller) return;

    this._vfxUnsubscribe = controller.subscribe(() => {
      if (this._isDisposed) return;

      if (!this._rawJson || !this._sourceMode) {
        this._setSnapshot({
          ...this._snapshot,
          vfx: controller.getSnapshot(),
        });
        return;
      }

      this._rebuildSnapshot(
        this._snapshot.status === "loading" ? "ready" : this._snapshot.status,
        this._snapshot.error,
      );
    });
  }

  private _setSnapshot(snapshot: VRMEditorSessionSnapshot): void {
    this._snapshot = snapshot;
    if (this._isDisposed) return;
    this._listeners.forEach((listener) => {
      listener();
    });
  }
}

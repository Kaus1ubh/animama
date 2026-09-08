import {
  type Texture as TransformTexture,
  WebIO,
  type Document as TransformDocument,
  type GLTF as TransformGLTF,
  type JSONDocument,
} from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";

import {
  buildInspectionSnapshot,
  sanitizeJsonDocument,
} from "./vrmEditorInspection";
import type {
  VRMDocumentSourceInput,
  VRMInspectionSnapshot,
  VRMInspectionSourceSummary,
} from "./vrm-editor-types";

type RawGltf = TransformGLTF.IGLTF;

function cloneArrayBuffer(value: ArrayBuffer): ArrayBuffer {
  return value.slice(0);
}

function createSourceSummary(args: {
  sourceUrl: string | null;
  sourceKey: string | null;
  byteLength: number | null;
  fetchedAtMs: number | null;
}): VRMInspectionSourceSummary {
  return {
    sourceUrl: args.sourceUrl,
    sourceKey: args.sourceKey,
    byteLength: args.byteLength,
    fetchedAtMs: args.fetchedAtMs,
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export class VRMDocument {
  private readonly _sourceUrl: string | null;
  private readonly _sourceKey: string | null;

  private _arrayBuffer: ArrayBuffer | null;
  private _rawJsonDocument: JSONDocument | null = null;
  private _sanitizedJsonDocument: JSONDocument | null = null;
  private _document: TransformDocument | null = null;
  private _snapshot: VRMInspectionSnapshot | null = null;
  private _sourceSummary: VRMInspectionSourceSummary;
  private _texturePreviewUrlByIndex = new Map<number, string>();
  private _ownedObjectUrls = new Set<string>();
  private _warnings: string[] = [];
  private _isDisposed = false;

  private constructor(input: VRMDocumentSourceInput) {
    this._sourceUrl = input.sourceUrl?.trim() || null;
    this._sourceKey = input.sourceKey?.trim() || this._sourceUrl;
    this._arrayBuffer = input.arrayBuffer
      ? cloneArrayBuffer(input.arrayBuffer)
      : null;
    this._sourceSummary = createSourceSummary({
      sourceUrl: this._sourceUrl,
      sourceKey: this._sourceKey,
      byteLength: this._arrayBuffer?.byteLength ?? null,
      fetchedAtMs: null,
    });
  }

  static async fromSource(input: VRMDocumentSourceInput): Promise<VRMDocument> {
    const document = new VRMDocument(input);
    await document.refresh();
    return document;
  }

  getSnapshot(): VRMInspectionSnapshot | null {
    return this._snapshot;
  }

  getWarnings(): string[] {
    return [...this._warnings];
  }

  getSourceSummary(): VRMInspectionSourceSummary {
    return { ...this._sourceSummary };
  }

  getRawJsonDocument(): JSONDocument | null {
    return this._rawJsonDocument;
  }

  getSanitizedJsonDocument(): JSONDocument | null {
    return this._sanitizedJsonDocument;
  }

  getRawJson(): RawGltf | null {
    return this._rawJsonDocument?.json ?? null;
  }

  getTransformDocument(): TransformDocument | null {
    return this._document;
  }

  getSourceArrayBuffer(): ArrayBuffer | null {
    return this._arrayBuffer ? cloneArrayBuffer(this._arrayBuffer) : null;
  }

  getTexturePreviewUrlByIndex(): Map<number, string> {
    return new Map(this._texturePreviewUrlByIndex);
  }

  async refresh(): Promise<VRMInspectionSnapshot> {
    const { bytes, fetchedAtMs } = await this._loadSourceBytes();
    if (this._isDisposed) {
      throw new Error("VRMDocument has been disposed.");
    }

    const io = new WebIO().registerExtensions(KHRONOS_EXTENSIONS);
    const rawJsonDocument = await io.binaryToJSON(bytes);
    const sanitizedJsonDocument = sanitizeJsonDocument(rawJsonDocument);

    let document: TransformDocument | null = null;
    const warnings: string[] = [];

    try {
      document = await io.readJSON(sanitizedJsonDocument);
    } catch (error) {
      warnings.push(`gltf-transform parse failed: ${toErrorMessage(error)}`);
    }

    const texturePreviewUrlByIndex =
      this._buildTexturePreviewUrlByIndex(document);

    const sourceSummary = createSourceSummary({
      sourceUrl: this._sourceUrl,
      sourceKey: this._sourceKey,
      byteLength: bytes.byteLength,
      fetchedAtMs,
    });
    const snapshot = buildInspectionSnapshot({
      sourceMode: "document",
      source: sourceSummary,
      rawJson: rawJsonDocument.json,
      document,
      texturePreviewUrlByIndex,
      warnings,
    });

    if (this._isDisposed) {
      throw new Error("VRMDocument has been disposed.");
    }

    this._rawJsonDocument = rawJsonDocument;
    this._sanitizedJsonDocument = sanitizedJsonDocument;
    this._document = document;
    this._snapshot = snapshot;
    this._sourceSummary = sourceSummary;
    this._texturePreviewUrlByIndex = texturePreviewUrlByIndex;
    this._warnings = snapshot.warnings;

    return snapshot;
  }

  dispose(): void {
    this._isDisposed = true;
    this._revokeOwnedObjectUrls();
    this._arrayBuffer = null;
    this._rawJsonDocument = null;
    this._sanitizedJsonDocument = null;
    this._document = null;
    this._snapshot = null;
    this._texturePreviewUrlByIndex.clear();
    this._warnings = [];
  }

  private async _loadSourceBytes(): Promise<{
    bytes: Uint8Array<ArrayBuffer>;
    fetchedAtMs: number | null;
  }> {
    if (this._arrayBuffer) {
      const arrayBuffer = cloneArrayBuffer(this._arrayBuffer);
      return {
        bytes: new Uint8Array(arrayBuffer),
        fetchedAtMs: this._sourceSummary.fetchedAtMs,
      };
    }

    if (!this._sourceUrl) {
      throw new Error("VRM document source is missing.");
    }

    const response = await fetch(this._sourceUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch VRM source: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const fetchedAtMs = Date.now();
    this._arrayBuffer = cloneArrayBuffer(arrayBuffer);

    return {
      bytes: new Uint8Array(arrayBuffer),
      fetchedAtMs,
    };
  }

  private _buildTexturePreviewUrlByIndex(
    document: TransformDocument | null,
  ): Map<number, string> {
    this._revokeOwnedObjectUrls();
    if (!document) {
      return new Map();
    }

    const next = new Map<number, string>();
    const textures = document.getRoot().listTextures();

    textures.forEach((texture, index) => {
      const previewUrl = this._createTexturePreviewUrl(texture);
      if (!previewUrl) return;
      next.set(index, previewUrl);
    });

    return next;
  }

  private _createTexturePreviewUrl(texture: TransformTexture): string | null {
    const image = texture.getImage();
    const mimeType = texture.getMimeType();
    if (image && mimeType) {
      const objectUrl = URL.createObjectURL(
        new Blob([image], { type: mimeType }),
      );
      this._ownedObjectUrls.add(objectUrl);
      return objectUrl;
    }

    const uri = texture.getURI().trim();
    if (!uri) return null;
    if (/^(data:|blob:|https?:)/.test(uri) || uri.startsWith("/")) {
      return uri;
    }

    if (!this._sourceUrl) {
      return uri;
    }

    try {
      return new URL(uri, this._sourceUrl).toString();
    } catch {
      return uri;
    }
  }

  private _revokeOwnedObjectUrls(): void {
    this._ownedObjectUrls.forEach((objectUrl) => {
      URL.revokeObjectURL(objectUrl);
    });
    this._ownedObjectUrls.clear();
  }
}

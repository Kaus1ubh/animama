import type {
  GLTFLoader,
  GLTFLoaderPlugin,
  GLTFParser,
} from "three/examples/jsm/loaders/GLTFLoader.js";

import { unloadableGltfExtensions } from "./diagnostics/avatarGltfExtensions";

type MeshoptDecoder = NonNullable<GLTFParser["options"]["meshoptDecoder"]>;

let meshoptDecoder: Promise<MeshoptDecoder> | null = null;

/**
 * three's meshopt decoder, imported and compiled on first use. Its
 * WebAssembly compiles as soon as the module is evaluated, which a page
 * whose CSP lacks `'wasm-unsafe-eval'` (the landing site) refuses even when
 * it never decodes a file. A failed import or compile is not cached.
 */
function loadMeshoptDecoder(): Promise<MeshoptDecoder> {
  meshoptDecoder ??= import("three/examples/jsm/libs/meshopt_decoder.module.js")
    .then(async ({ MeshoptDecoder }) => {
      await MeshoptDecoder.ready;
      return MeshoptDecoder;
    })
    .catch((error: unknown) => {
      meshoptDecoder = null;
      throw error;
    });
  return meshoptDecoder;
}

/** Whether a glTF document uses or requires `name`. */
function mentions(json: Record<string, unknown>, name: string): boolean {
  return ["extensionsUsed", "extensionsRequired"].some((field) => {
    const names = json[field];
    return Array.isArray(names) && names.includes(name);
  });
}

/**
 * Prepares each file before three parses it: fails a file that needs an
 * extension the runtime cannot load, naming it (three's loader only warns
 * about an unknown required extension and draws the file without it; a
 * missing decoder such as Draco's fails inside three already), and gives a
 * meshopt-compressed file the decoder. three reads the decoder from the
 * parser's options when it loads each buffer view, after every plugin's
 * `beforeRoot`.
 */
class AvatarExtensionsPlugin implements GLTFLoaderPlugin {
  readonly name = "ANIMAMA_avatar_extensions";

  private readonly parser: GLTFParser;

  constructor(parser: GLTFParser) {
    this.parser = parser;
  }

  async beforeRoot(): Promise<void> {
    const json = this.parser.json as Record<string, unknown>;
    const unloadable = unloadableGltfExtensions(json);
    if (unloadable.length > 0)
      throw new Error(
        `The file requires glTF extensions Animama cannot load: ${unloadable.join(", ")}`,
      );
    if (mentions(json, "EXT_meshopt_compression"))
      this.parser.options.meshoptDecoder = await loadMeshoptDecoder();
  }
}

/**
 * Give a glTF loader what every Avatar loader shares: the meshopt decoder for
 * files that use it (its WebAssembly is embedded, so no runtime asset is
 * served) and a clear failure for a file whose extensions the runtime cannot
 * load (`LOADABLE_GLTF_EXTENSIONS`). Diagnostics names those extensions from
 * the file's facts (`avatar_extension_unsupported`). Returns the loader.
 */
export function configureAvatarGltfLoader(loader: GLTFLoader): GLTFLoader {
  loader.register((parser) => new AvatarExtensionsPlugin(parser));
  return loader;
}

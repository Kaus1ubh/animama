import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type {
  GLTFLoader,
  GLTFLoaderPlugin,
  GLTFParser,
} from "three/examples/jsm/loaders/GLTFLoader.js";

import { unloadableGltfExtensions } from "./diagnostics/avatarGltfExtensions";

/**
 * Fails a load whose file needs an extension the runtime cannot load, naming
 * it. three's loader only warns about an unknown required extension and draws
 * the file without it; a missing decoder (Draco) fails inside three already.
 */
class UnloadableExtensionsPlugin implements GLTFLoaderPlugin {
  readonly name = "ANIMAMA_unloadable_extensions";

  private readonly parser: GLTFParser;

  constructor(parser: GLTFParser) {
    this.parser = parser;
  }

  beforeRoot(): Promise<void> | null {
    const unloadable = unloadableGltfExtensions(this.parser.json);
    if (unloadable.length === 0) return null;
    return Promise.reject(
      new Error(
        `The file requires glTF extensions Animama cannot load: ${unloadable.join(", ")}`,
      ),
    );
  }
}

/**
 * Give a glTF loader what every Avatar loader shares: the meshopt decoder (its
 * WebAssembly is embedded, so no runtime asset is served) and a clear failure
 * for a file whose extensions the runtime cannot load
 * (`LOADABLE_GLTF_EXTENSIONS`). Diagnostics names those extensions from the
 * file's facts (`avatar_extension_unsupported`). Returns the loader.
 */
export function configureAvatarGltfLoader(loader: GLTFLoader): GLTFLoader {
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.register((parser) => new UnloadableExtensionsPlugin(parser));
  return loader;
}

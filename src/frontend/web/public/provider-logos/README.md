# Model provider marks

Most SVGs are copied without modification from
[models.dev](https://github.com/anomalyco/models.dev/tree/8540388b7fff1a0ae57f3de053ff7befb1f2125e/providers)
revision `8540388b7fff1a0ae57f3de053ff7befb1f2125e`, from
`providers/<provider>/logo.svg`: OpenAI, Google, xAI, Groq, DeepSeek, Hugging
Face, OpenRouter, LM Studio (`lmstudio`) and Ollama (`ollama.svg` is
`providers/ollama-cloud/logo.svg`). Their MIT license is in `LICENSE.txt`.

`llamacpp.svg` is copied without modification from
[llama.cpp](https://github.com/ggml-org/llama.cpp/blob/ec7630a640789c393694fb194f1bbbf0369fc62d/media/llama1-icon-transparent.svg)
revision `ec7630a640789c393694fb194f1bbbf0369fc62d`,
`media/llama1-icon-transparent.svg`. Its MIT license is in
`LICENSE-llama.cpp.txt`. It is the only full-colour mark, so it is not inverted
in dark mode.

The included marks match the providers in Animama's model catalog and
connection presets. Adapters without a bundled mark keep an accessible initial.
Both licenses are also in the desktop runtime notice inventory. Provider names
and marks belong to their respective owners; their use identifies the available
model provider.

The model selector loads these root-relative application assets. Vite copies
them into the production web directory used by both FastAPI and packaged
Electron, so there are no CDN requests or offline logo dependencies.

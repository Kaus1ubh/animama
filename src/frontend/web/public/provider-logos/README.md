# Model provider marks

These SVGs are copied without modification from
[models.dev](https://github.com/anomalyco/models.dev/tree/8540388b7fff1a0ae57f3de053ff7befb1f2125e/providers)
revision `8540388b7fff1a0ae57f3de053ff7befb1f2125e`, from
`providers/<provider>/logo.svg`. The included providers match the brand marks
emitted by Animama's model catalog: OpenAI, Google, xAI, Groq, DeepSeek and
Hugging Face. Adapters without a bundled mark keep an accessible initial.

The upstream MIT license is preserved in `LICENSE.txt` and in the desktop
runtime notice inventory. Provider names and marks belong to their respective
owners; their use identifies the available model provider.

The model selector loads these root-relative application assets. Vite copies
them into the production web directory used by both FastAPI and packaged
Electron, so there are no CDN requests or offline logo dependencies.

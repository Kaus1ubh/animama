# Model settings

App Settings → Models lets the installation owner connect model servers, add
their models and choose the default model for each job. It appears only when
`GET /v1/runtime-capabilities` reports `model_configuration: true` (desktop and
self-hosted web); other compositions keep a fixed catalog. Running Ollama, LM
Studio, llama.cpp or vLLM, their context windows and reaching them from Docker
Compose are covered in [Local model servers](../../backend/operations/local-models.md).

Code: `web/src/ui/settings/models/`, hooks in
`web/src/query/hooks/useModelConfiguration.ts` and mutations in
`web/src/query/mutations/useModelConfiguration.ts`. Query keys live under
`queryKeys.modelConfiguration`; every connection or model change also refreshes
the chat model catalog and user settings, because removal can clear role
assignments on the server.

## Connections

The section opens on fixed tabs styled like the Library tabs (shared
`underlineTabClassName` in `web/src/ui/components/tabs.tsx`): **OpenAI**,
**Ollama**, **LM Studio**, **llama.cpp**, **vLLM** and **Custom**
(`MODEL_SERVER_TABS` and `connectionServerTab` in
`model-configuration-state.ts`). OpenAI holds the built-in connection. A local
server tab holds that preset's connections; until one exists it shows the
connect form with the server type fixed. Custom holds DeepSeek, Hugging Face
and custom-URL connections; its **Add connection** button opens the same form
with a choice among those three (shown directly while Custom is empty).
Several connections on one tab are listed one after another. Each owner
connection shows its name, address and key state with Edit and Remove; every
connection lists its models and has a round **+** button that adds one.

Each connection is an OpenAI-compatible server: Ollama, LM Studio, llama.cpp,
vLLM, DeepSeek, Hugging Face or a custom URL. The preset fills the base URL,
timeout and compatibility options (under Advanced); local presets use the host
from `ANIMAMA_LOCAL_MODEL_HOST` (`127.0.0.1` by default, including desktop;
`host.docker.internal` in Compose). For a new Ollama, LM Studio, llama.cpp or
vLLM connection, **Detect** asks the backend to check the preset's default
address (`POST /v1/model-connection-presets/{preset_id}/detect`). A running
server fills in the base URL and reports how many models it serves; otherwise
the form says nothing is running there. The built-in OpenAI connection uses the
OpenAI key from API Keys or `OPENAI_API_KEY` and, on self-hosted web,
`OPENAI_BASE_URL`. It cannot be edited or removed, but the owner can add models
to it, for example a newer OpenAI model copied from a built-in template.

Keys depend on where the app runs:

- **Desktop (embedded runtime):** a write-only key field. The connection is saved
  first with a managed key; the key is then stored in the encrypted vault under
  `ANIMAMA_CONNECTION_<ID>_API_KEY` through `credentials.apply`, which restarts
  local services and reloads the window. Test models after the reload. Removing
  a connection with a saved key asks for confirmation, deletes the key and
  restarts the same way. At most 32 connection keys can be stored.
- **Self-hosted web (and the external development stack):** the owner names the
  environment variable that holds the key (`OPENAI_API_KEY`, `DEEPSEEK_API_KEY`,
  `HF_TOKEN` or `ANIMAMA_CONNECTION_<NAME>_API_KEY`); the connection shows
  whether it is set in the backend environment. Under Compose, the
  `ANIMAMA_CONNECTION_*` variables come from the file named by
  `ANIMAMA_CONNECTION_KEYS_FILE`. Keys never reach the database.

A key that would travel over plain `http` to another computer shows a warning.

## Models

The add-model dialog lists the server's models (`available-models`) or accepts a
typed ID. For chat models the owner can copy a built-in model's capabilities, then
**Test model** probes streaming, structured output, tool calls and tools with a
schema, and prefills the results and any context window the server reports.
The context window is required: it should be the size the server loads the
model with, not the model's maximum. Each chat model can be barred from
writing memories. Embedding models only need their ID.

Each model row shows its name, a tag and an Info button. The tag
(`modelApiTag`) is **Responses** for a chat model on the Responses API,
**Completions** for any other chat model and **Embeddings** for an embedding
model. Info opens the model's details: read-only for built-in models, and the
editable add-model form for owner models, which adds Remove. Both offer **Show
in model lists**, which saves at once; a hidden model stays in use wherever it
is already chosen. Removing something in use first asks for confirmation,
naming the Animas and roles that use it; those Animas show the model as
unavailable until another is picked, and the roles return to their defaults.

## Default models

Four selectors under **Default models** pick the model for each job, saved in
user preferences. Without a choice, each uses the operator default
(`ANIMAMA_DEFAULT_*_MODEL_PROVIDER_ID`) when one is set, otherwise:

| Section        | Role             | Preference key                            | Default                              |
| -------------- | ---------------- | ----------------------------------------- | ------------------------------------ |
| Chat           | `chat`           | `chat.default_model_provider_id`          | The system default model             |
| Memory Manager | `memory_manager` | `models.memory_manager_model_provider_id` | The Chat default when it calls tools |
| Compaction     | `utility`        | `models.utility_model_provider_id`        | The Chat default                     |
| Embeddings     | `embeddings`     | `models.embedding_model_provider_id`      | Off (search uses keywords)           |

Chat is the model new Animas start with; existing Animas keep their own.
Compaction also writes chat titles. Each selector offers only models the server
accepts for that job and shows which model is in effect (`GET /v1/model-roles`).
Embeddings shows re-embedding progress, polled while the server reports work in
flight.

## Chat model picker

The chat input's picker and the Chat default list only chat models: embedding
models never appear, hidden models only while an Anima still uses one, and owner
models without a context window are disabled with a hint. An Anima whose model
was removed shows a warning in the picker. Opening a chat restores the row it
last used by `last_model_provider_id`, falling back to the model name for older
chats. Attaching files to a model without tool calling shows that it cannot
search them.

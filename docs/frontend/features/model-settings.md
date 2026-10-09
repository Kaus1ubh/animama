# Model settings

App Settings → Models lets the owner connect model servers, add their models
and choose the default model for each job. Each part follows its own admitted
runtime capability (`modelSettingsAvailability` in
`model-configuration-state.ts`): connections and their models need
`model_configuration: true` (desktop and self-hosted web), the default models
need `model_role_selection: true` (hosted runtimes offer these over the
operator's fixed catalog) and the search service needs
`web_search.configuration: true`. The section appears when any part does.
Running Ollama, LM Studio, llama.cpp or vLLM, their context windows and reaching
them from Docker Compose are covered in
[Local model servers](../../backend/operations/local-models.md).

Code: `web/src/ui/settings/models/`, hooks in
`web/src/query/hooks/useModelConfiguration.ts` and mutations in
`web/src/query/mutations/useModelConfiguration.ts`. Query keys live under
`queryKeys.modelConfiguration`; every connection or model change also refreshes
the chat model catalog and user settings, because removal can clear role
assignments on the server.

## Connections

The section opens on two tabs styled like the Library tabs (shared
`underlineTabClassName` in `web/src/ui/components/tabs.tsx`), organized by
where models run (`MODEL_LOCATION_TABS`, `MODEL_LOCATION_PROVIDERS` and
`connectionLocation` in `model-configuration-state.ts`):

- **Cloud:** OpenAI (the built-in connection, tagged Recommended), DeepSeek,
  Hugging Face, OpenRouter and Custom.
- **Local:** Ollama, LM Studio, llama.cpp, vLLM and Custom.

The built-in connection and the cloud presets are on Cloud and the local server
presets on Local. A custom connection is on Local when its base URL points at
this computer or a private network (loopback, `localhost`,
`host.docker.internal`, single-label names such as `gpu-box`, `.local`, `.lan`,
`.home.arpa`, `.internal` and Tailscale `.ts.net` names, private, link-local
and Tailscale 100.64.0.0/10 addresses), otherwise on Cloud.

Under Cloud | Local, a second row of left-aligned provider tabs
(`ModelProviderTabsList`, shared with setup's AI step) shows one provider at a
time, with a dot on connected providers (built-in OpenAI counts once its key
is set). A location opens on its first connected provider, else its first
provider (`defaultLocationProvider`). A connected provider's tab shows its
cards; an unconnected one shows its purpose and connect form inline; Custom
lists each custom server plus **Add a custom server**. Provider panels stay
mounted, so a half-filled form survives tab switches. Connecting shows the
new connection's tab (a custom server lands on the location its address
implies) and opens **Add model**.
A card shows the connection's name, a
status and, for owner connections, Edit and Remove, then its models and **Add
model**. Cloud cards show the key state (**Key set**, **Key missing**). Local
cards list the server's models once (`available-models`, cached for 30 s) and
show **Running at host:port** or **Not reachable**.

Each connection is an OpenAI-compatible server. The preset fills the base URL,
timeout and compatibility options (under Advanced); local presets use the host
from `ANIMAMA_LOCAL_MODEL_HOST` (`127.0.0.1` by default, including desktop;
`host.docker.internal` in Compose). For a new Ollama, LM Studio, llama.cpp or
vLLM connection, **Detect** asks the backend to check the preset's default
address (`POST /v1/model-connection-presets/{preset_id}/detect`). A running
server fills in the base URL and reports how many models it serves; otherwise
the form says nothing is running there. The built-in OpenAI connection cannot
be edited or removed, but the owner can add models to it, for example a newer
OpenAI model copied from a built-in template; only the built-in connection
offers templates.

Keys depend on where the app runs:

- **Desktop (embedded runtime):** the OpenAI card holds the OpenAI key field,
  `DesktopCredentialsPanel` filtered with `providers={["openai"]}`; Voice →
  Text-to-Speech holds the ElevenLabs field the same way. Both edit the same
  vault state as App Settings → API Keys: saved status lives in the
  `desktopCredentials` query cache, so a save in any panel updates the others.
  Other connections take a write-only key field. The connection is saved first
  with a managed key; the key is then stored in the encrypted vault under
  `ANIMAMA_CONNECTION_<ID>_API_KEY` through `credentials.apply` and applies
  immediately, without a reload. Removing a connection with a saved key asks
  for confirmation, because the key is deleted too. At most 32 connection keys
  can be stored.
- **Self-hosted web (and the external development stack):** the OpenAI card
  says it uses the server's `OPENAI_API_KEY` (the base URL still comes from
  `OPENAI_BASE_URL`).
  For other connections the owner names the environment variable that holds the
  key (`DEEPSEEK_API_KEY`, `HF_TOKEN`, `OPENROUTER_API_KEY` or
  `ANIMAMA_CONNECTION_<NAME>_API_KEY`); the card shows whether it is set in the
  backend environment. Under Compose, the `ANIMAMA_CONNECTION_*` variables come
  from the file named by `ANIMAMA_CONNECTION_KEYS_FILE`. Keys never reach the
  database.

A key that would travel over plain `http` to another computer shows a warning.

## Models

The add-model dialog lists the server's models (`available-models`) or accepts a
typed ID. On an OpenRouter connection it also offers a searchable picker over
OpenRouter's public list (`GET /v1/model-connection-presets/openrouter/models`,
no key sent). **Tool calling only** starts on; choosing a model fills in its ID,
name, context window, tool calling and structured output. If the list is
unavailable, the picker says so and the owner types the ID. For chat models the
owner can copy a built-in model's capabilities, then **Test model** probes
streaming, structured output, tool calls and tools with a schema, and prefills
the results and any context window the server reports, overriding a prefill.
The context window is required: it should be the size the server loads the
model with, not the model's maximum. Each chat model can be barred from writing
memories. Embedding models only need their ID.

Each model row shows its name, capability chips (`modelCapabilityChips`) and an
Info button. Chips are **Tools**, the context window (for example **128K**),
web search and **Vision** for models that accept images; embedding models show
**Embeddings**. Web search reads **Built-in search** when the model's own search
can be requested (OpenAI Responses models), **App search** when the model calls
tools and the installation's search service is ready, and is absent otherwise.
Model rows and pickers never name the API: the Info panel shows **API:
Responses** or **API: Chat Completions**. The app picks the API: chat models
added to the built-in OpenAI connection use Responses, and every other
connection uses Chat Completions. When two listed chat rows on one
connection share a name (for example an unhidden built-in Chat Completions row),
the non-Responses row reads "(alternate)" in the chat picker, Default models
and Models rows (`alternateModelIds` in `lib/chat/model-catalog.ts`).
The Local tab shows no model size or quantization, because the model listing
reports only IDs.

Info opens the model's details: read-only for built-in models, and the editable
add-model form for owner models, which adds Remove. Both offer **Show in model
lists**, which saves at once; a hidden model stays in use wherever it is
already chosen. Hidden rows, including the built-in Chat Completions rows hidden
by default, are listed behind **Show N hidden models** with a Hidden tag and a
**Show** button. Removing something in use first asks for confirmation, naming
the Animas and roles that use it; those Animas show the model as unavailable
until another is picked, and the roles return to their defaults.

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

## Web search

Models → Web search chooses the installation's search backend, shown only when
the runtime capability `web_search.configuration` is true (the local
composition). Off, SearXNG (an address; its `search.formats` must include
`json`) or Brave Search (a key). On desktop the Brave key goes to the
encrypted vault under `ANIMAMA_CONNECTION_WEB_SEARCH_API_KEY` and applies
immediately; turning search off or switching to SearXNG deletes it (with a
warning and a retry on failure). Self-hosted web names the variable instead.
Test sends one query to the draft backend and shows a plain-language result
category; a new desktop key must be saved before it can be tested. The note
below the form says where queries go. Saving refreshes the runtime capability,
so the chat picker's Web search control updates. See
[local models](../../backend/operations/local-models.md#web-search).

## Chat model picker

The chat input's picker and the Chat default list only chat models: embedding
models never appear, hidden models only while an Anima still uses one, and owner
models without a context window are disabled with a hint. An Anima whose model
was removed shows a warning in the picker. Opening a chat restores the row it
last used by `last_model_provider_id`, falling back to the model name for older
chats. Attaching files to a model without tool calling shows that it cannot
search them.

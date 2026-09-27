# Local model servers

Animama chats with any server that offers the OpenAI Chat Completions API. This
guide covers running Ollama, LM Studio, llama.cpp or vLLM on the same machine
and connecting them in App Settings → Models, including from Docker Compose.
The settings screens themselves are described in
[model settings](../../frontend/features/model-settings.md).

## What each job needs

| Job                                          | Model requirement                                                                                                                                                                                        |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat (the Anima's model, default chat model) | Streaming, JSON output (JSON schema or JSON mode) and a context window recorded on the model. Tool calling is needed for memory tools and attached-file search; without it the Anima chats without them. |
| Utility (titles, compaction)                 | Streaming, and a context window recorded on the model. Follows the default chat model unless chosen.                                                                                                     |
| Memory Manager                               | Tool calling. Follows the default chat model unless chosen.                                                                                                                                              |
| Embeddings (file and archive search)         | An embedding model served at `/v1/embeddings`. Off until chosen; search uses keywords meanwhile.                                                                                                         |

**Test model** in the model dialog checks streaming, tool calls, JSON schema and
JSON mode output (or embeddings) against the running server and fills in the
capabilities it finds.
Models on Chat Completions compact the conversation after a response and have
no web search.

## Context window

Record the window the server actually serves, not the model's advertised
maximum. Test model reads it from llama.cpp (`/props`), Ollama (`/api/ps`, while
the model is loaded) and LM Studio (the loaded context length); otherwise enter
it yourself. A conversation longer than the served window fails with "The
conversation is too long for …".

Serve at least 8,192 tokens. Animama compacts after a response once the
conversation passes `ANIMAMA_CHAT_COMPACTION_THRESHOLD_TOKENS` (6,000 by
default), so a smaller window overflows before compaction starts.

## Servers

Each preset fills the base URL from the default port and the local model host
(`127.0.0.1` for the desktop app and native runs, `host.docker.internal` in
Compose). Local presets expect no key; set one on the connection only if you
started the server with an API key. Their timeout defaults to 300 seconds
because the first request may load the model; connecting still gives up after
10 seconds, so a stopped server fails quickly.

### Ollama (port 11434)

Ollama serves 4,096 tokens unless told otherwise. Raise the default for every
model:

```bash
OLLAMA_CONTEXT_LENGTH=16384 ollama serve
```

On macOS with the Ollama app, set it with `launchctl setenv OLLAMA_CONTEXT_LENGTH 16384`
and restart the app. To fix the window for one model instead, create a variant
from a Modelfile:

```text
FROM qwen3:8b
PARAMETER num_ctx 16384
```

```bash
ollama create qwen3-16k -f Modelfile
```

Then add `qwen3-16k:latest` as the model (the name **List models** shows), so
Test model can read its window. Pull embedding models such as
`nomic-embed-text` with `ollama pull` and add them as an **Embedding model**.

### LM Studio (port 1234)

Start the server from the Developer tab or with `lms server start`. Set the
context length in the model's load settings (or when loading with `lms load`)
and load the model before testing it, so Test model can read the window.

### llama.cpp (port 8080)

Start `llama-server` with `--jinja`; without it the server rejects requests that
carry tools, so Test model reports no tool calls:

```bash
llama-server -m /models/model.gguf --jinja -c 16384 --port 8080
```

`-c` sets the served window, which Test model reads. Embeddings need a separate
server started with `--embeddings` and an embedding model on another port, added
as a second connection.

### vLLM (port 8000)

Enable tool calling with the parser for the model family, and cap the window:

```bash
vllm serve <model> --enable-auto-tool-choice --tool-call-parser <parser> --max-model-len 16384 --port 8001
```

Animama's own application port defaults to 8000, so run vLLM on another port
and change the connection's base URL to match.

## Docker Compose

The backend container reaches servers on the host as `host.docker.internal`,
which Compose maps to the host gateway.

- **macOS and Windows** (Docker Desktop, OrbStack): servers listening on the
  host's `127.0.0.1` are reachable as is.
- **Linux**: `host.docker.internal` is the Docker bridge gateway, so a server
  that listens only on `127.0.0.1` is unreachable. Make it listen on the bridge
  address or all interfaces (for example `OLLAMA_HOST=0.0.0.0:11434`,
  `llama-server --host 0.0.0.0`, LM Studio's `lms server start --bind 0.0.0.0`
  or its "Serve on Local Network" option) and block the port from other
  machines with a firewall.

Set `ANIMAMA_LOCAL_MODEL_HOST` to change the host the presets suggest, for
example when the server runs on another machine you control.

## Keys on self-hosted web

On the desktop app, a connection's key is saved in the app's encrypted vault
(App Settings → Models; saving restarts local services). Self-hosted web never
accepts key values: the connection names an environment variable instead, and
the backend reads that variable. Allowed names are `OPENAI_API_KEY`,
`DEEPSEEK_API_KEY`, `HF_TOKEN` and `ANIMAMA_CONNECTION_<NAME>_API_KEY`.

With Compose, put `ANIMAMA_CONNECTION_<NAME>_API_KEY` values in an owner-only
file outside the checkout and select it with `ANIMAMA_CONNECTION_KEYS_FILE`:

```bash
mkdir -p -m 700 ~/.config/animama
(umask 077 && touch ~/.config/animama/connection-keys.env)
```

This keeps an existing file. Add lines such as
`ANIMAMA_CONNECTION_LAB_API_KEY='<key>'` with an editor; single quotes stop
Compose from expanding a `$` inside the key. Name
`ANIMAMA_CONNECTION_LAB_API_KEY` on the connection, then start the stack:

```bash
ANIMAMA_CONNECTION_KEYS_FILE="$HOME/.config/animama/connection-keys.env" ./reset.sh
```

`ANIMAMA_CONNECTION_KEYS_FILE` itself can be set in `.env` instead of the shell.

`reset.sh` refuses a relative path or a file that other users can read, and
records only the path in the stack record. Compose loads the file into the
backend container alone. `OPENAI_API_KEY`, `DEEPSEEK_API_KEY` and `HF_TOKEN`
lines in this file are ignored: those come from the Compose environment, like
other secrets. For a native backend, export the variable before starting it.

## Troubleshooting

| Symptom                              | Check                                                                                                                      |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| "Animama couldn't reach …"           | The server is running at the connection's base URL; under Compose on Linux, it listens beyond `127.0.0.1`.                 |
| Test model: tool calling fails       | llama.cpp needs `--jinja`; vLLM needs `--enable-auto-tool-choice` and a parser; otherwise the model may not support tools. |
| "The conversation is too long for …" | The served window is smaller than the conversation; raise it on the server and on the model.                               |
| The first reply times out            | The model is still loading; retry, or raise the connection's timeout.                                                      |
| "… has no API key configured"        | Self-hosted web: the named variable is not set in the backend's environment; restart the stack after adding it.            |

# Local model servers

Animama chats with any server that offers the OpenAI Chat Completions API. This
guide covers running Ollama, LM Studio, llama.cpp or vLLM on the same machine
and connecting them in App Settings → Models, including from Docker Compose.
The settings screens themselves are described in
[model settings](../../frontend/features/model-settings.md). A web build with
`VITE_ENABLE_LOCAL_MODELS=false` hides their Local tab.

## What each job needs

| Job                                          | Model requirement                                                                                                                                                                                        |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat (the Anima's model, default chat model) | Streaming and a context window recorded on the model. JSON schema or JSON mode output gives the most reliable emotions and gestures; without either, the reply is requested by prompt and falls back to plain speech with a neutral tone when the model does not follow it. Tool calling is needed for memory tools and attached-file search; without it the Anima chats without them. |
| Utility (titles, compaction)                 | Streaming, and a context window recorded on the model. Follows the default chat model unless chosen.                                                                                                     |
| Memory Manager                               | Tool calling. Follows the default chat model unless chosen.                                                                                                                                              |
| Embeddings (file and archive search)         | An embedding model served at `/v1/embeddings`. Off until chosen; search uses keywords meanwhile.                                                                                                         |

**Test model** in the model dialog checks streaming, tool calls, JSON schema and
JSON mode output (or embeddings) against the running server and fills in the
capabilities it finds.
Models on Chat Completions summarize earlier conversation when it nears their
window, and search the web through the installation's
[search backend](#web-search) when they call tools.

## Context window

Record the window the server actually serves, not the model's advertised
maximum. Test model reads it from llama.cpp (`/props`), Ollama (`/api/ps`, while
the model is loaded) and LM Studio (the loaded context length); otherwise enter
it yourself. A window recorded larger than the server serves makes the server
reject long prompts; Animama then retries once with less history.

Animama keeps every request within the recorded window. It compacts after a
response once the conversation passes 70% of the window (or 75% of the window
minus room for the reply, or `ANIMAMA_CHAT_COMPACTION_THRESHOLD_TOKENS`, 90,000
by default, if either is lower). A
turn that still nears the window shows "Summarizing earlier conversation…"
while the Compaction model summarizes, and the oldest messages are left out of
the request if needed. A turn fails with "The conversation is too long for …"
only when its message alone exceeds the window, or when a window this small
leaves no room even for a reply after large tool results. Serve at least 8,192
tokens so replies keep useful context.

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

## A fully local installation

With no OpenAI key, make a local model the Chat default in App Settings →
Models and pick it for each existing Anima, including the starter Animas,
which begin on the installation's default OpenAI model. Compaction and the
Memory Manager follow the Chat default; choose Embeddings separately. A chat
title is skipped when the Compaction model takes longer than
`ANIMAMA_CHAT_TITLE_GENERATION_TIMEOUT_SECONDS` (20 by default), for example
while it loads.

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

## Web search

Tool-capable models search through one backend configured for the whole
installation in App Settings → Models → Web search, where Test sends one query:

- **SearXNG**, a self-hosted metasearch engine. Enable its JSON output in
  `settings.yml` (`search.formats: [html, json]`); otherwise Test reports
  `json_format_disabled` (also shown when a proxy in front of SearXNG refuses
  the request). SearXNG takes no key. From Compose, use
  `host.docker.internal` as for model servers.
- **Brave Search API**, with your own key (see Brave's site for current plans
  and free credit). Results are used within a turn and
  are not stored: chat history keeps only the query and result titles and
  URLs.

On the desktop app the Brave key is saved in the encrypted vault. On
self-hosted web, name `ANIMAMA_CONNECTION_WEB_SEARCH_API_KEY` or
`BRAVE_SEARCH_API_KEY` and put the value in the keys file below. Queries leave
the device only to the configured backend, and a failing backend makes the
model say it could not search rather than failing the reply.

## Keys on self-hosted web

On the desktop app, a connection's key is saved in the app's encrypted vault
(App Settings → Models) and applies without a restart. Self-hosted web never
accepts key values: the connection names an environment variable instead, and
the backend reads that variable. Allowed names are `OPENAI_API_KEY`,
`DEEPSEEK_API_KEY`, `HF_TOKEN`, `OPENROUTER_API_KEY` and
`ANIMAMA_CONNECTION_<NAME>_API_KEY`. `ANTHROPIC_API_KEY` is reserved for the
built-in Anthropic connection, so no other connection can send it elsewhere.

A key that a connection names goes only to its own address. A provider key
goes only to that provider's API (`OPENAI_API_KEY` to `https://api.openai.com`,
`DEEPSEEK_API_KEY` to `https://api.deepseek.com`, `HF_TOKEN` to
`https://router.huggingface.co` and `OPENROUTER_API_KEY` to
`https://openrouter.ai`). A connection key goes only to the origin
(`scheme://host[:port]`) set beside it in `ANIMAMA_CONNECTION_<NAME>_ORIGIN`;
the connection form shows the line to add. Without that line the key is not
sent, and the connection reports its key as missing. No such key travels over
plain `http://` to another computer: use `https://`, or a server on this
computer (`localhost`, a loopback address or `host.docker.internal`). Saving a
connection that breaks either rule is refused with
`credential_origin_mismatch` or `credential_insecure_transport`. Write a
non-ASCII host name in its ASCII form (`xn--…`, the form the connection form's
origin line uses), in the base URL and in the origin line: no key is sent to a
host name written in other characters, or to an address whose
`scheme://host[:port]` part has user information or a `%`. The built-in OpenAI connection is separate: it
sends `OPENAI_API_KEY` to `OPENAI_BASE_URL`, which only the operator sets.

With Compose, put `ANIMAMA_CONNECTION_<NAME>_API_KEY` values in an owner-only
file outside the checkout and select it with `ANIMAMA_CONNECTION_KEYS_FILE`:

```bash
mkdir -p -m 700 ~/.config/animama
(umask 077 && touch ~/.config/animama/connection-keys.env)
```

This keeps an existing file. Add lines such as
`ANIMAMA_CONNECTION_LAB_API_KEY='<key>'` and
`ANIMAMA_CONNECTION_LAB_ORIGIN=https://lab.example.com` with an editor; single
quotes stop Compose from expanding a `$` inside the key. Name
`ANIMAMA_CONNECTION_LAB_API_KEY` on the connection, then start the stack:

```bash
ANIMAMA_CONNECTION_KEYS_FILE="$HOME/.config/animama/connection-keys.env" ./reset.sh
```

`ANIMAMA_CONNECTION_KEYS_FILE` itself can be set in `.env` instead of the shell.

`reset.sh` refuses a relative path or a file that other users can read, and
records only the path in the stack record. Compose loads the file into the
backend container alone. `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
`DEEPSEEK_API_KEY`, `HF_TOKEN` and `OPENROUTER_API_KEY` lines in this file are
ignored: those come from the Compose environment, like other secrets. For a native backend, export the variable before starting it.

## Troubleshooting

| Symptom                              | Check                                                                                                                      |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| "Animama couldn't reach …"           | The server is running at the connection's base URL; under Compose on Linux, it listens beyond `127.0.0.1`.                 |
| Test model: tool calling fails       | llama.cpp needs `--jinja`; vLLM needs `--enable-auto-tool-choice` and a parser; otherwise the model may not support tools. |
| "The conversation is too long for …" | The message alone exceeds the window, or the window leaves no room after large tool results; send a shorter message or serve a larger window (and record it on the model). |
| The first reply times out            | The model is still loading; retry, or raise the connection's timeout.                                                      |
| Web search Test: `json_format_disabled` | Add `json` to `search.formats` in the SearXNG `settings.yml` and restart it.                                            |
| "… has no API key configured"        | Self-hosted web: the named variable is not set in the backend's environment; restart the stack after adding it.            |
| The key shows as missing although it is set | The key's origin differs from the base URL's: a provider key works only at its provider's API, a connection key needs `ANIMAMA_CONNECTION_<NAME>_ORIGIN` set to the base URL's origin. On the desktop app, enter the key again after moving a connection to another address. |

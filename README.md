<p align="center">
  <img src="docs/assets/readme-banner.jpg" alt="Animama" width="100%">
</p>

<p align="center">
  <a href="https://youtu.be/8ji_NNOfsP8">
    <img src="https://img.youtube.com/vi/8ji_NNOfsP8/maxres2.jpg" alt="Watch the Animama launch trailer" width="560">
  </a>
</p>

<p align="center">
  <a href="https://youtu.be/sWw4bSrriDE">Walkthrough video</a> ·
  <a href="https://docs.animama.ai">Docs</a> ·
  <a href="https://discord.gg/pUHHRrZ2xg">Discord</a>
  <br>
  README: <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.zh-Hans.md">简体中文</a>
</p>

# Animama

Your new desk buddy is an Anima. Animama puts a charming and expressive
companion in the corner of your screen, keeping you company while you work,
play and power through the day.

## Features

### Your Anima

- **Personality:** each Anima has their own identity and voice.
- **Memories:** long-term memory across conversations. Your Anima keeps notes
  about you and your time together, in files you can read, edit and roll back.
- **Emotions:** 24 emotions that shift over your time together and show in
  their face, body and voice.
- **Gestures:** body language picked as they talk, from goofy antics to
  romantic gestures. Over 300 gestures and reactions are included.
- **Reactions:** an expression for every emotion at four intensities, from mild
  to intense, with anime-style effects.

### The app

- **Private and self-hostable:** runs on your computer with your own API keys
  or a local model (Ollama, LM Studio, llama.cpp or vLLM). Self-host it in your
  browser or build the desktop app yourself.
- **Make them yours:** edit your Anima's identity, memories and behaviors until
  they feel just right.
- **VRM avatars:** bring any VRM 0.x or 1.0 avatar; VRoid Studio avatars work
  best. Convert VRChat avatars with the
  [Animama Avatar Converter](https://github.com/raymond-van/animama-avatar-converter),
  and other 3D models in Blender with the
  [VRM Add-on for Blender](https://github.com/saturday06/VRM-Addon-for-Blender).
- **Voice mode:** talk hands-free with automatic end-of-turn detection. Voice
  can run fully locally.
- **Picture-in-picture:** your Anima floats in a corner above your other
  windows, with quick chat and global shortcuts.
- **Creator tools:** make your own Gestures, Reactions, and Avatar, Particle
  and Scene Effects in the app, or describe one to an AI coding agent with the
  included [skills](.agents/skills).
- **Languages:** the app and voice input in English, 日本語, 한국어 and 简体中文.

## Download

| Platform | Requires | Installer | Size |
| --- | --- | --- | --- |
| macOS | macOS 15 or later, Apple silicon | [Animama-0.1.5-arm64.dmg](https://downloads.animama.ai/desktop/v0.1.5/Animama-0.1.5-arm64.dmg) | 418 MB (889 MB installed) |
| Windows | Windows 11 x64, build 22000 or later | [Animama-0.1.6-x64-setup.exe](https://downloads.animama.ai/desktop/v0.1.6/Animama-0.1.6-x64-setup.exe) | 377 MB (988 MB installed) |

On Windows, SmartScreen may say "Windows protected your PC" because Animama is
new. Select **More info**, check that the publisher is Raymond Van, then select
**Run anyway**.

## AI

Animama is bring-your-own-key: add API keys from the providers you choose
during setup or in **App Settings**. Keys stay encrypted on your computer.

### Chat

We recommend OpenAI's GPT-6 Luna or Anthropic's Claude Haiku 5.5. Both are
low-cost, and a few dollars of API usage goes a long way. OpenRouter and other
OpenAI-compatible endpoints work too.

Local models (Ollama, LM Studio, llama.cpp, vLLM) are experimental. The
inference engine should support strict JSON output, and the model should
support tool calling.

### STT

Speech recognition runs on your computer: Parakeet for English, SenseVoice for
Japanese, Korean and Chinese. We recommend the GPU (WebGPU) version, which
shows your words as you speak. Download the CPU version in the app first.

### TTS

We recommend [ElevenLabs](https://elevenlabs.io) for the most expressive
voices. Its free tier includes about 20 minutes of speech a month; pick voices
from its [voice library](https://elevenlabs.io/voice-library).

Pocket TTS is built in and free, runs on your computer and can clone a voice.

## Self-host

<details>
<summary><h3>Desktop</h3></summary>

Build the desktop app yourself. The build is unsigned, for your own computer.
[Desktop builds](docs/frontend/desktop/platforms.md) has the details.

<details>
<summary><h4>macOS</h4></summary>

Requires an Apple silicon Mac with Xcode command-line tools, Node 24, pnpm, uv
and Git LFS.

```bash
git clone https://github.com/raymond-van/animama.git
cd animama
git lfs pull
python3 scripts/models/browser_speech.py acquire
cd src/frontend
pnpm install --frozen-lockfile
pnpm desktop:mac:build:run
```

The app is written to `src/frontend/desktop/release/mac/Animama.app`.

</details>

<details>
<summary><h4>Windows</h4></summary>

Requires Windows 11 x64 with Visual Studio 2022 (MSVC v143 14.44 toolset,
Windows SDK 10.0.26100), Node 24, pnpm, uv and Git LFS. In PowerShell:

```powershell
git clone -c core.autocrlf=false https://github.com/raymond-van/animama.git
cd animama
git lfs pull
py -3 scripts/models/browser_speech.py acquire
cd src/frontend
pnpm install --frozen-lockfile
pnpm desktop:runtime:stage -- --platform win32 --arch x64
pnpm desktop:runtime:audit -- --platform win32 --arch x64
pnpm desktop:win:installer
```

The installer is written to `src/frontend/desktop/release/`.

</details>

</details>

<details>
<summary><h3>Web</h3></summary>

Run Animama as a server on your computer and use it in your browser. Requires
macOS or Linux (Windows through WSL), Docker with Compose, Git LFS and Python
3.11 or later.

```bash
git clone https://github.com/raymond-van/animama.git
cd animama
git lfs pull
python3 scripts/models/browser_speech.py acquire  # optional: Pocket TTS and Smart Turn
ANIMAMA_WEB_BUILD_MODE=production ./reset.sh
```

Then open <http://localhost:8000>. Give the server your API keys through an
environment file outside the checkout, as
[credentials](docs/backend/operations/development.md#credentials-and-nonsecret-configuration)
describes.

The server listens only on your computer. To reach it from another device, put
your own TLS and authentication in front of it.

</details>

## Acknowledgements

- [Pocket TTS](https://github.com/kyutai-labs/pocket-tts) by Kyutai: on-device
  voices
- [Smart Turn](https://github.com/pipecat-ai/smart-turn) by Pipecat: knowing
  when you've finished speaking
- [Parakeet](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2) by NVIDIA and
  [SenseVoice](https://github.com/FunAudioLLM/SenseVoice) by FunAudioLLM:
  speech recognition
- [three-vrm](https://github.com/pixiv/three-vrm) and
  [VRoid](https://vroid.com/en) by pixiv: avatar rendering and the included
  avatars
- [Mochiya Avatar Tools](https://github.com/mochiya-labs/unity-avatar-tools) and
  [three-liltoon](https://github.com/mochiya-labs/three-liltoon) by Mochiya
  Labs: VRChat avatar conversion and lilToon materials
- [three.quarks](https://github.com/Alchemist0823/three.quarks): particle
  effects
- [Lapwing](https://booth.pm/ja/items/4993931) ©kuji

## Star history

[![Star history chart](https://api.star-history.com/svg?repos=raymond-van/animama&type=Date)](https://www.star-history.com/#raymond-van/animama&Date)

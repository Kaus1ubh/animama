<p align="center">
  <img src="docs/assets/readme-banner.jpg" alt="Animama" width="100%">
</p>

<p align="center">
  <a href="https://youtu.be/8ji_NNOfsP8">
    <img src="https://img.youtube.com/vi/8ji_NNOfsP8/maxres2.jpg" alt="观看 Animama 发布预告片" width="560">
  </a>
</p>

<p align="center">
  <a href="https://youtu.be/sWw4bSrriDE">导览视频</a> ·
  <a href="https://docs.animama.ai/zh-hans/">文档</a> ·
  <a href="https://discord.gg/pUHHRrZ2xg">Discord</a>
  <br>
  README: <a href="README.md">English</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a>
</p>

# Animama

你的新桌面伙伴，就是 Anima。Animama 会在屏幕一角放上一位迷人又富有表现力的伙伴，无论你在工作、娱乐，还是埋头熬过忙碌的一天，都有 Anima 陪在身边。

## 功能

### 你的 Anima

- **个性：** 每个 Anima 都有自己的身份设定和声音。
- **记忆：** 跨对话的长期记忆。Anima 会记下关于你的信息和你们共度的时光，这些记录都是文件，你可以阅读、编辑和回滚。
- **情绪：** 24 种情绪会随着相处而变化，并体现在表情、肢体和声音中。
- **动作：** 说话时自然挑选的肢体语言，从搞怪逗趣到浪漫撩人。内置 300 多种动作和反应。
- **反应：** 每种情绪都有从“轻微”到“极强”四个强度的表情，并配有动漫风格特效。

### 应用

- **私密且可自托管：** 使用你自己的 API 密钥或本地模型（Ollama、LM Studio、llama.cpp、vLLM）在你的电脑上运行。可以自托管后在浏览器中使用，也可以自己构建桌面应用。
- **按你的喜好打造：** 随心编辑 Anima 的身份设定、记忆和行为，直到恰到好处。
- **VRM 虚拟形象：** 支持任何 VRM 0.x 或 1.0 虚拟形象，VRoid Studio 制作的效果最好。VRChat 虚拟形象可用 [Animama Avatar Converter](https://github.com/raymond-van/animama-avatar-converter)转换，其他 3D 模型可在 Blender 中用 [VRM Add-on for Blender](https://github.com/saturday06/VRM-Addon-for-Blender)转换。
- **语音模式：** 自动检测你何时说完，无需动手即可对话。语音处理可以完全在本地运行。
- **画中画：** Anima 浮在屏幕一角、其他窗口之上，还支持快速聊天和全局快捷键。
- **创作工具：** 在应用中制作自己的动作、反应，以及形象特效、粒子特效和场景特效；也可以借助内置的[技能](.agents/skills)，向 AI 编程代理描述需求来生成。
- **语言：** 应用和语音输入支持 English、日本語、한국어 和简体中文。

## 下载

| 平台 | 系统要求 | 安装包 | 大小 |
| --- | --- | --- | --- |
| macOS | macOS 15 或更高版本，Apple 芯片 | [Animama-0.1.5-arm64.dmg](https://downloads.animama.ai/desktop/v0.1.5/Animama-0.1.5-arm64.dmg) | 418 MB（安装后 889 MB） |
| Windows | Windows 11 x64，内部版本 22000 或更高 | [Animama-0.1.6-x64-setup.exe](https://downloads.animama.ai/desktop/v0.1.6/Animama-0.1.6-x64-setup.exe) | 377 MB（安装后 988 MB） |

在 Windows 上，由于 Animama 是新应用，SmartScreen 可能会提示“Windows 已保护你的电脑”。请选择**更多信息**，确认发布者为 Raymond Van，然后选择**仍要运行**。

## AI

Animama 采用自带密钥（BYOK）模式：在初始设置或**应用设置**中添加你所选服务商的 API 密钥。密钥会加密保存在你的电脑上。

### 聊天

推荐使用 OpenAI 的 GPT-6 Luna 或 Anthropic 的 Claude Haiku 5.5。两者成本都很低，几美元的 API 用量就能用很久。也支持 OpenRouter 和其他兼容 OpenAI 的接口。

本地模型（Ollama、LM Studio、llama.cpp、vLLM）仍属实验性支持。推理引擎应支持严格的 JSON 输出，模型应支持工具调用。

### 语音识别（STT）

语音识别在你的电脑上运行：英语使用 Parakeet，日语、韩语和中文使用 SenseVoice。推荐使用 GPU（WebGPU）版本，说话时文字会实时显示。请先在应用中下载 CPU 版本。

### 语音合成（TTS）

想要最富表现力的声音，推荐使用 [ElevenLabs](https://elevenlabs.io)。免费套餐每月约含 20 分钟语音，可从其[声音库](https://elevenlabs.io/voice-library)中挑选声音。

Pocket TTS 内置且免费，在你的电脑上运行，并支持语音克隆。

## 自托管

<details>
<summary><h3>桌面端</h3></summary>

自己构建桌面应用。构建产物未签名，仅供在你自己的电脑上使用。详情见[桌面构建](docs/frontend/desktop/platforms.md)（英文）。

<details>
<summary><h4>macOS</h4></summary>

需要一台装有 Xcode 命令行工具、Node 24、pnpm、uv 和 Git LFS 的 Apple 芯片 Mac。

```bash
git clone https://github.com/raymond-van/animama.git
cd animama
git lfs pull
python3 scripts/models/browser_speech.py acquire
cd src/frontend
pnpm install --frozen-lockfile
pnpm desktop:mac:build:run
```

应用会生成在 `src/frontend/desktop/release/mac/Animama.app`。

</details>

<details>
<summary><h4>Windows</h4></summary>

需要装有 Visual Studio 2022（MSVC v143 14.44 工具集、Windows SDK 10.0.26100）、Node 24、pnpm、uv 和 Git LFS 的 Windows 11 x64。在 PowerShell 中运行：

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

安装包会生成在 `src/frontend/desktop/release/`。

</details>

</details>

<details>
<summary><h3>网页端</h3></summary>

在你的电脑上把 Animama 作为服务器运行，并在浏览器中使用。需要 macOS 或 Linux（Windows 可通过 WSL）、Docker 及 Compose、Git LFS，以及 Python 3.11 或更高版本。

```bash
git clone https://github.com/raymond-van/animama.git
cd animama
git lfs pull
python3 scripts/models/browser_speech.py acquire  # 可选：Pocket TTS 和 Smart Turn
ANIMAMA_WEB_BUILD_MODE=production ./reset.sh
```

然后打开 <http://localhost:8000>。通过放在检出目录之外的环境文件把 API 密钥提供给服务器，具体见[凭据配置](docs/backend/operations/development.md#credentials-and-nonsecret-configuration)（英文）。

服务器只在你的电脑上监听。如需从其他设备访问，请在前面加上你自己的 TLS 和身份验证。

</details>

## 致谢

- [Pocket TTS](https://github.com/kyutai-labs/pocket-tts)（Kyutai）：在设备上运行的语音合成
- [Smart Turn](https://github.com/pipecat-ai/smart-turn)（Pipecat）：判断你何时说完
- [Parakeet](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2)（NVIDIA）和 [SenseVoice](https://github.com/FunAudioLLM/SenseVoice)（FunAudioLLM）：语音识别
- [three-vrm](https://github.com/pixiv/three-vrm) 和 [VRoid](https://vroid.com/en)（pixiv）：虚拟形象渲染和内置虚拟形象
- [Mochiya Avatar Tools](https://github.com/mochiya-labs/unity-avatar-tools) 和 [three-liltoon](https://github.com/mochiya-labs/three-liltoon)（Mochiya Labs）：VRChat 虚拟形象转换和 lilToon 材质
- [three.quarks](https://github.com/Alchemist0823/three.quarks)：粒子特效
- [Lapwing](https://booth.pm/zh-cn/items/4993931) ©kuji

## Star 历史

[![Star 数量变化图](https://api.star-history.com/svg?repos=raymond-van/animama&type=Date)](https://www.star-history.com/#raymond-van/animama&Date)

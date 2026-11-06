# LifeOS 语音 · Whisper（独立语音 APP · v1.2）

一个**独立打包**的端侧语音转文字 APP，基于 Whisper（transformers.js WASM），支持**中文 + 英文混说**，最长可录 **5 分钟**，完全在手机本地运行。

> 本分支 `whisper-voice-1.2` 是单独的开发项：把"语音输入"做成可独立安装、独立测试的 APP。LifeOS 主程序在 `main` 分支。

## 为什么这么搭（背景）
在安卓 WebView 里用 `getUserMedia` 采麦克风是一条死路：
- `MediaRecorder.start()` 报 `Could not start audio source`（WebView 已占用 AudioRecord，二次打开必失败）；
- `ScriptProcessorNode.onaudioprocess` 在 MIUI / Redmi 的 WebView 上经常不触发，导致采不到音。

原生 Vosk 插件也被否决：Vosk 是单语言模型，一次只能识别一种语言，无法一句话中英无缝混说。

**结论**：采集走**原生 `AudioRecord`**，转写走 **Whisper 多语言模型**（天然支持中英混说）。二者通过原生桥 `AndroidVoice` 衔接，彻底绕开 WebView 采集死穴。

## 架构
```
原生安卓 (AudioRecord @16kHz 单声道)
   │  录音 → 写 WAV
   ▼
VoiceCapture.java  ──addJavascriptInterface──▶  window.AndroidVoice.start()/stop()
   │  停止后把 WAV 以 Base64 分块回传
   ▼
index.html (WebView)
   │  Base64 → Blob(WAV) → decodeAudioData → 重采样 16k
   ▼
transformers.js Whisper (Xenova/whisper-tiny, wasm/q8)  →  文本
```

- 采集：完全原生，不依赖 WebView 麦克风权限流程（仍声明并申请 `RECORD_AUDIO`）。
- 转写：`Xenova/whisper-tiny` 多语言模型，不强制语言，自动判定，保留中英混说。
- 不需要 NDK；当前 JDK + Android SDK 工具链即可构建。

## 构建与安装
环境：JDK 17、Android SDK（含 platform-tools / adb）、Node + Capacitor CLI。

```bash
# 1. 同步 web 资源
npm run copy

# 2. 构建 debug APK（使用本机 JDK / SDK 路径）
export JAVA_HOME="/c/Program Files/Microsoft/jdk-17.0.19.10-hotspot"
export ANDROID_HOME="/c/Android"
cd android && ./gradlew assembleDebug --no-daemon

# 3. 安装到已连接的设备
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

## 使用
1. 首次打开会从 CDN 下载约 75MB 的 Whisper 模型（需联网一次，之后离线可用；进度条可见）。
2. 点按中央麦克风 **开始录音**（再次点按 **停止**）。
3. 停止后自动转写，文字出现在下方文本框；可用「复制结果 / 清空」。
4. 点「调试」可展开 `[rec]` 运行日志，便于排查。

## 已知限制（v1.2）
- **首次模型下载**约 75MB，弱网下较慢；之后离线。
- Whisper 走 WASM 单线程（Capacitor WebView 未设 COOP/COEP，无法启用多线程），长音频转写偏慢，属正常。
- 录音硬上限 **5 分钟**，到点自动停止。
- 模型为 `whisper-tiny`（速度优先）；如需更高中文准确率，可换 `whisper-small`（更慢更大）。

## 文件结构
- `index.html` / `www/index.html`：独立语音转写界面与 Whisper 调用逻辑。
- `android/app/src/main/java/com/lifeos/app/VoiceCapture.java`：原生采集桥（AudioRecord → WAV → Base64）。
- `android/app/src/main/java/com/lifeos/app/MainActivity.java`：挂载 `AndroidVoice` 到 WebView。

## 许可
见仓库 LICENSE。

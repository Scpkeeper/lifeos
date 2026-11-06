# LifeOS Voice · Whisper (standalone voice app · v1.2)

A **standalone, on-device** speech-to-text app built on Whisper (transformers.js WASM). It handles **Chinese + English** (including code-switching within one utterance), records up to **5 minutes**, and runs entirely on the phone.

> This branch `whisper-voice-1.2` is a separate work item: the voice-input feature packaged as an independently installable/testable app. The main LifeOS app lives on the `main` branch.

## Why this architecture (背景 / background)
Capturing the microphone via `getUserMedia` inside an Android WebView is a dead end:
- `MediaRecorder.start()` throws `Could not start audio source` (the WebView already holds the mic's `AudioRecord`; a second opener always fails);
- `ScriptProcessorNode.onaudioprocess` frequently never fires on MIUI / Redmi WebViews, so no audio is captured.

The native Vosk plugin was also rejected: Vosk uses single-language models — one model recognizes one language per session — so it cannot seamlessly mix zh+en in a single sentence.

**Decision**: capture with the **native `AudioRecord`**, transcribe with the **multilingual Whisper model** (which naturally handles zh+en). A native bridge `AndroidVoice` connects the two, fully bypassing the WebView capture wall.

## Architecture
```
Native Android (AudioRecord @16kHz mono)
   │  record → write WAV
   ▼
VoiceCapture.java  ──addJavascriptInterface──▶  window.AndroidVoice.start()/stop()
   │  on stop, return WAV as Base64 in chunks
   ▼
index.html (WebView)
   │  Base64 → Blob(WAV) → decodeAudioData → resample to 16k
   ▼
transformers.js Whisper (Xenova/whisper-tiny, wasm/q8)  →  text
```

- Capture is fully native (still declares & requests `RECORD_AUDIO`).
- Transcription uses the `Xenova/whisper-tiny` multilingual model, with language left auto-detected to preserve zh+en mixing.
- No NDK required; builds with the existing JDK + Android SDK toolchain.

## Build & install
Requirements: JDK 17, Android SDK (platform-tools / adb), Node + Capacitor CLI.

```bash
# 1. sync web assets
npm run copy

# 2. build debug APK (use your local JDK / SDK paths)
export JAVA_HOME="/c/Program Files/Microsoft/jdk-17.0.19.10-hotspot"
export ANDROID_HOME="/c/Android"
cd android && ./gradlew assembleDebug --no-daemon

# 3. install on a connected device
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

## Usage
1. On first launch the ~75MB Whisper model downloads from CDN (needs network once; offline afterwards; progress bar visible).
2. Tap the center mic to **start recording** (tap again to **stop**).
3. After stopping, transcription runs automatically and the text appears in the box below; use "复制结果 / 清空" (copy / clear).
4. Tap "调试" (debug) to expand the `[rec]` runtime log for troubleshooting.

## Known limitations (v1.2)
- **First-run model download** is ~75MB; slower on weak networks, then offline.
- Whisper runs single-threaded WASM (Capacitor WebView has no COOP/COEP, so multithreading is unavailable); long clips transcribe slowly — expected.
- Hard cap of **5 minutes** per recording, auto-stop at the limit.
- Model is `whisper-tiny` (speed-first); swap to `whisper-small` for higher Chinese accuracy (slower, larger).

## File structure
- `index.html` / `www/index.html`: standalone transcription UI and Whisper call logic.
- `android/app/src/main/java/com/lifeos/app/VoiceCapture.java`: native capture bridge (AudioRecord → WAV → Base64).
- `android/app/src/main/java/com/lifeos/app/MainActivity.java`: wires `AndroidVoice` into the WebView.

## License
See repository LICENSE.

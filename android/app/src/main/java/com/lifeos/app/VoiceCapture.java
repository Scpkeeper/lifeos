package com.lifeos.app;

import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import java.io.ByteArrayOutputStream;

/**
 * Native audio capture bridge exposed to JS as window.AndroidVoice.
 * Records mono 16 kHz PCM via AudioRecord, wraps it in a WAV container on stop,
 * and returns the WAV to JS as Base64 in chunks (window.__voiceChunk / __voiceStopped).
 *
 * Why native: Android WebView's getUserMedia is unreliable on MIUI/Redmi (MediaRecorder
 * throws "Could not start audio source"; ScriptProcessor onaudioprocess never fires).
 * Capturing natively sidesteps the whole WebView capture wall; the WAV is then handed
 * to Whisper (WASM) on the web side.
 */
public class VoiceCapture {
    private final WebView webView;
    private AudioRecord recorder = null;
    private HandlerThread thread = null;
    private ByteArrayOutputStream pcm = null;
    private volatile boolean recording = false;
    private volatile boolean stopRequested = false;
    private volatile boolean started = false;

    private static final int SAMPLE_RATE = 16000;
    private static final int MAX_MS = 5 * 60 * 1000; // hard cap 5 minutes
    private static final int CHUNK_B64 = 1_000_000;   // ~1 MB base64 per JS call

    public VoiceCapture(WebView webView) {
        this.webView = webView;
    }

    @JavascriptInterface
    public void start() {
        if (started) return;
        try {
            int minBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            int bufSize = Math.max(minBuf, SAMPLE_RATE * 2);
            recorder = new AudioRecord(MediaRecorder.AudioSource.MIC, SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bufSize);
            if (recorder.getState() != AudioRecord.STATE_INITIALIZED) {
                try { recorder.release(); } catch (Exception ignore) {}
                recorder = null;
                error("麦克风初始化失败（AudioRecord 未就绪，请确认已授予麦克风权限）");
                return;
            }
            pcm = new ByteArrayOutputStream();
            recording = true;
            stopRequested = false;
            started = true;
            thread = new HandlerThread("voice-capture");
            thread.start();
            new Handler(thread.getLooper()).post(this::readLoop);
        } catch (SecurityException se) {
            error("没有麦克风权限：" + se.getMessage());
        } catch (Exception e) {
            error("录音启动失败：" + e.getMessage());
        }
    }

    @JavascriptInterface
    public void stop() {
        if (!started) return;
        stopRequested = true;
        recording = false;
    }

    private void readLoop() {
        final AudioRecord rec = recorder;
        if (rec == null) { finalizeStop(new byte[0]); return; }
        short[] buffer = new short[SAMPLE_RATE / 10]; // 100 ms
        byte[] bytes = new byte[buffer.length * 2];
        long startedAt = System.currentTimeMillis();
        try {
            rec.startRecording();
        } catch (Exception e) {
            finalizeStop(new byte[0]);
            return;
        }
        while (recording && !stopRequested) {
            int n = rec.read(buffer, 0, buffer.length);
            if (n <= 0) continue;
            for (int i = 0; i < n; i++) {
                short s = buffer[i];
                bytes[i * 2] = (byte) (s & 0xff);
                bytes[i * 2 + 1] = (byte) ((s >> 8) & 0xff);
            }
            pcm.write(bytes, 0, n * 2);
            if (System.currentTimeMillis() - startedAt > MAX_MS) break;
        }
        try { rec.stop(); } catch (Exception ignore) {}
        try { rec.release(); } catch (Exception ignore) {}
        recorder = null;
        finalizeStop(pcm != null ? pcm.toByteArray() : new byte[0]);
    }

    private void finalizeStop(byte[] pcmData) {
        started = false;
        if (thread != null) { try { thread.quitSafely(); } catch (Exception ignore) {} thread = null; }
        if (pcmData == null || pcmData.length == 0) {
            error("没有录到音频（请对着麦克风说话，或检查麦克风权限）");
            return;
        }
        try {
            byte[] wav = pcmToWav(pcmData, SAMPLE_RATE);
            final String b64 = Base64.encodeToString(wav, Base64.NO_WRAP);
            int total = b64.length();
            runOnUi(() -> webView.evaluateJavascript("window.__voiceChunk && (window.__voiceChunks=[])", null));
            for (int i = 0; i < total; i += CHUNK_B64) {
                int end = Math.min(total, i + CHUNK_B64);
                final String part = b64.substring(i, end);
                runOnUi(() -> webView.evaluateJavascript(
                        "window.__voiceChunks.push('" + part + "')", null));
            }
            runOnUi(() -> webView.evaluateJavascript("window.__voiceStopped && window.__voiceStopped()", null));
        } catch (Exception e) {
            error("生成 WAV 失败：" + e.getMessage());
        }
    }

    private void error(String msg) {
        final String m = escapeJs(msg);
        runOnUi(() -> webView.evaluateJavascript("window.__voiceError && window.__voiceError('" + m + "')", null));
    }

    private void runOnUi(Runnable r) {
        if (webView != null) webView.post(r);
    }

    private static String escapeJs(String s) {
        return s.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n").replace("\r", "");
    }

    private static byte[] pcmToWav(byte[] pcm, int sampleRate) {
        int dataLen = pcm.length;
        int totalLen = 44 + dataLen;
        byte[] out = new byte[totalLen];
        // RIFF header
        writeStr(out, 0, "RIFF");
        writeInt(out, 4, totalLen - 8);
        writeStr(out, 8, "WAVE");
        // fmt chunk
        writeStr(out, 12, "fmt ");
        writeInt(out, 16, 16);                 // PCM chunk size
        writeShort(out, 20, (short) 1);        // PCM format
        writeShort(out, 22, (short) 1);        // mono
        writeInt(out, 24, sampleRate);
        writeInt(out, 28, sampleRate * 2);     // byte rate (mono * 16-bit)
        writeShort(out, 32, (short) 2);        // block align
        writeShort(out, 34, (short) 16);       // bits per sample
        // data chunk
        writeStr(out, 36, "data");
        writeInt(out, 40, dataLen);
        System.arraycopy(pcm, 0, out, 44, dataLen);
        return out;
    }

    private static void writeInt(byte[] b, int off, int v) {
        b[off] = (byte) (v & 0xff);
        b[off + 1] = (byte) ((v >> 8) & 0xff);
        b[off + 2] = (byte) ((v >> 16) & 0xff);
        b[off + 3] = (byte) ((v >> 24) & 0xff);
    }

    private static void writeShort(byte[] b, int off, short v) {
        b[off] = (byte) (v & 0xff);
        b[off + 1] = (byte) ((v >> 8) & 0xff);
    }

    private static void writeStr(byte[] b, int off, String s) {
        for (int i = 0; i < s.length(); i++) b[off + i] = (byte) s.charAt(i);
    }
}

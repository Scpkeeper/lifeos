package com.lifeos.app;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;
import android.Manifest;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

public class MainActivity extends BridgeActivity {
    private static final int REQUEST_RECORD_AUDIO = 2001;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // The WebView can only capture the microphone via getUserMedia if the app itself
        // holds the RECORD_AUDIO dangerous permission at the OS level. If it isn't granted
        // yet, prompt for it (no-op once already granted by the user in Settings).
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this,
                new String[]{ Manifest.permission.RECORD_AUDIO }, REQUEST_RECORD_AUDIO);
        }
    }

    @Override
    protected void load() {
        super.load();
        // Replace the default WebChromeClient with one that force-grants the page's
        // media-capture request (mic) from our localhost origin. Without this, getUserMedia
        // rejects with "permission denied" even though RECORD_AUDIO is declared/granted.
        WebView wv = getBridge().getWebView();
        if (wv != null) {
            wv.setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
                @Override
                public void onPermissionRequest(final PermissionRequest request) {
                    runOnUiThread(() -> request.grant(request.getResources()));
                }
            });
        }
    }
}

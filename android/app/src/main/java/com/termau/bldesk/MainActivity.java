package com.termau.bldesk;

import android.content.res.Configuration;
import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins written in this app are registered before the bridge starts.
        registerPlugin(FileSavePlugin.class);
        super.onCreate(savedInstanceState);
    }

    /**
     * The manifest handles fontScale itself (android:configChanges), so changing the system font size no longer
     * destroys the activity and the open page with it. The WebView only reads the font scale when it is created,
     * though, so pass the new scale on here; otherwise the new size would show only after a restart.
     */
    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (bridge == null) return;
        WebView webView = bridge.getWebView();
        if (webView != null) webView.getSettings().setTextZoom(Math.round(newConfig.fontScale * 100));
    }
}

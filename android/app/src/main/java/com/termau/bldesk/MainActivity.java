package com.termau.bldesk;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugin: TCP reachability, which a WebView cannot do itself.
        registerPlugin(NetProbePlugin.class);
        super.onCreate(savedInstanceState);
    }
}

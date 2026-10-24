package com.rnappauth.browser;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;

/**
 * Receives presses on Custom Tabs menu items created from `browser.header.buttons` and forwards
 * them to JS as `headerButtonPress` events.
 */
public final class HeaderButtonReceiver extends BroadcastReceiver {

    static final String EXTRA_BUTTON_ID = "com.rnappauth.HEADER_BUTTON_ID";

    static PendingIntent createPendingIntent(Context context, String buttonId, int requestCode) {
        Intent intent = new Intent(context, HeaderButtonReceiver.class);
        intent.putExtra(EXTRA_BUTTON_ID, buttonId);
        // Explicit intent; mutable so the browser can attach the current URL as intent data.
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags |= PendingIntent.FLAG_MUTABLE;
        }
        return PendingIntent.getBroadcast(context, requestCode, intent, flags);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        String buttonId = intent.getStringExtra(EXTRA_BUTTON_ID);
        if (buttonId == null) return;
        Bundle event = new Bundle();
        event.putString("mode", BrowserOptions.MODE_CUSTOM_TAB);
        event.putString("buttonId", buttonId);
        if (intent.getDataString() != null) {
            event.putString("url", intent.getDataString());
        }
        BrowserBridge.get().emit("headerButtonPress", event);
    }
}

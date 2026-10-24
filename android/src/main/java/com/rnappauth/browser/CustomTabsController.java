package com.rnappauth.browser;

import android.content.ComponentName;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Browser;
import android.util.Log;
import android.util.TypedValue;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.browser.customtabs.CustomTabColorSchemeParams;
import androidx.browser.customtabs.CustomTabsCallback;
import androidx.browser.customtabs.CustomTabsClient;
import androidx.browser.customtabs.CustomTabsIntent;
import androidx.browser.customtabs.CustomTabsService;
import androidx.browser.customtabs.CustomTabsServiceConnection;
import androidx.browser.customtabs.CustomTabsSession;
import androidx.browser.customtabs.TrustedWebUtils;
import androidx.core.content.ContextCompat;

import com.rnappauth.R;

import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * Owns the Custom Tabs connection used for one authorization / end-session flow so that we get
 * navigation callbacks, partial tabs and a postMessage channel (which AppAuth's own internal
 * session does not expose).
 */
public final class CustomTabsController implements BrowserBridge.MessageTarget {

    private static final String TAG = "RNAppAuth";
    private static final String MODE = BrowserOptions.MODE_CUSTOM_TAB;
    private static final long CONNECT_TIMEOUT_MS = 1000;

    private static final ExecutorService IPC = Executors.newSingleThreadExecutor();

    private final Context context;
    private final BrowserOptions options;
    private final CountDownLatch sessionLatch = new CountDownLatch(1);
    @Nullable private CustomTabsServiceConnection connection;
    @Nullable private volatile CustomTabsSession session;
    private boolean channelRequested;
    private boolean channelReady;
    private boolean disposed;

    public CustomTabsController(@NonNull Context context, @NonNull BrowserOptions options) {
        this.context = context.getApplicationContext();
        this.options = options;
    }

    /**
     * Binds to the browser's Custom Tabs service and waits (worker thread only) up to one second
     * for a session. Without a session the tab still works, but without events/messaging.
     */
    public void connect(@Nullable String browserPackage) {
        if (browserPackage == null) {
            sessionLatch.countDown();
            return;
        }
        connection = new CustomTabsServiceConnection() {
            @Override
            public void onCustomTabsServiceConnected(@NonNull ComponentName name, @NonNull CustomTabsClient client) {
                try {
                    client.warmup(0L);
                    CustomTabsSession newSession = client.newSession(new Callback());
                    session = newSession;
                    if (newSession != null && options.canMessageCustomTab()) {
                        Uri origin = Uri.parse(options.messaging.androidOrigin);
                        newSession.validateRelationship(CustomTabsService.RELATION_USE_AS_ORIGIN, origin, null);
                    }
                } catch (Exception e) {
                    Log.w(TAG, "Unable to create Custom Tabs session", e);
                } finally {
                    sessionLatch.countDown();
                }
            }

            @Override
            public void onServiceDisconnected(ComponentName name) {
                session = null;
                sessionLatch.countDown();
            }
        };
        try {
            if (!CustomTabsClient.bindCustomTabsService(context, browserPackage, connection)) {
                connection = null;
                sessionLatch.countDown();
                return;
            }
            sessionLatch.await(CONNECT_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        } catch (Exception e) {
            sessionLatch.countDown();
        }
    }

    @Nullable
    public CustomTabsSession getSession() {
        return session;
    }

    /** Builds the Custom Tabs intent with every header / appearance option applied. */
    @NonNull
    public CustomTabsIntent buildIntent(boolean ephemeral, boolean trustedWebActivity) {
        CustomTabsSession currentSession = session;
        CustomTabsIntent.Builder builder = currentSession != null
                ? new CustomTabsIntent.Builder(currentSession)
                : new CustomTabsIntent.Builder();
        BrowserOptions.Header header = options.header;

        CustomTabColorSchemeParams light = colorParams(header.colors);
        if (light != null) builder.setDefaultColorSchemeParams(light);
        if (header.dark != null) {
            CustomTabColorSchemeParams dark = colorParams(header.colors.merge(header.dark));
            if (dark != null) builder.setColorSchemeParams(CustomTabsIntent.COLOR_SCHEME_DARK, dark);
        }
        if ("dark".equals(header.colorScheme)) {
            builder.setColorScheme(CustomTabsIntent.COLOR_SCHEME_DARK);
        } else if ("light".equals(header.colorScheme)) {
            builder.setColorScheme(CustomTabsIntent.COLOR_SCHEME_LIGHT);
        }

        if (header.showTitle != null) builder.setShowTitle(header.showTitle);
        if (header.hideUrlBarOnScroll != null) builder.setUrlBarHidingEnabled(header.hideUrlBarOnScroll);
        if (header.shareButton != null) {
            builder.setShareState(header.shareButton ? CustomTabsIntent.SHARE_STATE_ON : CustomTabsIntent.SHARE_STATE_OFF);
        }
        builder.setCloseButtonPosition("end".equals(header.closeButtonPosition)
                ? CustomTabsIntent.CLOSE_BUTTON_POSITION_END
                : CustomTabsIntent.CLOSE_BUTTON_POSITION_START);
        if ("back".equals(header.closeButtonStyle)) {
            Bitmap icon = drawableToBitmap(R.drawable.rnappauth_ic_arrow_back);
            if (icon != null) builder.setCloseButtonIcon(icon);
        }

        // Header buttons become overflow menu items; presses are reported as headerButtonPress events.
        int requestCode = 0;
        for (BrowserOptions.HeaderButton button : header.buttons) {
            builder.addMenuItem(button.title, HeaderButtonReceiver.createPendingIntent(context, button.id, requestCode++));
        }

        applyAnimations(builder);
        applyPartial(builder, currentSession != null);

        if (ephemeral) builder.setEphemeralBrowsingEnabled(true);

        CustomTabsIntent intent = builder.build();
        if (trustedWebActivity) {
            intent.intent.putExtra(TrustedWebUtils.EXTRA_LAUNCH_AS_TRUSTED_WEB_ACTIVITY, true);
        }
        if (!options.headers.isEmpty()) {
            Bundle headers = new Bundle();
            for (Map.Entry<String, String> entry : options.headers.entrySet()) {
                headers.putString(entry.getKey(), entry.getValue());
            }
            intent.intent.putExtra(Browser.EXTRA_HEADERS, headers);
        }
        return intent;
    }

    @Nullable
    private CustomTabColorSchemeParams colorParams(BrowserOptions.HeaderColors colors) {
        if (colors.isEmpty()) return null;
        CustomTabColorSchemeParams.Builder params = new CustomTabColorSchemeParams.Builder();
        if (colors.backgroundColor != null) params.setToolbarColor(colors.backgroundColor);
        if (colors.secondaryColor != null) params.setSecondaryToolbarColor(colors.secondaryColor);
        if (colors.navigationBarColor != null) params.setNavigationBarColor(colors.navigationBarColor);
        if (colors.navigationBarDividerColor != null) {
            params.setNavigationBarDividerColor(colors.navigationBarDividerColor);
        }
        return params.build();
    }

    private void applyAnimations(CustomTabsIntent.Builder builder) {
        if (options.animation == null) return;
        switch (options.animation) {
            case "slide":
                builder.setStartAnimations(context, R.anim.rnappauth_slide_in_right, R.anim.rnappauth_slide_out_left);
                builder.setExitAnimations(context, R.anim.rnappauth_slide_in_left, R.anim.rnappauth_slide_out_right);
                break;
            case "fade":
                builder.setStartAnimations(context, android.R.anim.fade_in, android.R.anim.fade_out);
                builder.setExitAnimations(context, android.R.anim.fade_in, android.R.anim.fade_out);
                break;
            case "none":
                builder.setStartAnimations(context, 0, 0);
                builder.setExitAnimations(context, 0, 0);
                break;
            default:
                break;
        }
    }

    private void applyPartial(CustomTabsIntent.Builder builder, boolean hasSession) {
        BrowserOptions.Partial partial = options.partial;
        if (partial == null) return;
        if (!hasSession) {
            Log.w(TAG, "Partial Custom Tabs need a Custom Tabs session; opening a full screen tab instead");
        }
        int resize = partial.resizable
                ? CustomTabsIntent.ACTIVITY_HEIGHT_ADJUSTABLE
                : CustomTabsIntent.ACTIVITY_HEIGHT_FIXED;
        if (partial.height != null) builder.setInitialActivityHeightPx(dpToPx(partial.height), resize);
        if (partial.width != null) builder.setInitialActivityWidthPx(dpToPx(partial.width));
        if (partial.breakpoint != null) builder.setActivitySideSheetBreakpointDp(partial.breakpoint.intValue());
        if (partial.cornerRadius != null) builder.setToolbarCornerRadiusDp(partial.cornerRadius.intValue());
        if (partial.backgroundInteraction != null) {
            builder.setBackgroundInteractionEnabled(partial.backgroundInteraction);
        }
    }

    private int dpToPx(double dp) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, (float) dp,
                context.getResources().getDisplayMetrics()));
    }

    @Nullable
    private Bitmap drawableToBitmap(int resId) {
        Drawable drawable = ContextCompat.getDrawable(context, resId);
        if (drawable == null) return null;
        Bitmap bitmap = Bitmap.createBitmap(Math.max(drawable.getIntrinsicWidth(), 1),
                Math.max(drawable.getIntrinsicHeight(), 1), Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        drawable.setBounds(0, 0, canvas.getWidth(), canvas.getHeight());
        drawable.draw(canvas);
        return bitmap;
    }

    /** Called on the main thread right before the tab is launched. */
    public void onLaunched() {
        BrowserBridge.get().attach(this, MODE);
        BrowserBridge.get().emit("opened", MODE, null, null);
    }

    /** Releases the service binding. Safe to call more than once. */
    public void dispose() {
        BrowserBridge.get().runOnMain(() -> {
            if (disposed) return;
            disposed = true;
            BrowserBridge.get().detach(this);
            if (connection != null) {
                try {
                    context.unbindService(connection);
                } catch (Exception ignored) {
                    // Already unbound.
                }
                connection = null;
            }
            session = null;
        });
    }

    // ---- MessageTarget ---------------------------------------------------------------------------

    @Override
    public boolean isMessagingReady() {
        return channelReady && session != null;
    }

    @Override
    public boolean supportsMessaging() {
        return options.canMessageCustomTab();
    }

    @Override
    public boolean deliverMessage(@NonNull final String message) {
        final CustomTabsSession current = session;
        if (current == null || !channelReady) return false;
        IPC.execute(() -> {
            int result = current.postMessage(message, null);
            if (result != CustomTabsService.RESULT_SUCCESS) {
                Bundle extras = new Bundle();
                extras.putString("mode", MODE);
                extras.putString("error", "postMessage failed with result " + result);
                extras.putString("data", message);
                BrowserBridge.get().emit("messageChannelFailed", extras);
            }
        });
        return true;
    }

    private void requestChannel() {
        final CustomTabsSession current = session;
        if (current == null || channelRequested || !options.canMessageCustomTab()) return;
        channelRequested = true;
        final Uri origin = Uri.parse(options.messaging.androidOrigin);
        final Uri target = options.messaging.androidTargetOrigin != null
                ? Uri.parse(options.messaging.androidTargetOrigin) : null;
        IPC.execute(() -> {
            boolean requested;
            try {
                requested = target != null
                        ? current.requestPostMessageChannel(origin, target, new Bundle())
                        : current.requestPostMessageChannel(origin);
            } catch (Exception e) {
                requested = false;
            }
            if (!requested) {
                Bundle extras = new Bundle();
                extras.putString("mode", MODE);
                extras.putString("error", "The browser refused to open a postMessage channel");
                BrowserBridge.get().emit("messageChannelFailed", extras);
            }
        });
    }

    private final class Callback extends CustomTabsCallback {
        @Override
        public void onNavigationEvent(final int navigationEvent, @Nullable Bundle extras) {
            BrowserBridge.get().runOnMain(() -> {
                if (disposed) return;
                String type;
                switch (navigationEvent) {
                    case NAVIGATION_STARTED: type = "navigationStarted"; break;
                    case NAVIGATION_FINISHED: type = "navigationFinished"; break;
                    case NAVIGATION_FAILED: type = "navigationFailed"; break;
                    case NAVIGATION_ABORTED: type = "navigationAborted"; break;
                    case TAB_SHOWN: type = "tabShown"; break;
                    case TAB_HIDDEN: type = "tabHidden"; break;
                    default: return;
                }
                BrowserBridge.get().emit(type, MODE, null, null);
                if (navigationEvent == NAVIGATION_FINISHED) {
                    requestChannel();
                }
            });
        }

        @Override
        public void onMessageChannelReady(@Nullable Bundle extras) {
            BrowserBridge.get().runOnMain(() -> {
                if (disposed) return;
                channelReady = true;
                BrowserBridge.get().emit("messageChannelReady", MODE, "origin", options.messaging.androidOrigin);
                BrowserBridge.get().onMessagingReady(CustomTabsController.this, options.messaging.initialMessages);
            });
        }

        @Override
        public void onPostMessage(@NonNull final String message, @Nullable Bundle extras) {
            Bundle event = new Bundle();
            event.putString("mode", MODE);
            event.putString("data", message);
            if (options.messaging.androidTargetOrigin != null) {
                event.putString("origin", options.messaging.androidTargetOrigin);
            }
            BrowserBridge.get().emit("message", event);
        }

        @Override
        public void onRelationshipValidationResult(int relation, @NonNull Uri requestedOrigin,
                                                   boolean result, @Nullable Bundle extras) {
            if (!result) {
                Bundle event = new Bundle();
                event.putString("mode", MODE);
                event.putString("origin", requestedOrigin.toString());
                event.putString("error", "Digital Asset Links validation failed for " + requestedOrigin
                        + " (delegate_permission/common.use_as_origin)");
                BrowserBridge.get().emit("messageChannelFailed", event);
            }
        }
    }
}

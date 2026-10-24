package com.rnappauth.browser;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.MainThread;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import java.util.ArrayList;
import java.util.List;

/**
 * Process wide hub connecting the JS module, the Custom Tabs session and the embedded web view.
 *
 * - Keeps messages posted from JS before a browser is open (or before its channel is ready) and
 *   flushes them as soon as a target reports it is ready.
 * - Forwards browser events (navigation, messages, header buttons, ...) to JS.
 *
 * All state is confined to the main thread.
 */
public final class BrowserBridge {

    public static final String RESULT_DELIVERED = "delivered";
    public static final String RESULT_QUEUED = "queued";
    public static final String RESULT_UNSUPPORTED = "unsupported";

    /** Something able to deliver a string message to the page. */
    public interface MessageTarget {
        /** True once messages can be delivered right now. */
        boolean isMessagingReady();

        /** True if this target can ever deliver messages (channel configured). */
        boolean supportsMessaging();

        /** Delivers a message, returns false if the browser refused it. */
        boolean deliverMessage(@NonNull String message);
    }

    /** Receives events that must be forwarded to JS. */
    public interface EventSink {
        void onBrowserEvent(@NonNull Bundle event);
    }

    private static final BrowserBridge INSTANCE = new BrowserBridge();

    public static BrowserBridge get() {
        return INSTANCE;
    }

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final List<String> pendingMessages = new ArrayList<>();
    @Nullable private MessageTarget target;
    @Nullable private EventSink sink;
    @Nullable private String currentMode;

    private BrowserBridge() {}

    public void setEventSink(@Nullable EventSink sink) {
        runOnMain(() -> this.sink = sink);
    }

    public void runOnMain(@NonNull Runnable runnable) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            runnable.run();
        } else {
            mainHandler.post(runnable);
        }
    }

    @MainThread
    public void attach(@NonNull MessageTarget newTarget, @NonNull String mode) {
        target = newTarget;
        currentMode = mode;
    }

    @MainThread
    public void detach(@NonNull MessageTarget oldTarget) {
        if (target == oldTarget) {
            target = null;
            currentMode = null;
        }
    }

    @MainThread
    public boolean hasTarget() {
        return target != null;
    }

    /** Called by JS `postMessage()`. */
    @MainThread
    @NonNull
    public String postMessage(@NonNull String message) {
        MessageTarget current = target;
        if (current != null && !current.supportsMessaging()) {
            return RESULT_UNSUPPORTED;
        }
        if (current != null && current.isMessagingReady() && pendingMessages.isEmpty()) {
            return current.deliverMessage(message) ? RESULT_DELIVERED : RESULT_UNSUPPORTED;
        }
        pendingMessages.add(message);
        return RESULT_QUEUED;
    }

    @MainThread
    public void clearPendingMessages() {
        pendingMessages.clear();
    }

    /**
     * Called by a target once its channel becomes ready: delivers the per-session initial messages,
     * then every message queued from JS.
     */
    @MainThread
    public void onMessagingReady(@NonNull MessageTarget readyTarget, @NonNull List<String> initialMessages) {
        if (readyTarget != target) return;
        for (String message : initialMessages) {
            readyTarget.deliverMessage(message);
        }
        while (!pendingMessages.isEmpty() && readyTarget.isMessagingReady()) {
            String message = pendingMessages.remove(0);
            if (!readyTarget.deliverMessage(message)) {
                pendingMessages.add(0, message);
                break;
            }
        }
    }

    public void emit(@NonNull String type, @Nullable Bundle extras) {
        final Bundle event = extras != null ? new Bundle(extras) : new Bundle();
        event.putString("type", type);
        runOnMain(() -> {
            if (!event.containsKey("mode") && currentMode != null) {
                event.putString("mode", currentMode);
            }
            if (sink != null) sink.onBrowserEvent(event);
        });
    }

    public void emit(@NonNull String type, @NonNull String mode, @Nullable String key, @Nullable String value) {
        Bundle extras = new Bundle();
        extras.putString("mode", mode);
        if (key != null && value != null) extras.putString(key, value);
        emit(type, extras);
    }
}

package com.rnappauth.utils;

import android.net.Uri;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import net.openid.appauth.connectivity.ConnectionBuilder;

import java.io.IOException;
import java.lang.ref.WeakReference;
import java.net.HttpURLConnection;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * {@link ConnectionBuilder} that adds custom headers + timeouts and remembers the last opened
 * connection so the HTTP status of a failed request can be reported back to JS.
 */
public final class CustomConnectionBuilder implements ConnectionBuilder {

    private Map<String, String> headers = null;
    private int connectionTimeoutMs = (int) TimeUnit.SECONDS.toMillis(15);
    private int readTimeoutMs = (int) TimeUnit.SECONDS.toMillis(10);
    private final ConnectionBuilder connectionBuilder;
    private volatile WeakReference<HttpURLConnection> lastConnection = new WeakReference<>(null);

    public CustomConnectionBuilder(ConnectionBuilder connectionBuilderToUse) {
        connectionBuilder = connectionBuilderToUse;
    }

    public void setHeaders(Map<String, String> headersToSet) {
        headers = headersToSet;
    }

    public void setConnectionTimeout(int timeout) {
        connectionTimeoutMs = timeout;
        readTimeoutMs = timeout;
    }

    @NonNull
    @Override
    public HttpURLConnection openConnection(@NonNull Uri uri) throws IOException {
        HttpURLConnection conn = connectionBuilder.openConnection(uri);

        if (headers != null) {
            for (Map.Entry<String, String> header : headers.entrySet()) {
                conn.setRequestProperty(header.getKey(), header.getValue());
            }
        }

        conn.setConnectTimeout(connectionTimeoutMs);
        conn.setReadTimeout(readTimeoutMs);
        lastConnection = new WeakReference<>(conn);
        return conn;
    }

    /** HTTP status of the most recent request, or null if unavailable. Never throws. */
    @Nullable
    public Integer getLastResponseCode() {
        HttpURLConnection conn = lastConnection.get();
        if (conn == null) return null;
        try {
            int code = conn.getResponseCode();
            return code > 0 ? code : null;
        } catch (Exception e) {
            return null;
        }
    }
}

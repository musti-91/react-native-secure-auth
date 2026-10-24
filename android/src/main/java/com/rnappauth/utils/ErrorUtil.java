package com.rnappauth.utils;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.WritableMap;

import net.openid.appauth.AuthorizationException;

/**
 * Maps AppAuth errors to promise rejections carrying a stable `reason` (see src/errors.js),
 * plus `httpStatus`, `errorDescription`, `errorUri` and `nativeError` when known.
 */
public final class ErrorUtil {

    public static final String USER_CANCELLED = "user_cancelled";
    public static final String PROGRAM_CANCELLED = "program_cancelled";
    public static final String NETWORK_ERROR = "network_error";
    public static final String SERVER_ERROR = "server_error";
    public static final String OAUTH_ERROR = "oauth_error";
    public static final String INVALID_RESPONSE = "invalid_response";
    public static final String ID_TOKEN_VALIDATION = "id_token_validation";
    public static final String BROWSER_NOT_FOUND = "browser_not_found";
    public static final String IN_PROGRESS = "in_progress";
    public static final String CONFIGURATION = "configuration";
    public static final String UNKNOWN = "unknown";

    private ErrorUtil() {}

    @NonNull
    public static String reasonFor(@Nullable AuthorizationException ex) {
        if (ex == null) return UNKNOWN;
        if (ex.type != AuthorizationException.TYPE_GENERAL_ERROR) return OAUTH_ERROR;
        switch (ex.code) {
            case 1: return USER_CANCELLED;      // USER_CANCELED_AUTH_FLOW
            case 2: return PROGRAM_CANCELLED;   // PROGRAM_CANCELED_AUTH_FLOW
            case 3: return NETWORK_ERROR;       // NETWORK_ERROR
            case 4: return SERVER_ERROR;        // SERVER_ERROR
            case 5:                             // JSON_DESERIALIZATION_ERROR
            case 6:                             // TOKEN_RESPONSE_CONSTRUCTION_ERROR
            case 7: return INVALID_RESPONSE;    // INVALID_REGISTRATION_RESPONSE
            case 8:                             // ID_TOKEN_PARSING_ERROR
            case 9: return ID_TOKEN_VALIDATION; // ID_TOKEN_VALIDATION_ERROR
            default: return UNKNOWN;
        }
    }

    public static void reject(@NonNull Promise promise, @NonNull String fallbackCode,
                              @Nullable AuthorizationException ex,
                              @Nullable CustomConnectionBuilder connection) {
        reject(promise, fallbackCode, ex, connection, null);
    }

    public static void reject(@NonNull Promise promise, @NonNull String fallbackCode,
                              @Nullable AuthorizationException ex,
                              @Nullable CustomConnectionBuilder connection,
                              @Nullable String reasonOverride) {
        if (ex == null) {
            reject(promise, fallbackCode, "Unknown error", UNKNOWN, null);
            return;
        }
        String code = ex.error != null ? ex.error : fallbackCode;
        String message = ex.getLocalizedMessage() != null
                ? ex.getLocalizedMessage()
                : (ex.error != null ? ex.error : fallbackCode);
        String reason = reasonOverride != null ? reasonOverride : reasonFor(ex);

        WritableMap userInfo = Arguments.createMap();
        userInfo.putString("reason", reason);
        if (ex.errorDescription != null) userInfo.putString("errorDescription", ex.errorDescription);
        if (ex.errorUri != null) userInfo.putString("errorUri", ex.errorUri.toString());
        Throwable cause = ex.getCause();
        if (cause != null && cause.getLocalizedMessage() != null) {
            userInfo.putString("nativeError", cause.getLocalizedMessage());
        }
        if (connection != null && !USER_CANCELLED.equals(reason) && !PROGRAM_CANCELLED.equals(reason)
                && !NETWORK_ERROR.equals(reason)) {
            Integer status = connection.getLastResponseCode();
            if (status != null) userInfo.putInt("httpStatus", status);
        }
        promise.reject(code, message, ex, userInfo);
    }

    public static void reject(@NonNull Promise promise, @NonNull String code, @Nullable String message,
                              @NonNull String reason, @Nullable Throwable throwable) {
        WritableMap userInfo = Arguments.createMap();
        userInfo.putString("reason", reason);
        if (throwable != null && throwable.getLocalizedMessage() != null) {
            userInfo.putString("nativeError", throwable.getLocalizedMessage());
        }
        String safeMessage = message != null ? message : code;
        if (throwable != null) {
            promise.reject(code, safeMessage, throwable, userInfo);
        } else {
            promise.reject(code, safeMessage, userInfo);
        }
    }
}

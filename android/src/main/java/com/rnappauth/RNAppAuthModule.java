package com.rnappauth;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.browser.customtabs.CustomTabsCallback;
import androidx.browser.customtabs.CustomTabsClient;
import androidx.browser.customtabs.CustomTabsIntent;
import androidx.browser.customtabs.CustomTabsServiceConnection;
import androidx.browser.customtabs.CustomTabsSession;

import com.facebook.react.bridge.ActivityEventListener;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.ReadableType;
import com.facebook.react.bridge.UiThreadUtil;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import com.rnappauth.browser.BrowserBridge;
import com.rnappauth.browser.BrowserOptions;
import com.rnappauth.browser.CustomTabsController;
import com.rnappauth.browser.RNAppAuthWebViewActivity;
import com.rnappauth.utils.CustomConnectionBuilder;
import com.rnappauth.utils.EndSessionResponseFactory;
import com.rnappauth.utils.ErrorUtil;
import com.rnappauth.utils.MapUtil;
import com.rnappauth.utils.MutableBrowserAllowList;
import com.rnappauth.utils.RegistrationResponseFactory;
import com.rnappauth.utils.TokenResponseFactory;
import com.rnappauth.utils.UnsafeConnectionBuilder;

import net.openid.appauth.AppAuthConfiguration;
import net.openid.appauth.AuthorizationException;
import net.openid.appauth.AuthorizationManagementActivity;
import net.openid.appauth.AuthorizationRequest;
import net.openid.appauth.AuthorizationResponse;
import net.openid.appauth.AuthorizationService;
import net.openid.appauth.AuthorizationServiceConfiguration;
import net.openid.appauth.AuthorizationServiceDiscovery;
import net.openid.appauth.ClientAuthentication;
import net.openid.appauth.ClientSecretBasic;
import net.openid.appauth.ClientSecretPost;
import net.openid.appauth.CodeVerifierUtil;
import net.openid.appauth.EndSessionRequest;
import net.openid.appauth.EndSessionResponse;
import net.openid.appauth.RegistrationRequest;
import net.openid.appauth.ResponseTypeValues;
import net.openid.appauth.TokenRequest;
import net.openid.appauth.browser.AnyBrowserMatcher;
import net.openid.appauth.browser.BrowserDescriptor;
import net.openid.appauth.browser.BrowserMatcher;
import net.openid.appauth.browser.BrowserSelector;
import net.openid.appauth.browser.VersionedBrowserMatcher;
import net.openid.appauth.connectivity.ConnectionBuilder;
import net.openid.appauth.connectivity.DefaultConnectionBuilder;

import org.json.JSONObject;

import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicReference;

public class RNAppAuthModule extends ReactContextBaseJavaModule
        implements ActivityEventListener, BrowserBridge.EventSink {

    public static final String NAME = "RNAppAuth";
    public static final String BROWSER_EVENT = "RNAppAuthBrowserEvent";
    public static final int AUTHORIZATION_REQUEST_CODE = 52;
    public static final int END_SESSION_REQUEST_CODE = 53;

    private static final String[] BROWSER_ONLY_PARAMETERS =
            {"display", "login_hint", "prompt", "state", "nonce", "ui_locales", "response_mode"};

    // ---- Recovery of results delivered to a re-created Activity (see resumePendingAuthorize) ----

    private static final AtomicReference<Intent> sStashedAuthorizationResult = new AtomicReference<>();
    private static final Object authorizationResultLock = new Object();
    // Remember only the last consumed delivery, without retaining its code or PKCE verifier.
    private static WeakReference<Intent> sConsumedAuthorizationResult = new WeakReference<>(null);

    /**
     * Call from your MainActivity's onActivityResult for request code 52 so a result delivered
     * after the React instance was re-created can be picked up by resumePendingAuthorize().
     */
    public static void stashAuthorizationResult(final Intent data) {
        synchronized (authorizationResultLock) {
            if (data == null) {
                sStashedAuthorizationResult.set(null);
                sConsumedAuthorizationResult.clear();
            } else if (data != sConsumedAuthorizationResult.get()) {
                sStashedAuthorizationResult.set(data);
            }
        }
    }

    /** Settings captured by authorize() that are needed for the code exchange after the redirect. */
    private static final class PendingExchange {
        boolean allowInsecure;
        Map<String, String> tokenHeaders;
        Double timeoutMs;
        boolean skipCodeExchange;
        String clientSecret;
        String clientAuthMethod;
        Map<String, String> additionalParameters;
    }

    private interface ConfigurationCallback {
        void onConfiguration(@NonNull AuthorizationServiceConfiguration configuration);

        void onError(@NonNull String code, @Nullable AuthorizationException ex, @Nullable Exception error);
    }

    private interface FlowIntentFactory {
        /** Builds the AppAuth management intent for the Custom Tabs / external browser path. */
        Intent create(@NonNull AuthorizationService service, @NonNull CustomTabsIntent customTabsIntent);
    }

    private final ReactApplicationContext reactContext;
    private final AtomicReference<Promise> pendingAuthorizePromise = new AtomicReference<>();
    private final AtomicReference<Promise> endSessionPromise = new AtomicReference<>();
    private PendingExchange pendingExchange = new PendingExchange();
    private final ConcurrentHashMap<String, AuthorizationServiceConfiguration> serviceConfigurations =
            new ConcurrentHashMap<>();

    // Main-thread state of the browser flow currently on screen.
    private int activeFlowRequestCode = 0;
    @Nullable private CustomTabsController activeController;
    private boolean dismissRequested;

    @Nullable private static CustomTabsServiceConnection sWarmupConnection;

    public RNAppAuthModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
        reactContext.addActivityEventListener(this);
        BrowserBridge.get().setEventSink(this);
    }

    @NonNull
    @Override
    public String getName() {
        return NAME;
    }

    @Override
    public void invalidate() {
        reactContext.removeActivityEventListener(this);
        super.invalidate();
    }

    // ---- Events ------------------------------------------------------------------------------------

    @Override
    public void onBrowserEvent(@NonNull Bundle event) {
        if (!reactContext.hasActiveReactInstance()) return;
        try {
            reactContext
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                    .emit(BROWSER_EVENT, Arguments.fromBundle(event));
        } catch (Exception ignored) {
            // React instance is being torn down.
        }
    }

    @ReactMethod
    public void addListener(String eventName) {
        // Required by NativeEventEmitter.
    }

    @ReactMethod
    public void removeListeners(double count) {
        // Required by NativeEventEmitter.
    }

    // ---- Public API --------------------------------------------------------------------------------

    @ReactMethod
    public void prefetchConfiguration(
            final Boolean warmAndPrefetchChrome,
            final String issuer,
            final String redirectUrl,
            final String clientId,
            final ReadableArray scopes,
            final ReadableMap serviceConfiguration,
            final boolean dangerouslyAllowInsecureHttpRequests,
            final ReadableMap customHeaders,
            final Double connectionTimeoutMillis,
            final Promise promise) {
        final CustomConnectionBuilder builder = createConnectionBuilder(dangerouslyAllowInsecureHttpRequests,
                headersFor(customHeaders, "authorize"), connectionTimeoutMillis);

        withConfiguration(issuer, serviceConfiguration, builder, new ConfigurationCallback() {
            @Override
            public void onConfiguration(@NonNull AuthorizationServiceConfiguration configuration) {
                if (Boolean.TRUE.equals(warmAndPrefetchChrome)) {
                    warmBrowser(configuration.authorizationEndpoint);
                }
                promise.resolve(true);
            }

            @Override
            public void onError(@NonNull String code, @Nullable AuthorizationException ex, @Nullable Exception error) {
                rejectConfigurationError(promise, code, ex, error, builder);
            }
        });
    }

    @ReactMethod
    public void register(
            final String issuer,
            final ReadableArray redirectUris,
            final ReadableArray responseTypes,
            final ReadableArray grantTypes,
            final String subjectType,
            final String tokenEndpointAuthMethod,
            final ReadableMap additionalParameters,
            final ReadableMap serviceConfiguration,
            final Double connectionTimeoutMillis,
            final boolean dangerouslyAllowInsecureHttpRequests,
            final ReadableMap customHeaders,
            final Promise promise) {
        final CustomConnectionBuilder builder = createConnectionBuilder(dangerouslyAllowInsecureHttpRequests,
                headersFor(customHeaders, "register"), connectionTimeoutMillis);
        final AppAuthConfiguration appAuthConfiguration =
                createAppAuthConfiguration(builder, dangerouslyAllowInsecureHttpRequests, null);
        final HashMap<String, String> additionalParametersMap = MapUtil.readableMapToHashMap(additionalParameters);

        withConfiguration(issuer, serviceConfiguration, builder, new ConfigurationCallback() {
            @Override
            public void onConfiguration(@NonNull AuthorizationServiceConfiguration configuration) {
                try {
                    registerWithConfiguration(configuration, appAuthConfiguration, builder, redirectUris,
                            responseTypes, grantTypes, subjectType, tokenEndpointAuthMethod,
                            additionalParametersMap, promise);
                } catch (Exception e) {
                    ErrorUtil.reject(promise, "registration_failed", e.getMessage(), ErrorUtil.CONFIGURATION, e);
                }
            }

            @Override
            public void onError(@NonNull String code, @Nullable AuthorizationException ex, @Nullable Exception error) {
                rejectConfigurationError(promise, code, ex, error, builder);
            }
        });
    }

    @ReactMethod
    public void authorize(
            final String issuer,
            final String redirectUrl,
            final String clientId,
            final String clientSecret,
            final ReadableArray scopes,
            final ReadableMap additionalParameters,
            final ReadableMap serviceConfiguration,
            final Boolean skipCodeExchange,
            final Double connectionTimeoutMillis,
            final Boolean useNonce,
            final Boolean usePKCE,
            final String clientAuthMethod,
            final boolean dangerouslyAllowInsecureHttpRequests,
            final ReadableMap customHeaders,
            final ReadableArray androidAllowCustomBrowsers,
            final boolean androidTrustedWebActivity,
            final boolean androidPrefersEphemeralSession,
            final ReadableMap browserOptions,
            final Promise promise) {
        synchronized (authorizationResultLock) {
            if (!pendingAuthorizePromise.compareAndSet(null, promise)) {
                ErrorUtil.reject(promise, "authentication_in_progress", "An authorization is already pending",
                        ErrorUtil.IN_PROGRESS, null);
                return;
            }
        }

        final CustomConnectionBuilder builder = createConnectionBuilder(dangerouslyAllowInsecureHttpRequests,
                headersFor(customHeaders, "authorize"), connectionTimeoutMillis);
        final AppAuthConfiguration appAuthConfiguration = createAppAuthConfiguration(builder,
                dangerouslyAllowInsecureHttpRequests, androidAllowCustomBrowsers);
        final HashMap<String, String> additionalParametersMap = MapUtil.readableMapToHashMap(additionalParameters);
        final BrowserOptions options = parseBrowserOptions(browserOptions);

        // Captured for the code exchange in onActivityResult.
        PendingExchange exchange = new PendingExchange();
        exchange.allowInsecure = dangerouslyAllowInsecureHttpRequests;
        exchange.tokenHeaders = headersFor(customHeaders, "token");
        exchange.timeoutMs = connectionTimeoutMillis;
        exchange.skipCodeExchange = Boolean.TRUE.equals(skipCodeExchange);
        exchange.clientSecret = clientSecret;
        exchange.clientAuthMethod = clientAuthMethod;
        exchange.additionalParameters = new HashMap<>(additionalParametersMap);
        synchronized (authorizationResultLock) {
            pendingExchange = exchange;
        }

        withConfiguration(issuer, serviceConfiguration, builder, new ConfigurationCallback() {
            @Override
            public void onConfiguration(@NonNull AuthorizationServiceConfiguration configuration) {
                try {
                    AuthorizationRequest request = buildAuthorizationRequest(configuration, clientId, scopes,
                            redirectUrl, !Boolean.FALSE.equals(useNonce), !Boolean.FALSE.equals(usePKCE),
                            additionalParametersMap);
                    launchFlow(request, Uri.parse(redirectUrl), AUTHORIZATION_REQUEST_CODE, appAuthConfiguration,
                            options, androidPrefersEphemeralSession, androidTrustedWebActivity, promise,
                            pendingAuthorizePromise, "authentication_failed",
                            (service, customTabsIntent) -> service.getAuthorizationRequestIntent(request, customTabsIntent));
                } catch (Exception e) {
                    pendingAuthorizePromise.compareAndSet(promise, null);
                    ErrorUtil.reject(promise, "authentication_failed", e.getMessage(), ErrorUtil.CONFIGURATION, e);
                }
            }

            @Override
            public void onError(@NonNull String code, @Nullable AuthorizationException ex, @Nullable Exception error) {
                pendingAuthorizePromise.compareAndSet(promise, null);
                rejectConfigurationError(promise, code, ex, error, builder);
            }
        });
    }

    @ReactMethod
    public void resumePendingAuthorize(
            final ReadableMap additionalParameters,
            final Double connectionTimeoutMillis,
            final ReadableMap customHeaders,
            final boolean dangerouslyAllowInsecureHttpRequests,
            final String clientSecret,
            final String clientAuthMethod,
            final boolean skipCodeExchange,
            final Promise promise) {
        final Intent data;
        synchronized (authorizationResultLock) {
            // Check ownership and claim the stash together across the UI and native-module queues.
            if (pendingAuthorizePromise.get() != null) {
                promise.resolve(null);
                return;
            }
            data = sStashedAuthorizationResult.getAndSet(null);
            if (data != null) {
                sConsumedAuthorizationResult = new WeakReference<>(data);
            }
        }
        if (data == null) {
            promise.resolve(null);
            return;
        }

        PendingExchange exchange = new PendingExchange();
        exchange.allowInsecure = dangerouslyAllowInsecureHttpRequests;
        exchange.tokenHeaders = headersFor(customHeaders, "token");
        exchange.timeoutMs = connectionTimeoutMillis;
        exchange.skipCodeExchange = skipCodeExchange;
        exchange.clientSecret = clientSecret;
        exchange.clientAuthMethod = clientAuthMethod;
        exchange.additionalParameters = MapUtil.readableMapToHashMap(additionalParameters);
        completeAuthorization(data, exchange, false, promise);
    }

    @ReactMethod
    public void refresh(
            final String issuer,
            final String redirectUrl,
            final String clientId,
            final String clientSecret,
            final String refreshToken,
            final ReadableArray scopes,
            final ReadableMap additionalParameters,
            final ReadableMap serviceConfiguration,
            final Double connectionTimeoutMillis,
            final String clientAuthMethod,
            final boolean dangerouslyAllowInsecureHttpRequests,
            final ReadableMap customHeaders,
            final ReadableArray androidAllowCustomBrowsers,
            final Promise promise) {
        final CustomConnectionBuilder builder = createConnectionBuilder(dangerouslyAllowInsecureHttpRequests,
                headersFor(customHeaders, "token"), connectionTimeoutMillis);
        final AppAuthConfiguration appAuthConfiguration = createAppAuthConfiguration(builder,
                dangerouslyAllowInsecureHttpRequests, androidAllowCustomBrowsers);
        final HashMap<String, String> additionalParametersMap = MapUtil.readableMapToHashMap(additionalParameters);

        withConfiguration(issuer, serviceConfiguration, builder, new ConfigurationCallback() {
            @Override
            public void onConfiguration(@NonNull AuthorizationServiceConfiguration configuration) {
                try {
                    refreshWithConfiguration(configuration, appAuthConfiguration, builder, refreshToken, clientId,
                            scopes, redirectUrl, additionalParametersMap, clientAuthMethod, clientSecret, promise);
                } catch (Exception e) {
                    ErrorUtil.reject(promise, "token_refresh_failed", e.getMessage(), ErrorUtil.CONFIGURATION, e);
                }
            }

            @Override
            public void onError(@NonNull String code, @Nullable AuthorizationException ex, @Nullable Exception error) {
                rejectConfigurationError(promise, code, ex, error, builder);
            }
        });
    }

    @ReactMethod
    public void logout(
            final String issuer,
            final String idTokenHint,
            final String postLogoutRedirectUri,
            final ReadableMap serviceConfiguration,
            final ReadableMap additionalParameters,
            final boolean dangerouslyAllowInsecureHttpRequests,
            final ReadableArray androidAllowCustomBrowsers,
            final boolean androidPrefersEphemeralSession,
            final ReadableMap browserOptions,
            final Promise promise) {
        final CustomConnectionBuilder builder =
                createConnectionBuilder(dangerouslyAllowInsecureHttpRequests, null, null);
        final AppAuthConfiguration appAuthConfiguration = createAppAuthConfiguration(builder,
                dangerouslyAllowInsecureHttpRequests, androidAllowCustomBrowsers);
        final HashMap<String, String> additionalParametersMap = MapUtil.readableMapToHashMap(additionalParameters);
        final BrowserOptions options = parseBrowserOptions(browserOptions);

        Promise previous = endSessionPromise.getAndSet(promise);
        if (previous != null) {
            ErrorUtil.reject(previous, "end_session_failed", "Superseded by a newer logout() call",
                    ErrorUtil.PROGRAM_CANCELLED, null);
        }

        withConfiguration(issuer, serviceConfiguration, builder, new ConfigurationCallback() {
            @Override
            public void onConfiguration(@NonNull AuthorizationServiceConfiguration configuration) {
                try {
                    EndSessionRequest.Builder requestBuilder = new EndSessionRequest.Builder(configuration)
                            .setIdTokenHint(idTokenHint)
                            .setPostLogoutRedirectUri(Uri.parse(postLogoutRedirectUri));
                    if (additionalParametersMap.containsKey("state")) {
                        requestBuilder.setState(additionalParametersMap.remove("state"));
                    }
                    requestBuilder.setAdditionalParameters(additionalParametersMap);
                    final EndSessionRequest request = requestBuilder.build();
                    launchFlow(request, Uri.parse(postLogoutRedirectUri), END_SESSION_REQUEST_CODE,
                            appAuthConfiguration, options, androidPrefersEphemeralSession, false, promise,
                            endSessionPromise, "end_session_failed",
                            (service, customTabsIntent) -> service.getEndSessionRequestIntent(request, customTabsIntent));
                } catch (Exception e) {
                    endSessionPromise.compareAndSet(promise, null);
                    ErrorUtil.reject(promise, "end_session_failed", e.getMessage(), ErrorUtil.CONFIGURATION, e);
                }
            }

            @Override
            public void onError(@NonNull String code, @Nullable AuthorizationException ex, @Nullable Exception error) {
                endSessionPromise.compareAndSet(promise, null);
                rejectConfigurationError(promise, code, ex, error, builder);
            }
        });
    }

    // ---- Browser control & messaging ---------------------------------------------------------------

    @ReactMethod
    public void postBrowserMessage(final String message, final Promise promise) {
        if (message == null) {
            promise.reject("invalid_message", "message must be a string");
            return;
        }
        BrowserBridge.get().runOnMain(() -> promise.resolve(BrowserBridge.get().postMessage(message)));
    }

    @ReactMethod
    public void postBrowserMessageNow(final String message, final Promise promise) {
        if (message == null) {
            promise.reject("invalid_message", "message must be a string");
            return;
        }
        BrowserBridge.get().runOnMain(() -> promise.resolve(BrowserBridge.get().postMessageNow(message)));
    }

    @ReactMethod
    public void clearPendingBrowserMessages(final Promise promise) {
        BrowserBridge.get().runOnMain(() -> {
            BrowserBridge.get().clearPendingMessages();
            promise.resolve(null);
        });
    }

    /**
     * Closes the Custom Tab / web view of the running authorize() or logout() call by bringing
     * AppAuth's management activity back to the top without a response (it then cancels and
     * finishes). The pending promise rejects with reason `program_cancelled`.
     */
    @ReactMethod
    public void dismissBrowser(final Promise promise) {
        UiThreadUtil.runOnUiThread(() -> {
            if (activeFlowRequestCode == 0) {
                promise.resolve(false);
                return;
            }
            dismissRequested = true;
            Activity activity = getCurrentActivity();
            Context context = activity != null ? activity : reactContext;
            Intent intent = AuthorizationManagementActivity.createResponseHandlingIntent(context, null);
            if (activity == null) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                context.startActivity(intent);
                promise.resolve(true);
            } catch (Exception e) {
                dismissRequested = false;
                ErrorUtil.reject(promise, "dismiss_failed", e.getMessage(), ErrorUtil.UNKNOWN, e);
            }
        });
    }

    @ReactMethod
    public void clearWebViewData(final Promise promise) {
        UiThreadUtil.runOnUiThread(() -> {
            try {
                RNAppAuthWebViewActivity.clearWebViewData(reactContext, () -> promise.resolve(true));
            } catch (Exception e) {
                ErrorUtil.reject(promise, "clear_web_view_data_failed", e.getMessage(), ErrorUtil.UNKNOWN, e);
            }
        });
    }

    // ---- Activity results --------------------------------------------------------------------------

    @Override
    public void onActivityResult(Activity activity, int requestCode, int resultCode, Intent data) {
        if (requestCode != AUTHORIZATION_REQUEST_CODE && requestCode != END_SESSION_REQUEST_CODE) {
            return;
        }
        final boolean dismissed = finishActiveFlow(requestCode);

        if (requestCode == AUTHORIZATION_REQUEST_CODE) {
            final Promise authorizePromise;
            final PendingExchange exchange;
            synchronized (authorizationResultLock) {
                if (data != null && data == sConsumedAuthorizationResult.get()) {
                    return;
                }
                authorizePromise = pendingAuthorizePromise.getAndSet(null);
                if (authorizePromise == null) {
                    stashAuthorizationResult(data);
                    return;
                }
                // Recovery must not observe released ownership with the same result still stashed.
                sStashedAuthorizationResult.compareAndSet(data, null);
                if (data != null) {
                    sConsumedAuthorizationResult = new WeakReference<>(data);
                }
                exchange = pendingExchange;
            }
            completeAuthorization(data, exchange, dismissed, authorizePromise);
            return;
        }

        final Promise promise = endSessionPromise.getAndSet(null);
        if (promise == null) return;
        try {
            if (data == null) {
                ErrorUtil.reject(promise, "end_session_failed", "Data intent is null", ErrorUtil.UNKNOWN, null);
                return;
            }
            final AuthorizationException exception = AuthorizationException.fromIntent(data);
            if (exception != null) {
                ErrorUtil.reject(promise, "end_session_failed", exception, null,
                        dismissed && isUserCancel(exception) ? ErrorUtil.PROGRAM_CANCELLED : null);
                return;
            }
            promise.resolve(EndSessionResponseFactory.endSessionResponseToMap(EndSessionResponse.fromIntent(data)));
        } catch (Exception error) {
            ErrorUtil.reject(promise, "run_time_exception", error.getMessage(), ErrorUtil.UNKNOWN, error);
        }
    }

    @Override
    public void onNewIntent(Intent intent) {
        // Redirects are delivered to AppAuth's RedirectUriReceiverActivity.
    }

    /** Cleans up the browser of the finished flow. Returns true if it was closed via dismissBrowser(). */
    private boolean finishActiveFlow(int requestCode) {
        boolean dismissed = false;
        if (activeFlowRequestCode == requestCode) {
            dismissed = dismissRequested;
            if (activeController != null) {
                activeController.dispose();
                activeController = null;
            }
            activeFlowRequestCode = 0;
            dismissRequested = false;
            BrowserBridge.get().emit("closed", null);
        }
        return dismissed;
    }

    private static boolean isUserCancel(AuthorizationException ex) {
        return ex.type == AuthorizationException.TYPE_GENERAL_ERROR
                && ex.code == AuthorizationException.GeneralErrors.USER_CANCELED_AUTH_FLOW.code;
    }

    private void completeAuthorization(
            final Intent data,
            final PendingExchange exchange,
            final boolean dismissed,
            final Promise resultPromise) {
        try {
            if (data == null) {
                ErrorUtil.reject(resultPromise, "authentication_error", "Data intent is null", ErrorUtil.UNKNOWN, null);
                return;
            }
            final AuthorizationException exception = AuthorizationException.fromIntent(data);
            if (exception != null) {
                ErrorUtil.reject(resultPromise, "authentication_error", exception, null,
                        dismissed && isUserCancel(exception) ? ErrorUtil.PROGRAM_CANCELLED : null);
                return;
            }
            final AuthorizationResponse response = AuthorizationResponse.fromIntent(data);
            if (response == null) {
                ErrorUtil.reject(resultPromise, "authentication_error", "No authorization response in activity result",
                        ErrorUtil.INVALID_RESPONSE, null);
                return;
            }
            if (exchange.skipCodeExchange) {
                final String verifier = response.request.codeVerifier;
                resultPromise.resolve(verifier != null
                        ? TokenResponseFactory.authorizationCodeResponseToMap(response, verifier)
                        : TokenResponseFactory.authorizationResponseToMap(response));
                return;
            }

            final Map<String, String> exchangeParameters = new HashMap<>();
            if (exchange.additionalParameters != null) {
                exchangeParameters.putAll(exchange.additionalParameters);
            }
            for (String parameter : BROWSER_ONLY_PARAMETERS) {
                exchangeParameters.remove(parameter);
            }
            final TokenRequest tokenRequest = response.createTokenExchangeRequest(exchangeParameters);
            final CustomConnectionBuilder builder = createConnectionBuilder(exchange.allowInsecure,
                    exchange.tokenHeaders, exchange.timeoutMs);
            final AuthorizationService authService = new AuthorizationService(reactContext,
                    createAppAuthConfiguration(builder, exchange.allowInsecure, null));
            final AuthorizationService.TokenResponseCallback callback = (responseToken, error) -> {
                authService.dispose();
                if (responseToken != null) {
                    resultPromise.resolve(TokenResponseFactory.tokenResponseToMap(responseToken, response));
                } else {
                    ErrorUtil.reject(resultPromise, "token_exchange_failed", error, builder);
                }
            };
            try {
                if (exchange.clientSecret != null) {
                    authService.performTokenRequest(tokenRequest,
                            getClientAuthentication(exchange.clientSecret, exchange.clientAuthMethod), callback);
                } else {
                    authService.performTokenRequest(tokenRequest, callback);
                }
            } catch (Exception error) {
                authService.dispose();
                throw error;
            }
        } catch (Exception error) {
            ErrorUtil.reject(resultPromise, "run_time_exception", error.getMessage(), ErrorUtil.UNKNOWN, error);
        }
    }

    // ---- Flows -------------------------------------------------------------------------------------

    private AuthorizationRequest buildAuthorizationRequest(
            final AuthorizationServiceConfiguration serviceConfiguration,
            final String clientId,
            final ReadableArray scopes,
            final String redirectUrl,
            final boolean useNonce,
            final boolean usePKCE,
            final Map<String, String> parameters) {
        AuthorizationRequest.Builder builder = new AuthorizationRequest.Builder(
                serviceConfiguration, clientId, ResponseTypeValues.CODE, Uri.parse(redirectUrl));

        if (scopes != null) {
            builder.setScope(arrayToString(scopes));
        }

        // Parameters with dedicated builder methods would throw if passed as additional parameters.
        Map<String, String> additional = new HashMap<>(parameters);
        if (additional.containsKey("display")) builder.setDisplay(additional.remove("display"));
        if (additional.containsKey("login_hint")) builder.setLoginHint(additional.remove("login_hint"));
        if (additional.containsKey("prompt")) builder.setPrompt(additional.remove("prompt"));
        if (additional.containsKey("state")) builder.setState(additional.remove("state"));
        if (additional.containsKey("nonce")) builder.setNonce(additional.remove("nonce"));
        if (additional.containsKey("ui_locales")) builder.setUiLocales(additional.remove("ui_locales"));
        if (additional.containsKey("response_mode")) builder.setResponseMode(additional.remove("response_mode"));
        builder.setAdditionalParameters(additional);

        if (usePKCE) {
            builder.setCodeVerifier(CodeVerifierUtil.generateRandomCodeVerifier());
        } else {
            builder.setCodeVerifier(null);
        }
        if (!useNonce) {
            builder.setNonce(null);
        }
        return builder.build();
    }

    /**
     * Opens the authorization / end-session UI. Work that may block (AuthorizationService creation,
     * Custom Tabs binding) runs on a worker thread; the activity is started on the UI thread.
     */
    private void launchFlow(
            final net.openid.appauth.AuthorizationManagementRequest request,
            final Uri redirectUri,
            final int requestCode,
            final AppAuthConfiguration appAuthConfiguration,
            final BrowserOptions options,
            final boolean ephemeral,
            final boolean trustedWebActivity,
            final Promise promise,
            final AtomicReference<Promise> owner,
            final String failureCode,
            final FlowIntentFactory factory) {
        final Context context = reactContext.getApplicationContext();
        new Thread(() -> {
            AuthorizationService authService = null;
            CustomTabsController controller = null;
            try {
                final Intent intent;
                if (options.isWebView()) {
                    Intent webIntent = RNAppAuthWebViewActivity.createIntent(context, request.toUri(), redirectUri, options);
                    intent = AuthorizationManagementActivity.createStartForResultIntent(context, request, webIntent);
                } else {
                    authService = new AuthorizationService(context, appAuthConfiguration);
                    BrowserDescriptor browser = BrowserSelector.select(context, appAuthConfiguration.getBrowserMatcher());
                    controller = new CustomTabsController(context, options);
                    controller.connect(browser != null && browser.useCustomTab ? browser.packageName : null);
                    intent = factory.create(authService, controller.buildIntent(ephemeral, trustedWebActivity));
                }
                final AuthorizationService serviceToDispose = authService;
                final CustomTabsController launchedController = controller;
                UiThreadUtil.runOnUiThread(() -> {
                    try {
                        final Activity activity = getCurrentActivity();
                        if (activity == null || activity.isFinishing() || activity.isDestroyed()) {
                            throw new IllegalStateException("No foreground activity available for authorization");
                        }
                        if (activeController != null) activeController.dispose();
                        activeController = launchedController;
                        activeFlowRequestCode = requestCode;
                        dismissRequested = false;
                        if (launchedController != null) launchedController.onLaunched();
                        activity.startActivityForResult(intent, requestCode);
                    } catch (ActivityNotFoundException e) {
                        abortLaunch(launchedController, requestCode);
                        owner.compareAndSet(promise, null);
                        ErrorUtil.reject(promise, "browser_not_found", e.getMessage(), ErrorUtil.BROWSER_NOT_FOUND, e);
                    } catch (Exception e) {
                        abortLaunch(launchedController, requestCode);
                        owner.compareAndSet(promise, null);
                        ErrorUtil.reject(promise, failureCode, e.getMessage(), ErrorUtil.UNKNOWN, e);
                    } finally {
                        if (serviceToDispose != null) serviceToDispose.dispose();
                    }
                });
            } catch (ActivityNotFoundException e) {
                if (authService != null) authService.dispose();
                if (controller != null) controller.dispose();
                owner.compareAndSet(promise, null);
                ErrorUtil.reject(promise, "browser_not_found", e.getMessage(), ErrorUtil.BROWSER_NOT_FOUND, e);
            } catch (Exception e) {
                if (authService != null) authService.dispose();
                if (controller != null) controller.dispose();
                owner.compareAndSet(promise, null);
                ErrorUtil.reject(promise, failureCode, e.getMessage(), ErrorUtil.UNKNOWN, e);
            }
        }, "RNAppAuth-launch").start();
    }

    private void abortLaunch(@Nullable CustomTabsController controller, int requestCode) {
        if (controller != null) controller.dispose();
        if (activeFlowRequestCode == requestCode) {
            activeFlowRequestCode = 0;
            activeController = null;
        }
    }

    private void registerWithConfiguration(
            final AuthorizationServiceConfiguration serviceConfiguration,
            final AppAuthConfiguration appAuthConfiguration,
            final CustomConnectionBuilder connection,
            final ReadableArray redirectUris,
            final ReadableArray responseTypes,
            final ReadableArray grantTypes,
            final String subjectType,
            final String tokenEndpointAuthMethod,
            final Map<String, String> additionalParametersMap,
            final Promise promise) {
        final AuthorizationService authService = new AuthorizationService(reactContext, appAuthConfiguration);

        RegistrationRequest.Builder builder = new RegistrationRequest.Builder(
                serviceConfiguration, arrayToUriList(redirectUris))
                .setAdditionalParameters(additionalParametersMap);
        if (responseTypes != null) builder.setResponseTypeValues(arrayToList(responseTypes));
        if (grantTypes != null) builder.setGrantTypeValues(arrayToList(grantTypes));
        if (subjectType != null) builder.setSubjectType(subjectType);
        if (tokenEndpointAuthMethod != null) builder.setTokenEndpointAuthenticationMethod(tokenEndpointAuthMethod);

        authService.performRegistrationRequest(builder.build(), (response, ex) -> {
            authService.dispose();
            if (response != null) {
                promise.resolve(RegistrationResponseFactory.registrationResponseToMap(response));
            } else {
                ErrorUtil.reject(promise, "registration_failed", ex, connection);
            }
        });
    }

    private void refreshWithConfiguration(
            final AuthorizationServiceConfiguration serviceConfiguration,
            final AppAuthConfiguration appAuthConfiguration,
            final CustomConnectionBuilder connection,
            final String refreshToken,
            final String clientId,
            final ReadableArray scopes,
            final String redirectUrl,
            final Map<String, String> additionalParametersMap,
            final String clientAuthMethod,
            final String clientSecret,
            final Promise promise) {
        TokenRequest.Builder builder = new TokenRequest.Builder(serviceConfiguration, clientId)
                .setRefreshToken(refreshToken)
                .setRedirectUri(Uri.parse(redirectUrl));
        if (scopes != null) builder.setScope(arrayToString(scopes));
        if (!additionalParametersMap.isEmpty()) builder.setAdditionalParameters(additionalParametersMap);

        final AuthorizationService authService = new AuthorizationService(reactContext, appAuthConfiguration);
        final AuthorizationService.TokenResponseCallback callback = (response, ex) -> {
            authService.dispose();
            if (response != null) {
                promise.resolve(TokenResponseFactory.tokenResponseToMap(response));
            } else {
                ErrorUtil.reject(promise, "token_refresh_failed", ex, connection);
            }
        };
        try {
            if (clientSecret != null) {
                authService.performTokenRequest(builder.build(),
                        getClientAuthentication(clientSecret, clientAuthMethod), callback);
            } else {
                authService.performTokenRequest(builder.build(), callback);
            }
        } catch (Exception e) {
            authService.dispose();
            throw e;
        }
    }

    // ---- Configuration -----------------------------------------------------------------------------

    private void withConfiguration(
            @Nullable final String issuer,
            @Nullable final ReadableMap serviceConfiguration,
            final ConnectionBuilder connectionBuilder,
            final ConfigurationCallback callback) {
        if (serviceConfiguration != null) {
            AuthorizationServiceConfiguration configuration;
            try {
                configuration = createAuthorizationServiceConfiguration(serviceConfiguration);
            } catch (Exception e) {
                callback.onError("configuration_error", null, e);
                return;
            }
            callback.onConfiguration(configuration);
            return;
        }
        if (issuer != null && serviceConfigurations.containsKey(issuer)) {
            callback.onConfiguration(serviceConfigurations.get(issuer));
            return;
        }
        if (issuer == null) {
            callback.onError("configuration_error", null,
                    new IllegalArgumentException("Either issuer or serviceConfiguration must be provided"));
            return;
        }
        final Uri discoveryUri = Uri.parse(issuer).buildUpon()
                .appendPath(AuthorizationServiceConfiguration.WELL_KNOWN_PATH)
                .appendPath(AuthorizationServiceConfiguration.OPENID_CONFIGURATION_RESOURCE)
                .build();
        AuthorizationServiceConfiguration.fetchFromUrl(discoveryUri, (fetched, ex) -> {
            if (fetched == null) {
                callback.onError("service_configuration_fetch_error", ex, null);
                return;
            }
            serviceConfigurations.put(issuer, fetched);
            callback.onConfiguration(fetched);
        }, connectionBuilder);
    }

    private void rejectConfigurationError(Promise promise, String code, @Nullable AuthorizationException ex,
                                          @Nullable Exception error, @Nullable CustomConnectionBuilder builder) {
        if (ex != null) {
            ErrorUtil.reject(promise, code, ex, builder);
        } else {
            ErrorUtil.reject(promise, code, error != null ? error.getMessage() : "Configuration error",
                    ErrorUtil.CONFIGURATION, error);
        }
    }

    private AuthorizationServiceConfiguration createAuthorizationServiceConfiguration(ReadableMap serviceConfiguration)
            throws Exception {
        // Prefer the full discovery document (keeps ID token issuer validation) when JS has one.
        if (serviceConfiguration.hasKey("discoveryDocument")
                && serviceConfiguration.getType("discoveryDocument") == ReadableType.Map) {
            try {
                ReadableMap document = serviceConfiguration.getMap("discoveryDocument");
                if (document != null) {
                    return new AuthorizationServiceConfiguration(
                            new AuthorizationServiceDiscovery(new JSONObject(document.toHashMap())));
                }
            } catch (Exception ignored) {
                // Incomplete document: fall back to the explicit endpoints below.
            }
        }

        if (!serviceConfiguration.hasKey("authorizationEndpoint")) {
            throw new Exception("serviceConfiguration passed without an authorizationEndpoint");
        }
        if (!serviceConfiguration.hasKey("tokenEndpoint")) {
            throw new Exception("serviceConfiguration passed without a tokenEndpoint");
        }

        Uri authorizationEndpoint = Uri.parse(serviceConfiguration.getString("authorizationEndpoint"));
        Uri tokenEndpoint = Uri.parse(serviceConfiguration.getString("tokenEndpoint"));
        Uri registrationEndpoint = optionalUri(serviceConfiguration, "registrationEndpoint");
        Uri endSessionEndpoint = optionalUri(serviceConfiguration, "endSessionEndpoint");
        return new AuthorizationServiceConfiguration(
                authorizationEndpoint, tokenEndpoint, registrationEndpoint, endSessionEndpoint);
    }

    @Nullable
    private static Uri optionalUri(ReadableMap map, String key) {
        if (!map.hasKey(key) || map.getType(key) != ReadableType.String) return null;
        String value = map.getString(key);
        return value != null ? Uri.parse(value) : null;
    }

    // ---- Helpers -----------------------------------------------------------------------------------

    private BrowserOptions parseBrowserOptions(@Nullable ReadableMap browserOptions) {
        if (browserOptions == null) return BrowserOptions.defaults();
        return BrowserOptions.fromMap(browserOptions.toHashMap());
    }

    @Nullable
    private static Map<String, String> headersFor(@Nullable ReadableMap headerMap, String key) {
        if (headerMap == null || !headerMap.hasKey(key) || headerMap.getType(key) != ReadableType.Map) {
            return null;
        }
        return MapUtil.readableMapToHashMap(headerMap.getMap(key));
    }

    private ClientAuthentication getClientAuthentication(String clientSecret, @Nullable String clientAuthMethod) {
        if ("post".equals(clientAuthMethod)) {
            return new ClientSecretPost(clientSecret);
        }
        return new ClientSecretBasic(clientSecret);
    }

    private static String arrayToString(ReadableArray array) {
        StringBuilder builder = new StringBuilder();
        for (int i = 0; i < array.size(); i++) {
            if (i != 0) builder.append(' ');
            builder.append(array.getString(i));
        }
        return builder.toString();
    }

    private static List<String> arrayToList(ReadableArray array) {
        ArrayList<String> list = new ArrayList<>();
        for (int i = 0; i < array.size(); i++) list.add(array.getString(i));
        return list;
    }

    private static List<Uri> arrayToUriList(ReadableArray array) {
        ArrayList<Uri> list = new ArrayList<>();
        for (int i = 0; i < array.size(); i++) list.add(Uri.parse(array.getString(i)));
        return list;
    }

    private AppAuthConfiguration createAppAuthConfiguration(
            ConnectionBuilder connectionBuilder,
            boolean skipIssuerHttpsCheck,
            @Nullable ReadableArray androidAllowCustomBrowsers) {
        return new AppAuthConfiguration.Builder()
                .setBrowserMatcher(getBrowserAllowList(androidAllowCustomBrowsers))
                .setConnectionBuilder(connectionBuilder)
                .setSkipIssuerHttpsCheck(skipIssuerHttpsCheck)
                .build();
    }

    private CustomConnectionBuilder createConnectionBuilder(boolean allowInsecureConnections,
                                                            @Nullable Map<String, String> headers,
                                                            @Nullable Double connectionTimeoutMillis) {
        ConnectionBuilder proxied = allowInsecureConnections
                ? UnsafeConnectionBuilder.INSTANCE
                : DefaultConnectionBuilder.INSTANCE;
        CustomConnectionBuilder connection = new CustomConnectionBuilder(proxied);
        if (headers != null) connection.setHeaders(headers);
        if (connectionTimeoutMillis != null) connection.setConnectionTimeout(connectionTimeoutMillis.intValue());
        return connection;
    }

    private void warmBrowser(final Uri url) {
        final Context context = reactContext.getApplicationContext();
        new Thread(() -> {
            BrowserDescriptor browser = BrowserSelector.select(context, AnyBrowserMatcher.INSTANCE);
            if (browser == null || !browser.useCustomTab) return;
            CustomTabsServiceConnection connection = new CustomTabsServiceConnection() {
                @Override
                public void onCustomTabsServiceConnected(@NonNull ComponentName name, @NonNull CustomTabsClient client) {
                    client.warmup(0L);
                    CustomTabsSession session = client.newSession(new CustomTabsCallback());
                    if (session != null) {
                        session.mayLaunchUrl(url, null, Collections.<Bundle>emptyList());
                    }
                }

                @Override
                public void onServiceDisconnected(ComponentName name) {
                }
            };
            UiThreadUtil.runOnUiThread(() -> {
                if (sWarmupConnection != null) {
                    try {
                        context.unbindService(sWarmupConnection);
                    } catch (Exception ignored) {
                        // Already unbound.
                    }
                }
                sWarmupConnection = CustomTabsClient.bindCustomTabsService(context, browser.packageName, connection)
                        ? connection : null;
            });
        }, "RNAppAuth-warmup").start();
    }

    private BrowserMatcher getBrowserAllowList(@Nullable ReadableArray androidAllowCustomBrowsers) {
        if (androidAllowCustomBrowsers == null || androidAllowCustomBrowsers.size() == 0) {
            return AnyBrowserMatcher.INSTANCE;
        }
        MutableBrowserAllowList matchers = new MutableBrowserAllowList();
        for (int i = 0; i < androidAllowCustomBrowsers.size(); i++) {
            String browser = androidAllowCustomBrowsers.getString(i);
            if (browser == null) continue;
            switch (browser) {
                case "chrome": matchers.add(VersionedBrowserMatcher.CHROME_BROWSER); break;
                case "chromeCustomTab": matchers.add(VersionedBrowserMatcher.CHROME_CUSTOM_TAB); break;
                case "firefox": matchers.add(VersionedBrowserMatcher.FIREFOX_BROWSER); break;
                case "firefoxCustomTab": matchers.add(VersionedBrowserMatcher.FIREFOX_CUSTOM_TAB); break;
                case "samsung": matchers.add(VersionedBrowserMatcher.SAMSUNG_BROWSER); break;
                case "samsungCustomTab": matchers.add(VersionedBrowserMatcher.SAMSUNG_CUSTOM_TAB); break;
                default: break;
            }
        }
        return matchers;
    }
}

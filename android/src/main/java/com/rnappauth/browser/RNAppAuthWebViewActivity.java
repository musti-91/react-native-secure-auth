package com.rnappauth.browser;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.ColorUtils;
import androidx.core.graphics.Insets;
import androidx.core.graphics.drawable.DrawableCompat;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import com.facebook.react.ReactApplication;
import com.facebook.react.ReactHost;
import com.facebook.react.interfaces.fabric.ReactSurface;
import com.rnappauth.R;

import net.openid.appauth.AuthorizationManagementActivity;

import org.json.JSONObject;

import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Embedded authorization browser (opt-in via `browser.androidMode: 'webView'`).
 *
 * It is started by AppAuth's {@link AuthorizationManagementActivity}, so state validation, the
 * activity result contract and cancellation work exactly like with Custom Tabs: when the redirect
 * URI is reached it is handed back through
 * {@link AuthorizationManagementActivity#createResponseHandlingIntent(Context, Uri)}, and closing
 * this activity is reported as a user cancellation.
 */
public final class RNAppAuthWebViewActivity extends Activity implements BrowserBridge.MessageTarget {

    private static final String EXTRA_URL = "com.rnappauth.webview.URL";
    private static final String EXTRA_REDIRECT_URI = "com.rnappauth.webview.REDIRECT_URI";
    private static final String EXTRA_OPTIONS = "com.rnappauth.webview.OPTIONS";
    private static final String MODE = BrowserOptions.MODE_WEB_VIEW;
    private static final String NATIVE_OBJECT = "RNAppAuthNative";

    /** Exposes `window.<bridgeName>.postMessage()` (default `RNAppAuth`) and a `window.ReactNativeWebView` shim. */
    private static String bridgeScript(String name) {
        return "(function(){"
                + "if(window." + name + "&&window." + name + ".__installed){return;}"
                + "var n=window." + NATIVE_OBJECT + ";if(!n){return;}"
                + "function send(m){n.postMessage(typeof m==='string'?m:JSON.stringify(m));}"
                + "window." + name + "={__installed:true,isEmbedded:true,platform:'android',postMessage:send,onmessage:null};"
                + "if(!window.ReactNativeWebView){window.ReactNativeWebView={postMessage:send};}"
                + "try{window.dispatchEvent(new Event('" + name.toLowerCase(java.util.Locale.US) + "ready'));}catch(e){}"
                + "})();";
    }

    public static Intent createIntent(@NonNull Context context, @NonNull Uri url, @NonNull Uri redirectUri,
                                      @NonNull BrowserOptions options) {
        Intent intent = new Intent(context, RNAppAuthWebViewActivity.class);
        intent.putExtra(EXTRA_URL, url.toString());
        intent.putExtra(EXTRA_REDIRECT_URI, redirectUri.toString());
        intent.putExtra(EXTRA_OPTIONS, options.toJson());
        return intent;
    }

    /** Clears cookies, web storage and HTTP cache of every WebView in the app. */
    public static void clearWebViewData(@NonNull Context context, @Nullable final Runnable done) {
        WebStorage.getInstance().deleteAllData();
        CookieManager cookies = CookieManager.getInstance();
        cookies.removeAllCookies(removed -> {
            cookies.flush();
            if (done != null) done.run();
        });
        try {
            new WebView(context).clearCache(true);
        } catch (Exception ignored) {
            // WebView provider unavailable.
        }
    }

    private BrowserOptions options;
    private Uri redirectUri;
    private WebView webView;
    private ProgressBar progressBar;
    private TextView titleView;
    private TextView urlView;
    private BrowserOptions.HeaderColors colors;
    private FrameLayout webViewContainer;
    @Nullable private ReactSurface loaderSurface;
    @Nullable private View loaderView;
    private boolean pageReady;
    private boolean initialMessagesDelivered;
    private boolean usesWebMessageListener;
    private boolean documentStartScriptInstalled;
    private boolean finishedWithResult;
    @Nullable private volatile String currentOrigin;
    @Nullable private Object backCallback;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Intent intent = getIntent();
        String url = intent.getStringExtra(EXTRA_URL);
        String redirect = intent.getStringExtra(EXTRA_REDIRECT_URI);
        if (url == null || redirect == null) {
            // Started by a deep link filter while no web view flow is open: report it instead of failing silently.
            Uri link = intent.getData();
            if (link != null && Intent.ACTION_VIEW.equals(intent.getAction())) {
                Bundle event = new Bundle();
                event.putString("mode", MODE);
                event.putString("url", link.toString());
                event.putString("result", "notOpen");
                BrowserBridge.get().emit("deeplink", event);
            }
            finish();
            return;
        }
        options = BrowserOptions.fromJson(intent.getStringExtra(EXTRA_OPTIONS));
        redirectUri = Uri.parse(redirect);
        colors = options.header.resolveColors(this);

        setContentView(buildLayout());
        configureWebView();
        registerBackHandler();

        BrowserBridge.get().attach(this, MODE);
        BrowserBridge.get().emit("opened", MODE, "url", url);

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else if (options.clearWebViewData) {
            clearWebViewData(this, () -> load(url));
        } else {
            load(url);
        }
    }

    /**
     * Receives deep links routed to this activity (the app adds an intent filter through manifest
     * merging) and forwards them to the page as `{type:'deeplink', url, code, state}`.
     */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        Uri data = intent.getData();
        if (webView == null || data == null || !Intent.ACTION_VIEW.equals(intent.getAction())) return;
        if (isRedirect(data)) {
            finishWithRedirect(data);
            return;
        }
        if (!isDeepLinkAllowed(data)) return;
        forwardDeepLink(data);
    }

    private void forwardDeepLink(Uri data) {
        String result = BrowserBridge.RESULT_UNSUPPORTED;
        try {
            JSONObject message = new JSONObject();
            message.put("type", "deeplink");
            message.put("url", data.toString());
            for (String key : new String[]{"code", "state", "error", "error_description"}) {
                String value = data.isHierarchical() ? data.getQueryParameter(key) : null;
                if (value != null) message.put(key, value);
            }
            result = BrowserBridge.get().postMessage(message.toString());
        } catch (org.json.JSONException ignored) {
            // Only thrown for non-finite numbers, which are never put here.
        }
        Bundle event = new Bundle();
        event.putString("mode", MODE);
        event.putString("url", data.toString());
        event.putString("result", result);
        BrowserBridge.get().emit("deeplink", event);
    }

    private void load(String url) {
        if (webView == null || isFinishing()) return;
        if (options.headers.isEmpty()) {
            webView.loadUrl(url);
        } else {
            webView.loadUrl(url, options.headers);
        }
    }

    // ---- Layout ------------------------------------------------------------------------------------

    private View buildLayout() {
        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, false);

        boolean dark = options.header.isDark(this);
        int background = colors.backgroundColor != null ? colors.backgroundColor
                : (dark ? Color.parseColor("#202124") : Color.WHITE);
        int tint = colors.tintColor != null ? colors.tintColor : contrastColor(background);
        int titleColor = colors.titleColor != null ? colors.titleColor : contrastColor(background);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(background);

        if (!options.header.hidden) {
            root.addView(buildHeader(background, tint, titleColor),
                    new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(56)));
        }

        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setIndeterminate(false);
        progressBar.setMax(100);
        int progressColor = colors.progressColor != null ? colors.progressColor : tint;
        progressBar.setProgressTintList(ColorStateList.valueOf(progressColor));
        progressBar.setVisibility(View.GONE);
        root.addView(progressBar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)));

        webView = new WebView(this);
        webView.setBackgroundColor(dark ? Color.BLACK : Color.WHITE);
        webViewContainer = new FrameLayout(this);
        webViewContainer.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(webViewContainer, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        showLoader(dark);

        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars()
                    | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });

        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, root);
        boolean lightBackground = ColorUtils.calculateLuminance(background) > 0.5;
        controller.setAppearanceLightStatusBars(lightBackground);
        if (colors.navigationBarColor != null) {
            controller.setAppearanceLightNavigationBars(ColorUtils.calculateLuminance(colors.navigationBarColor) > 0.5);
            if (Build.VERSION.SDK_INT < 35) {
                setLegacyNavigationBarColor(window, colors.navigationBarColor);
            }
        } else {
            controller.setAppearanceLightNavigationBars(lightBackground);
        }
        return root;
    }

    @SuppressWarnings("deprecation")
    private static void setLegacyNavigationBarColor(Window window, int color) {
        window.setNavigationBarColor(color);
    }

    private View buildHeader(int background, int tint, int titleColor) {
        BrowserOptions.Header header = options.header;
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(background);
        bar.setPadding(dp(4), 0, dp(4), 0);

        boolean closeAtEnd = "end".equals(header.closeButtonPosition);
        if (!header.closeButtonHidden && !closeAtEnd) bar.addView(buildCloseButton(tint));
        for (BrowserOptions.HeaderButton button : header.buttons) {
            if ("start".equals(button.position)) bar.addView(buildTextButton(button.title, tint, v -> onHeaderButton(button.id)));
        }

        LinearLayout titles = new LinearLayout(this);
        titles.setOrientation(LinearLayout.VERTICAL);
        titles.setGravity(Gravity.CENTER_VERTICAL);
        titles.setPadding(dp(12), 0, dp(12), 0);

        titleView = new TextView(this);
        titleView.setTextColor(titleColor);
        titleView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        titleView.setTypeface(Typeface.DEFAULT_BOLD);
        titleView.setSingleLine(true);
        titleView.setEllipsize(TextUtils.TruncateAt.END);
        if (header.title != null) titleView.setText(header.title);
        titleView.setVisibility(header.title != null || !Boolean.FALSE.equals(header.showTitle) ? View.VISIBLE : View.GONE);
        titles.addView(titleView);

        urlView = new TextView(this);
        urlView.setTextColor(ColorUtils.setAlphaComponent(titleColor, 0xB3));
        urlView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        urlView.setSingleLine(true);
        urlView.setEllipsize(TextUtils.TruncateAt.MIDDLE);
        urlView.setVisibility(header.showUrl ? View.VISIBLE : View.GONE);
        titles.addView(urlView);

        bar.addView(titles, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f));

        for (BrowserOptions.HeaderButton button : header.buttons) {
            if (!"start".equals(button.position)) bar.addView(buildTextButton(button.title, tint, v -> onHeaderButton(button.id)));
        }
        if (!header.closeButtonHidden && closeAtEnd) bar.addView(buildCloseButton(tint));
        return bar;
    }

    private View buildCloseButton(int tint) {
        BrowserOptions.Header header = options.header;
        View.OnClickListener close = v -> cancel();
        String style = header.closeButtonStyle;
        String text = header.closeButtonText;
        if (text == null && ("done".equals(style) || "cancel".equals(style))) {
            text = "done".equals(style) ? "Done" : "Cancel";
        }
        if (text != null) {
            View button = buildTextButton(text, tint, close);
            button.setContentDescription(text);
            return button;
        }
        ImageButton button = new ImageButton(this);
        Drawable icon = ContextCompat.getDrawable(this,
                "back".equals(style) ? R.drawable.rnappauth_ic_arrow_back : R.drawable.rnappauth_ic_close);
        if (icon != null) {
            icon = DrawableCompat.wrap(icon.mutate());
            DrawableCompat.setTint(icon, tint);
        }
        button.setImageDrawable(icon);
        button.setBackground(selectableBackground());
        button.setContentDescription("back".equals(style) ? "Back" : "Close");
        button.setOnClickListener(close);
        button.setLayoutParams(new LinearLayout.LayoutParams(dp(48), dp(48)));
        return button;
    }

    private View buildTextButton(String title, int tint, View.OnClickListener listener) {
        TextView button = new TextView(this);
        button.setText(title);
        button.setTextColor(tint);
        button.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        button.setGravity(Gravity.CENTER);
        button.setPadding(dp(12), 0, dp(12), 0);
        button.setMinWidth(dp(48));
        button.setBackground(selectableBackground());
        button.setClickable(true);
        button.setFocusable(true);
        button.setOnClickListener(listener);
        button.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(48)));
        return button;
    }

    @Nullable
    private Drawable selectableBackground() {
        TypedValue value = new TypedValue();
        getTheme().resolveAttribute(android.R.attr.selectableItemBackgroundBorderless, value, true);
        return value.resourceId != 0 ? ContextCompat.getDrawable(this, value.resourceId) : null;
    }

    // ---- Loader ------------------------------------------------------------------------------------

    /** Covers the web view with a React surface (rendered from JS) until the first page has loaded. */
    private void showLoader(boolean dark) {
        if (options.loaderComponent == null) return;
        try {
            if (!(getApplication() instanceof ReactApplication)) return;
            ReactHost host = ((ReactApplication) getApplication()).getReactHost();
            if (host == null) return;
            ReactSurface surface = host.createSurface(this, options.loaderComponent, null);
            ViewGroup view = surface.getView();
            if (view == null) return;
            surface.start();
            int background = options.loaderBackgroundColor != null ? options.loaderBackgroundColor
                    : (dark ? Color.BLACK : Color.WHITE);
            view.setBackgroundColor(background);
            view.setClickable(true);
            webViewContainer.addView(view, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            loaderSurface = surface;
            loaderView = view;
        } catch (Exception ignored) {
            // The loader is cosmetic: never block authorization because of it.
        }
    }

    private void hideLoader() {
        final View view = loaderView;
        final ReactSurface surface = loaderSurface;
        if (view == null) return;
        loaderView = null;
        loaderSurface = null;
        view.animate().alpha(0f).setDuration(options.loaderFadeDuration).withEndAction(() -> {
            if (view.getParent() instanceof ViewGroup) ((ViewGroup) view.getParent()).removeView(view);
            if (surface != null) {
                surface.stop();
                surface.detach();
            }
        }).start();
    }

    // ---- WebView -----------------------------------------------------------------------------------

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        if (options.userAgent != null) settings.setUserAgentString(options.userAgent);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        if (options.messaging.enabled) {
            Set<String> rules = originRules();
            if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                try {
                    WebViewCompat.addWebMessageListener(webView, NATIVE_OBJECT, rules,
                            (view, message, sourceOrigin, isMainFrame, replyProxy) -> {
                                if (isMainFrame && message.getData() != null) {
                                    onPageMessage(message.getData(), sourceOrigin.toString());
                                }
                            });
                    usesWebMessageListener = true;
                } catch (Exception e) {
                    usesWebMessageListener = false;
                }
            }
            if (!usesWebMessageListener) {
                webView.addJavascriptInterface(new JsInterface(), NATIVE_OBJECT);
            }
            if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                try {
                    WebViewCompat.addDocumentStartJavaScript(webView, bridgeScript(options.messaging.bridgeName), rules);
                    documentStartScriptInstalled = true;
                } catch (Exception ignored) {
                    // Falls back to injection in onPageStarted/onPageFinished.
                }
            }
        }

        webView.setWebViewClient(new Client());
        webView.setWebChromeClient(new ChromeClient());
    }

    private Set<String> originRules() {
        List<String> allowed = options.messaging.allowedOrigins;
        if (allowed.isEmpty()) return Collections.singleton("*");
        return new HashSet<>(allowed);
    }

    private boolean isOriginAllowed(@Nullable String origin) {
        List<String> allowed = options.messaging.allowedOrigins;
        if (allowed.isEmpty()) return true;
        if (origin == null) return false;
        Uri originUri = Uri.parse(origin);
        for (String rule : allowed) {
            if ("*".equals(rule) || rule.equalsIgnoreCase(origin)) return true;
            // Rules without a scheme (e.g. `*.example.com`) match any http(s) origin.
            boolean hasScheme = rule.contains("://");
            Uri ruleUri = Uri.parse(hasScheme ? rule : "https://" + rule);
            String ruleHost = ruleUri.getHost();
            if (ruleHost != null && originUri.getHost() != null
                    && (!hasScheme || TextUtils.equals(ruleUri.getScheme(), originUri.getScheme()))
                    && (ruleHost.startsWith("*.")
                    ? originUri.getHost().endsWith(ruleHost.substring(1))
                    : !hasScheme && originUri.getHost().equalsIgnoreCase(ruleHost))) {
                return true;
            }
        }
        return false;
    }

    @Nullable
    private static String originOf(@Nullable String url) {
        if (url == null) return null;
        Uri uri = Uri.parse(url);
        if (uri.getScheme() == null || uri.getHost() == null) return null;
        String origin = uri.getScheme() + "://" + uri.getHost();
        return uri.getPort() != -1 ? origin + ":" + uri.getPort() : origin;
    }

    private boolean isDeepLinkAllowed(Uri uri) {
        if (options.deepLinkUrls.isEmpty()) return true;
        String scheme = lower(uri.getScheme());
        String target = (uri.getAuthority() != null ? uri.getAuthority() : "")
                + (uri.getPath() != null ? uri.getPath() : "");
        for (String raw : options.deepLinkUrls) {
            String rule = raw.trim();
            int separator = rule.indexOf("://");
            if (separator >= 0) {
                if (!TextUtils.equals(lower(rule.substring(0, separator)), scheme)) continue;
                rule = rule.substring(separator + 3);
            }
            if (rule.startsWith("/")) rule = rule.substring(1);
            boolean prefix = rule.endsWith("*");
            if (prefix) rule = rule.substring(0, rule.length() - 1);
            if (prefix ? target.startsWith(rule) : TextUtils.equals(trimSlash(rule), trimSlash(target))) {
                return true;
            }
        }
        return false;
    }

    private static String trimSlash(String value) {
        return value.endsWith("/") ? value.substring(0, value.length() - 1) : value;
    }

    private boolean isRedirect(Uri uri) {
        if (!TextUtils.equals(lower(uri.getScheme()), lower(redirectUri.getScheme()))) return false;
        if (!TextUtils.equals(lower(uri.getHost()), lower(redirectUri.getHost()))) return false;
        if (uri.getPort() != redirectUri.getPort()) return false;
        return TextUtils.equals(normalizePath(uri.getPath()), normalizePath(redirectUri.getPath()));
    }

    private static String lower(@Nullable String value) {
        return value == null ? null : value.toLowerCase(java.util.Locale.US);
    }

    private static String normalizePath(@Nullable String path) {
        if (path == null || path.isEmpty()) return "/";
        return path.endsWith("/") && path.length() > 1 ? path.substring(0, path.length() - 1) : path;
    }

    private boolean isHostAllowed(Uri uri) {
        if (options.allowedHosts.isEmpty() || uri.getHost() == null) return true;
        String host = uri.getHost().toLowerCase(java.util.Locale.US);
        for (String allowed : options.allowedHosts) {
            String rule = allowed.toLowerCase(java.util.Locale.US);
            if (host.equals(rule) || (rule.startsWith("*.") && host.endsWith(rule.substring(1)))) return true;
        }
        return false;
    }

    /** Returns true when the navigation was handled natively and must not load in the web view. */
    private boolean handleNavigation(Uri uri) {
        if (isRedirect(uri)) {
            finishWithRedirect(uri);
            return true;
        }
        String scheme = lower(uri.getScheme());
        boolean web = "http".equals(scheme) || "https".equals(scheme);
        if (web && isHostAllowed(uri)) return false;
        // A custom-scheme link the page navigates to that is listed in deepLinkUrls stays in the web
        // view, otherwise the system would route it to the app's main activity and close this one.
        if (!web && !options.deepLinkUrls.isEmpty() && isDeepLinkAllowed(uri)) {
            forwardDeepLink(uri);
            return true;
        }
        if ("about".equals(scheme) || "data".equals(scheme) || "blob".equals(scheme)) {
            return false;
        }
        // Like Custom Tabs, prefer a native app (e.g. an ID app) that handles the link over the browser.
        if (web && openInNativeApp(uri)) return true;
        openExternally(uri);
        return true;
    }

    private boolean openInNativeApp(Uri uri) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return false;
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            intent.addFlags(Intent.FLAG_ACTIVITY_REQUIRE_NON_BROWSER);
            startActivity(intent);
            return true;
        } catch (ActivityNotFoundException e) {
            return false;
        }
    }

    private void openExternally(Uri uri) {
        try {
            Intent intent = "intent".equals(lower(uri.getScheme()))
                    ? Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME)
                    : new Intent(Intent.ACTION_VIEW, uri);
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            intent.setComponent(null);
            intent.setSelector(null);
            startActivity(intent);
        } catch (ActivityNotFoundException | java.net.URISyntaxException ignored) {
            // Nothing can handle it, ignore the navigation.
        }
    }

    private void finishWithRedirect(Uri uri) {
        if (finishedWithResult) return;
        finishedWithResult = true;
        startActivity(AuthorizationManagementActivity.createResponseHandlingIntent(this, uri));
        finish();
        overridePendingTransitionCompat();
    }

    private void cancel() {
        finish();
        overridePendingTransitionCompat();
    }

    @SuppressWarnings("deprecation")
    private void overridePendingTransitionCompat() {
        if ("none".equals(options.animation)) {
            overridePendingTransition(0, 0);
        } else if ("fade".equals(options.animation)) {
            overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out);
        } else if ("slide".equals(options.animation)) {
            overridePendingTransition(R.anim.rnappauth_slide_in_left, R.anim.rnappauth_slide_out_right);
        }
    }

    private void onHeaderButton(String id) {
        Bundle event = new Bundle();
        event.putString("mode", MODE);
        event.putString("buttonId", id);
        if (webView != null && webView.getUrl() != null) event.putString("url", webView.getUrl());
        BrowserBridge.get().emit("headerButtonPress", event);
    }

    private void onPageMessage(@NonNull String data, @Nullable String origin) {
        if (!isOriginAllowed(origin)) return;
        Bundle event = new Bundle();
        event.putString("mode", MODE);
        event.putString("data", data);
        if (origin != null) event.putString("origin", origin);
        if (webView != null && webView.getUrl() != null) event.putString("url", webView.getUrl());
        BrowserBridge.get().emit("message", event);
    }

    private void handleBack() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            cancel();
        }
    }

    private void registerBackHandler() {
        if (Build.VERSION.SDK_INT >= 33) {
            android.window.OnBackInvokedCallback callback = this::handleBack;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, callback);
            backCallback = callback;
        }
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        handleBack();
    }

    @Override
    protected void onSaveInstanceState(@NonNull Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) webView.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        if (loaderSurface != null) {
            loaderSurface.stop();
            loaderSurface.detach();
            loaderSurface = null;
            loaderView = null;
        }
        BrowserBridge.get().detach(this);
        if (Build.VERSION.SDK_INT >= 33 && backCallback != null) {
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(
                    (android.window.OnBackInvokedCallback) backCallback);
        }
        if (webView != null) {
            webView.stopLoading();
            webView.setWebViewClient(new WebViewClient());
            webView.setWebChromeClient(null);
            ViewGroup parent = (ViewGroup) webView.getParent();
            if (parent != null) parent.removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    // ---- MessageTarget -----------------------------------------------------------------------------

    @Override
    public boolean isMessagingReady() {
        return webView != null && pageReady && options.messaging.enabled && isOriginAllowed(currentOrigin);
    }

    @Override
    public boolean supportsMessaging() {
        return options.messaging.enabled;
    }

    @Override
    public boolean deliverMessage(@NonNull String message) {
        if (!isMessagingReady()) return false;
        String name = options.messaging.bridgeName;
        String script = "(function(){var d=" + JSONObject.quote(message) + ";var e;"
                + "try{e=new MessageEvent('message',{data:d,origin:'react-native'});}"
                + "catch(_){e=document.createEvent('MessageEvent');e.initMessageEvent('message',false,false,d,'react-native','',window);}"
                + "window.dispatchEvent(e);"
                + "if(window." + name + "&&typeof window." + name + ".onmessage==='function'){window." + name + ".onmessage(e);}"
                + "})();";
        webView.evaluateJavascript(script, null);
        return true;
    }

    // ---- Clients -----------------------------------------------------------------------------------

    private final class JsInterface {
        @JavascriptInterface
        public void postMessage(final String data) {
            final String origin = currentOrigin;
            BrowserBridge.get().runOnMain(() -> {
                if (data != null) onPageMessage(data, origin);
            });
        }
    }

    private final class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (!request.isForMainFrame()) return false;
            return handleNavigation(request.getUrl());
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            if (url != null && isRedirect(Uri.parse(url))) {
                view.stopLoading();
                finishWithRedirect(Uri.parse(url));
                return;
            }
            pageReady = false;
            initialMessagesDelivered = false;
            currentOrigin = originOf(url);
            if (urlView != null && url != null) {
                String host = Uri.parse(url).getHost();
                urlView.setText(host != null ? host : url);
            }
            if (options.messaging.enabled && !usesDocumentStartScript()) {
                view.evaluateJavascript(bridgeScript(options.messaging.bridgeName), null);
            }
            BrowserBridge.get().emit("navigationStarted", MODE, "url", url);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (finishedWithResult) return;
            currentOrigin = originOf(url);
            if (options.messaging.enabled && !usesDocumentStartScript()) {
                view.evaluateJavascript(bridgeScript(options.messaging.bridgeName), null);
            }
            pageReady = true;
            hideLoader();
            BrowserBridge.get().emit("navigationFinished", MODE, "url", url);
            if (!initialMessagesDelivered && isMessagingReady()) {
                initialMessagesDelivered = true;
                BrowserBridge.get().emit("messageChannelReady", MODE, "origin", currentOrigin);
                BrowserBridge.get().onMessagingReady(RNAppAuthWebViewActivity.this, options.messaging.initialMessages);
            }
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame()) return;
            if (isRedirect(request.getUrl())) return;
            hideLoader();
            Bundle event = new Bundle();
            event.putString("mode", MODE);
            event.putString("url", request.getUrl().toString());
            event.putString("error", String.valueOf(error.getDescription()));
            BrowserBridge.get().emit("navigationFailed", event);
        }
    }

    private boolean usesDocumentStartScript() {
        return documentStartScriptInstalled;
    }

    private final class ChromeClient extends WebChromeClient {
        @Override
        public void onProgressChanged(WebView view, int newProgress) {
            if (progressBar == null || !options.header.showProgress) return;
            progressBar.setProgress(newProgress);
            progressBar.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
        }

        @Override
        public void onReceivedTitle(WebView view, String title) {
            if (titleView == null || options.header.title != null) return;
            if (!Boolean.FALSE.equals(options.header.showTitle)) titleView.setText(title);
        }
    }

    // ---- Utils -------------------------------------------------------------------------------------

    private int dp(int value) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics()));
    }

    private static int contrastColor(int background) {
        return ColorUtils.calculateLuminance(background) > 0.5 ? Color.parseColor("#202124") : Color.WHITE;
    }
}

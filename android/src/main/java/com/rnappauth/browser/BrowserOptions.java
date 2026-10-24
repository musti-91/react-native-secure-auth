package com.rnappauth.browser;

import android.content.Context;
import android.content.res.Configuration;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Typed view over the `browser` options produced by `normalizeBrowserOptions()` in JS.
 * Stored as JSON so it can be passed to {@link RNAppAuthWebViewActivity} through an Intent extra.
 */
public final class BrowserOptions {

    public static final String MODE_CUSTOM_TAB = "customTab";
    public static final String MODE_WEB_VIEW = "webView";

    public static final class HeaderColors {
        @Nullable public Integer backgroundColor;
        @Nullable public Integer tintColor;
        @Nullable public Integer titleColor;
        @Nullable public Integer secondaryColor;
        @Nullable public Integer navigationBarColor;
        @Nullable public Integer navigationBarDividerColor;
        @Nullable public Integer progressColor;

        static HeaderColors parse(@Nullable JSONObject json) {
            HeaderColors colors = new HeaderColors();
            if (json == null) return colors;
            colors.backgroundColor = optColor(json, "backgroundColor");
            colors.tintColor = optColor(json, "tintColor");
            colors.titleColor = optColor(json, "titleColor");
            colors.secondaryColor = optColor(json, "secondaryColor");
            colors.navigationBarColor = optColor(json, "navigationBarColor");
            colors.navigationBarDividerColor = optColor(json, "navigationBarDividerColor");
            colors.progressColor = optColor(json, "progressColor");
            return colors;
        }

        /** Returns a copy where every color set in {@code override} wins. */
        HeaderColors merge(@Nullable HeaderColors override) {
            HeaderColors merged = new HeaderColors();
            merged.backgroundColor = pick(override == null ? null : override.backgroundColor, backgroundColor);
            merged.tintColor = pick(override == null ? null : override.tintColor, tintColor);
            merged.titleColor = pick(override == null ? null : override.titleColor, titleColor);
            merged.secondaryColor = pick(override == null ? null : override.secondaryColor, secondaryColor);
            merged.navigationBarColor = pick(override == null ? null : override.navigationBarColor, navigationBarColor);
            merged.navigationBarDividerColor = pick(override == null ? null : override.navigationBarDividerColor, navigationBarDividerColor);
            merged.progressColor = pick(override == null ? null : override.progressColor, progressColor);
            return merged;
        }

        public boolean isEmpty() {
            return backgroundColor == null && secondaryColor == null && navigationBarColor == null
                    && navigationBarDividerColor == null;
        }

        private static Integer pick(Integer preferred, Integer fallback) {
            return preferred != null ? preferred : fallback;
        }
    }

    public static final class HeaderButton {
        public final String id;
        public final String title;
        public final String position;

        HeaderButton(String id, String title, String position) {
            this.id = id;
            this.title = title;
            this.position = position;
        }
    }

    public static final class Header {
        public HeaderColors colors = new HeaderColors();
        @Nullable public HeaderColors dark;
        @Nullable public String title;
        @Nullable public Boolean showTitle;
        public boolean showUrl;
        public boolean hidden;
        @Nullable public Boolean hideUrlBarOnScroll;
        @Nullable public Boolean shareButton;
        public boolean showProgress = true;
        @NonNull public String colorScheme = "system";
        @NonNull public String closeButtonPosition = "start";
        @NonNull public String closeButtonStyle = "close";
        @Nullable public String closeButtonText;
        public boolean closeButtonHidden;
        public List<HeaderButton> buttons = new ArrayList<>();

        static Header parse(@Nullable JSONObject json) {
            Header header = new Header();
            if (json == null) return header;
            header.colors = HeaderColors.parse(json);
            JSONObject dark = json.optJSONObject("dark");
            header.dark = dark != null ? HeaderColors.parse(dark) : null;
            header.title = optString(json, "title");
            header.showTitle = optBoolean(json, "showTitle");
            header.showUrl = json.optBoolean("showUrl", false);
            header.hidden = json.optBoolean("hidden", false);
            header.hideUrlBarOnScroll = optBoolean(json, "hideUrlBarOnScroll");
            header.shareButton = optBoolean(json, "shareButton");
            header.showProgress = json.optBoolean("showProgress", true);
            String scheme = optString(json, "colorScheme");
            if (scheme != null) header.colorScheme = scheme;

            JSONObject close = json.optJSONObject("closeButton");
            if (close != null) {
                String position = optString(close, "position");
                if (position != null) header.closeButtonPosition = position;
                String style = optString(close, "style");
                if (style != null) header.closeButtonStyle = style;
                header.closeButtonText = optString(close, "text");
                header.closeButtonHidden = close.optBoolean("hidden", false);
            }

            JSONArray buttons = json.optJSONArray("buttons");
            if (buttons != null) {
                for (int i = 0; i < buttons.length(); i++) {
                    JSONObject button = buttons.optJSONObject(i);
                    if (button == null) continue;
                    String id = optString(button, "id");
                    String title = optString(button, "title");
                    if (id == null || title == null) continue;
                    String position = optString(button, "position");
                    header.buttons.add(new HeaderButton(id, title, position != null ? position : "end"));
                }
            }
            return header;
        }

        /** Colors resolved for the current (or forced) light / dark appearance. */
        public HeaderColors resolveColors(Context context) {
            return isDark(context) ? colors.merge(dark) : colors;
        }

        public boolean isDark(Context context) {
            if ("dark".equals(colorScheme)) return true;
            if ("light".equals(colorScheme)) return false;
            int mode = context.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
            return mode == Configuration.UI_MODE_NIGHT_YES;
        }
    }

    public static final class Partial {
        @Nullable public Double height;
        @Nullable public Double width;
        @Nullable public Double breakpoint;
        @Nullable public Double cornerRadius;
        public boolean resizable = true;
        @Nullable public Boolean backgroundInteraction;

        static Partial parse(@Nullable JSONObject json) {
            if (json == null) return null;
            Partial partial = new Partial();
            partial.height = optDouble(json, "height");
            partial.width = optDouble(json, "width");
            partial.breakpoint = optDouble(json, "breakpoint");
            partial.cornerRadius = optDouble(json, "cornerRadius");
            partial.resizable = json.optBoolean("resizable", true);
            partial.backgroundInteraction = optBoolean(json, "backgroundInteraction");
            return partial;
        }
    }

    public static final class Messaging {
        public boolean enabled;
        public List<String> initialMessages = new ArrayList<>();
        @Nullable public String androidOrigin;
        @Nullable public String androidTargetOrigin;
        public List<String> allowedOrigins = new ArrayList<>();
    }

    @NonNull public final String mode;
    @Nullable public final String loaderComponent;
    @Nullable public final Integer loaderBackgroundColor;
    public final long loaderFadeDuration;
    @NonNull public final Header header;
    @NonNull public final Map<String, String> headers;
    @Nullable public final String userAgent;
    @NonNull public final Messaging messaging;
    @Nullable public final Partial partial;
    @Nullable public final String animation;
    public final boolean clearWebViewData;
    @NonNull public final List<String> allowedHosts;
    @NonNull private final String json;

    private BrowserOptions(@NonNull JSONObject json) {
        this.json = json.toString();
        String parsedMode = optString(json, "mode");
        this.mode = parsedMode != null ? parsedMode : MODE_CUSTOM_TAB;
        JSONObject loader = json.optJSONObject("loader");
        this.loaderComponent = loader != null ? optString(loader, "component") : null;
        this.loaderBackgroundColor = loader != null ? optColor(loader, "backgroundColor") : null;
        this.loaderFadeDuration = loader != null ? loader.optLong("fadeDuration", 200) : 200;
        this.header = Header.parse(json.optJSONObject("header"));
        this.headers = stringMap(json.optJSONObject("headers"));
        this.userAgent = optString(json, "userAgent");
        this.partial = Partial.parse(json.optJSONObject("partial"));
        this.animation = optString(json, "animation");
        this.clearWebViewData = json.optBoolean("clearWebViewData", false);
        this.allowedHosts = stringList(json.optJSONArray("allowedHosts"));

        this.messaging = new Messaging();
        JSONObject messagingJson = json.optJSONObject("messaging");
        if (messagingJson != null) {
            messaging.initialMessages = stringList(messagingJson.optJSONArray("initialMessages"));
            messaging.androidOrigin = optString(messagingJson, "androidOrigin");
            messaging.androidTargetOrigin = optString(messagingJson, "androidTargetOrigin");
            messaging.allowedOrigins = stringList(messagingJson.optJSONArray("allowedOrigins"));
        }
        boolean defaultEnabled = isWebView() || messaging.androidOrigin != null;
        messaging.enabled = messagingJson != null
                ? messagingJson.optBoolean("enabled", defaultEnabled)
                : defaultEnabled;
    }

    /** Default options (used when JS passes no `browser` config). */
    public static BrowserOptions defaults() {
        return new BrowserOptions(new JSONObject());
    }

    public static BrowserOptions fromMap(@Nullable Map<String, Object> map) {
        if (map == null) return defaults();
        return new BrowserOptions(new JSONObject(map));
    }

    public static BrowserOptions fromJson(@Nullable String json) {
        if (json == null) return defaults();
        try {
            return new BrowserOptions(new JSONObject(json));
        } catch (JSONException e) {
            return defaults();
        }
    }

    public String toJson() {
        return json;
    }

    public boolean isWebView() {
        return MODE_WEB_VIEW.equals(mode);
    }

    /** Custom Tabs messaging requires an origin verified through Digital Asset Links. */
    public boolean canMessageCustomTab() {
        return messaging.enabled && messaging.androidOrigin != null;
    }

    // ---- JSON helpers ---------------------------------------------------------------------------

    @Nullable
    static String optString(JSONObject json, String key) {
        if (!json.has(key) || json.isNull(key)) return null;
        Object value = json.opt(key);
        return value instanceof String ? (String) value : String.valueOf(value);
    }

    @Nullable
    static Boolean optBoolean(JSONObject json, String key) {
        if (!json.has(key) || json.isNull(key)) return null;
        return json.optBoolean(key);
    }

    @Nullable
    static Double optDouble(JSONObject json, String key) {
        if (!json.has(key) || json.isNull(key)) return null;
        double value = json.optDouble(key, Double.NaN);
        return Double.isNaN(value) ? null : value;
    }

    /** processColor() produces a 32-bit ARGB value, possibly delivered as a (positive) double. */
    @Nullable
    static Integer optColor(JSONObject json, String key) {
        if (!json.has(key) || json.isNull(key)) return null;
        Object value = json.opt(key);
        if (value instanceof Number) {
            return (int) ((Number) value).longValue();
        }
        return null;
    }

    static List<String> stringList(@Nullable JSONArray array) {
        if (array == null) return Collections.emptyList();
        List<String> list = new ArrayList<>();
        for (int i = 0; i < array.length(); i++) {
            if (!array.isNull(i)) list.add(String.valueOf(array.opt(i)));
        }
        return list;
    }

    static Map<String, String> stringMap(@Nullable JSONObject json) {
        Map<String, String> map = new LinkedHashMap<>();
        if (json == null) return map;
        Iterator<String> keys = json.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            if (!json.isNull(key)) map.put(key, String.valueOf(json.opt(key)));
        }
        return map;
    }
}

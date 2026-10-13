package app.cinemoy;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.window.OnBackInvokedDispatcher;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** Hosts the CineMoy web UI (served by the in-app engine) and hands playback to PlayerActivity. */
public class MainActivity extends Activity {
    private static final int REQUEST_PLAYER = 1;
    private static final String UPDATE_PREFIX = "https://github.com/SaeedMoy/CineMoy/releases/download/";

    private WebView web;
    private View splash;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        web = findViewById(R.id.web);
        splash = findViewById(R.id.splash);
        goFullscreen();

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true); // settings, continue-watching
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(s.getUserAgentString() + " CineMoyAndroid/1");
        web.setBackgroundColor(0xFF110C1B);
        web.addJavascriptInterface(new Bridge(), "CineMoyAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("127.0.0.1".equals(uri.getHost())) return false;
                // Settings links (SubDL, Torrentio configure…) open in the device browser.
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                    // no browser (some TVs)
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                splash.setVisibility(View.GONE);
                web.requestFocus();
            }
        });

        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }

        // If the engine stops, restart the app (Node can't be restarted inside the same process).
        NodeEngine.onExit = () -> runOnUiThread(this::recoverEngine);
        NodeEngine.start(this);
        new Thread(() -> {
            boolean ready = NodeEngine.waitUntilReady(45_000);
            runOnUiThread(() -> {
                if (ready) web.loadUrl(NodeEngine.BASE_URL + "/");
                else recoverEngine();
            });
        }, "engine-wait").start();
    }

    /** Restarts automatically once; if that didn't help, asks the user (avoids a restart loop). */
    private void recoverEngine() {
        if (isFinishing() || isDestroyed()) {
            android.os.Process.killProcess(android.os.Process.myPid()); // in the background: start fresh next time
            return;
        }
        SharedPreferences prefs = getSharedPreferences("engine", MODE_PRIVATE);
        long last = prefs.getLong("autoRestartAt", 0);
        if (System.currentTimeMillis() - last > 3 * 60_000) {
            prefs.edit().putLong("autoRestartAt", System.currentTimeMillis()).commit();
            RestartActivity.restart(this);
            return;
        }
        splash.setVisibility(View.GONE);
        web.loadDataWithBaseURL(null, "<body style='background:#110c1b;color:#fff;font-family:sans-serif;padding:2em'>"
                + "<h2>CineMoy engine stopped</h2><p>Restarting usually fixes this. If it keeps happening, free up some storage space.</p>"
                + "<button autofocus style='font-size:1.2em;padding:.6em 1.6em;border:0;border-radius:99px;background:#ff6f61;color:#fff'"
                + " onclick='CineMoyAndroid.restart()'>Restart CineMoy</button></body>", "text/html", "utf-8", null);
        web.requestFocus();
    }

    /** Lets the web UI handle Back first (close dialogs, go to the previous page). */
    private void handleBack() {
        web.evaluateJavascript("window.__cmBack ? window.__cmBack() : false", result -> {
            if (!"true".equals(result)) finish();
        });
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() { // Android 12 and older
        handleBack();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_PLAYER) return;
        long pos = data != null ? data.getLongExtra(PlayerActivity.EXTRA_POSITION, 0) : 0;
        long dur = data != null ? data.getLongExtra(PlayerActivity.EXTRA_DURATION, 0) : 0;
        boolean ended = data != null && data.getBooleanExtra(PlayerActivity.EXTRA_ENDED, false);
        web.evaluateJavascript("window.__cmNativeClosed && window.__cmNativeClosed(" + pos + "," + dur + "," + ended + ")", null);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) goFullscreen();
    }

    private void goFullscreen() {
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
    }

    private void callJs(String fn, String arg) {
        String js = "window." + fn + " && window." + fn + "(" + JSONObject.quote(arg) + ")";
        runOnUiThread(() -> web.evaluateJavascript(js, null));
    }

    /** Downloads the update APK (GitHub release asset), then opens Android's installer. */
    private void downloadUpdate(String url) {
        File out = ApkProvider.file(this);
        try {
            out.getParentFile().mkdirs();
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(15_000);
            c.setReadTimeout(30_000);
            c.setInstanceFollowRedirects(true); // github.com → objects.githubusercontent.com
            if (c.getResponseCode() != 200) throw new IOException("HTTP " + c.getResponseCode());
            long total = c.getContentLengthLong();
            try (InputStream in = c.getInputStream(); OutputStream o = new FileOutputStream(out)) {
                byte[] buf = new byte[64 * 1024];
                long done = 0;
                int n, lastPct = -1;
                while ((n = in.read(buf)) > 0) {
                    o.write(buf, 0, n);
                    done += n;
                    int pct = total > 0 ? (int) (done * 100 / total) : 0;
                    if (pct != lastPct) {
                        lastPct = pct;
                        callJs("__cmUpdateProgress", String.valueOf(pct));
                    }
                }
            } finally {
                c.disconnect();
            }
            runOnUiThread(this::installUpdate);
        } catch (Exception e) {
            //noinspection ResultOfMethodCallIgnored
            out.delete();
            callJs("__cmUpdateError", "download failed (" + e.getMessage() + ")");
        }
    }

    private void installUpdate() {
        if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
            // Android 8+: the user must allow CineMoy to install apps once.
            callJs("__cmUpdateError", "allow CineMoy to install apps, then press Try again");
            try {
                startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName())));
            } catch (Exception ignored) {
                // some TVs don't have this screen; the system asks during install instead
            }
            return;
        }
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(ApkProvider.uri(), ApkProvider.MIME);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            startActivity(i);
            callJs("__cmUpdateDone", "");
        } catch (Exception e) {
            callJs("__cmUpdateError", "this device has no package installer");
        }
    }

    /** Exposed to the web UI as window.CineMoyAndroid. */
    private class Bridge {
        @JavascriptInterface
        public void play(String json) {
            runOnUiThread(() -> {
                Intent i = new Intent(MainActivity.this, PlayerActivity.class);
                i.putExtra(PlayerActivity.EXTRA_REQUEST, json);
                startActivityForResult(i, REQUEST_PLAYER);
            });
        }

        /** The CPU type of this installation, to pick the matching APK from a release. */
        @JavascriptInterface
        public String abi() {
            String dir = new File(getApplicationInfo().nativeLibraryDir).getName();
            switch (dir) {
                case "arm64": return "arm64-v8a";
                case "arm": return "armeabi-v7a";
                case "x86_64": return "x86_64";
                default: return Build.SUPPORTED_ABIS[0];
            }
        }

        @JavascriptInterface
        public void installUpdate(String url) {
            // Only release files from the CineMoy repository.
            if (url == null || !url.startsWith(UPDATE_PREFIX) || !url.endsWith(".apk")) {
                callJs("__cmUpdateError", "invalid update address");
                return;
            }
            new Thread(() -> downloadUpdate(url), "update-download").start();
        }

        @JavascriptInterface
        public void restart() {
            runOnUiThread(() -> RestartActivity.restart(MainActivity.this));
        }
    }
}

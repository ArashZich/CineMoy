package app.cinemoy;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.window.OnBackInvokedDispatcher;

/** Hosts the CineMoy web UI (served by the in-app engine) and hands playback to PlayerActivity. */
public class MainActivity extends Activity {
    private static final int REQUEST_PLAYER = 1;

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

        NodeEngine.start(this);
        new Thread(() -> {
            boolean ready = NodeEngine.waitUntilReady(45_000);
            runOnUiThread(() -> {
                if (ready) web.loadUrl(NodeEngine.BASE_URL + "/");
                else web.loadDataWithBaseURL(null, "<body style='background:#110c1b;color:#fff;font-family:sans-serif;padding:2em'>"
                        + "<h2>CineMoy engine did not start</h2><p>Please restart the app.</p></body>", "text/html", "utf-8", null);
            });
        }, "engine-wait").start();
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
    }
}

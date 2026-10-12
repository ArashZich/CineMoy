package app.cinemoy;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.widget.TextView;

import androidx.annotation.OptIn;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.CaptionStyleCompat;
import androidx.media3.ui.PlayerView;
import androidx.media3.ui.SubtitleView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Native player (Media3 ExoPlayer). Hardware decoders handle H.264/HEVC/VP9/AV1; the Jellyfin FFmpeg
 * extension decodes audio the device can't (DTS, TrueHD, AC3/E-AC3…). Subtitles found by the
 * engine are added as selectable tracks; the controller's settings button switches subtitle/audio.
 */
@OptIn(markerClass = UnstableApi.class)
public class PlayerActivity extends Activity {
    public static final String EXTRA_REQUEST = "request";
    public static final String EXTRA_POSITION = "position";
    public static final String EXTRA_DURATION = "duration";
    public static final String EXTRA_ENDED = "ended";

    private ExoPlayer player;
    private PlayerView view;
    private TextView titleView;
    private TextView statusView;
    private String statusUrl;
    private boolean ended;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_player);
        view = findViewById(R.id.player);
        titleView = findViewById(R.id.title);
        statusView = findViewById(R.id.status);
        goFullscreen();

        JSONObject req;
        try {
            req = new JSONObject(getIntent().getStringExtra(EXTRA_REQUEST));
        } catch (Exception e) {
            finish();
            return;
        }
        String title = req.optString("title");
        String subtitle = req.optString("subtitle");
        titleView.setText(subtitle.isEmpty() ? title : title + "\n" + subtitle);
        statusUrl = req.optString("statusUrl");

        // Torrents can take a while to find peers: generous timeouts, and a bigger buffer.
        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
                .setConnectTimeoutMs(60_000)
                .setReadTimeoutMs(60_000)
                .setAllowCrossProtocolRedirects(true);
        DefaultRenderersFactory renderers = new DefaultRenderersFactory(this)
                .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON)
                .setEnableDecoderFallback(true);
        DefaultLoadControl load = new DefaultLoadControl.Builder()
                .setBufferDurationsMs(30_000, 120_000, 3_000, 6_000)
                .build();
        player = new ExoPlayer.Builder(this, renderers)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(new DefaultDataSource.Factory(this, http)))
                .setLoadControl(load)
                .build();
        view.setPlayer(player);
        view.setKeepScreenOn(true);
        view.setShowSubtitleButton(true);
        view.setControllerVisibilityListener((PlayerView.ControllerVisibilityListener) visibility -> {
            titleView.setVisibility(visibility);
            updateStatusVisibility();
        });
        styleSubtitles(view.getSubtitleView());

        // Subtitle tracks (WebVTT served by the engine). The preferred language is auto-selected.
        String preferred = req.optString("preferredSubLang");
        List<MediaItem.SubtitleConfiguration> subs = new ArrayList<>();
        JSONArray list = req.optJSONArray("subtitles");
        for (int i = 0; list != null && i < list.length(); i++) {
            JSONObject s = list.optJSONObject(i);
            if (s == null) continue;
            subs.add(new MediaItem.SubtitleConfiguration.Builder(Uri.parse(s.optString("url")))
                    .setMimeType(MimeTypes.TEXT_VTT)
                    .setLanguage(s.optString("lang"))
                    .setLabel(languageName(s.optString("lang")) + " · " + s.optString("label"))
                    .build());
        }
        if (!preferred.isEmpty()) {
            player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
                    .setPreferredTextLanguage(preferred)
                    .setSelectUndeterminedTextLanguage(false)
                    .build());
        }

        MediaItem item = new MediaItem.Builder()
                .setUri(req.optString("url"))
                .setMediaMetadata(new MediaMetadata.Builder().setTitle(title).build())
                .setSubtitleConfigurations(subs)
                .build();
        player.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_ENDED) {
                    ended = true;
                    finish();
                }
                updateStatusVisibility();
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                showError(error);
            }
        });
        player.setMediaItem(item, Math.max(0, req.optLong("startMs")));
        player.prepare();
        player.setPlayWhenReady(true);
        pollStatus();
    }

    private void styleSubtitles(SubtitleView sv) {
        if (sv == null) return;
        sv.setApplyEmbeddedStyles(false);
        sv.setFractionalTextSize(SubtitleView.DEFAULT_TEXT_SIZE_FRACTION * 1.3f);
        sv.setStyle(new CaptionStyleCompat(Color.WHITE, 0x66000000, Color.TRANSPARENT,
                CaptionStyleCompat.EDGE_TYPE_OUTLINE, Color.BLACK, Typeface.DEFAULT_BOLD));
    }

    private static String languageName(String code) {
        switch (code) {
            case "fa": return "فارسی";
            case "en": return "English";
            case "ar": return "العربية";
            case "tr": return "Türkçe";
            default: return code;
        }
    }

    /** Peers and download speed from the engine, shown while buffering or when controls are up. */
    private void pollStatus() {
        if (statusUrl.isEmpty() || isFinishing()) return;
        io.execute(() -> {
            String text = null;
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(statusUrl).openConnection();
                c.setConnectTimeout(2000);
                c.setReadTimeout(3000);
                try (InputStream in = c.getInputStream()) {
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    byte[] buf = new byte[4096];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                    JSONObject s = new JSONObject(out.toString("UTF-8"));
                    if (!"idle".equals(s.optString("state"))) {
                        double speed = s.optDouble("downloadSpeed", 0);
                        text = String.format(Locale.US, "%d peers · %s",
                                s.optInt("peers"), speed > 1048576
                                        ? String.format(Locale.US, "%.1f MB/s", speed / 1048576)
                                        : String.format(Locale.US, "%d KB/s", Math.round(speed / 1024)));
                    }
                }
                c.disconnect();
            } catch (Exception ignored) {
                // engine busy
            }
            final String t = text;
            handler.post(() -> {
                if (t != null) statusView.setText(t);
                updateStatusVisibility();
            });
        });
        handler.postDelayed(this::pollStatus, 1500);
    }

    private void updateStatusVisibility() {
        boolean buffering = player != null && player.getPlaybackState() != Player.STATE_READY;
        boolean show = statusView.getText().length() > 0 && (buffering || view.isControllerFullyVisible());
        statusView.setVisibility(show ? View.VISIBLE : View.GONE);
    }

    private void showError(PlaybackException error) {
        String msg = error.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT
                || error.errorCode == PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS
                ? "This source could not be loaded (too few peers?). Try another source."
                : "Playback failed: " + error.getErrorCodeName();
        new AlertDialog.Builder(this)
                .setTitle("CineMoy")
                .setMessage(msg)
                .setPositiveButton("Close", (d, w) -> finish())
                .setOnCancelListener(d -> finish())
                .show();
    }

    @Override
    public void finish() {
        if (player != null) {
            Intent result = new Intent();
            long dur = player.getDuration();
            result.putExtra(EXTRA_POSITION, player.getCurrentPosition());
            result.putExtra(EXTRA_DURATION, dur == C.TIME_UNSET ? 0 : dur);
            result.putExtra(EXTRA_ENDED, ended);
            setResult(RESULT_OK, result);
        }
        super.finish();
    }

    @Override
    protected void onStop() {
        super.onStop();
        if (player != null) player.pause();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        io.shutdownNow();
        if (player != null) {
            player.release();
            player = null;
        }
        super.onDestroy();
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
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        }
    }
}

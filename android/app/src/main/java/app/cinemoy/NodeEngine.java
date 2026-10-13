package app.cinemoy;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.AssetManager;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Runs the CineMoy server (server/ bundled for Node 18 by scripts/bundle-server.mjs) inside the
 * app with nodejs-mobile. It listens on 127.0.0.1 only, so other devices on the network can't use it.
 */
public final class NodeEngine {
    public static final int PORT = 47070;
    public static final String BASE_URL = "http://127.0.0.1:" + PORT;
    private static final String TAG = "CineMoyEngine";
    private static final String ASSET_DIR = "nodejs-project";

    static {
        System.loadLibrary("node");
        System.loadLibrary("native-lib");
    }

    private static native int startNode(String[] arguments);

    private static boolean started;
    /** Called (on the node thread) if the engine stops; it can only come back with a new process. */
    public static volatile Runnable onExit;

    private NodeEngine() {}

    /** Starts Node once per process (Node cannot be restarted inside the same process). */
    public static synchronized void start(Context context) {
        if (started) return;
        started = true;
        final Context app = context.getApplicationContext();
        Runnable run = () -> {
            try {
                File project = new File(app.getFilesDir(), ASSET_DIR);
                copyAssetsIfUpdated(app, project);
                int code = startNode(new String[] {
                        "node",
                        new File(project, "server/index.mjs").getAbsolutePath(),
                        "--port=" + PORT,
                        "--host=127.0.0.1",
                        "--cache-dir=" + new File(app.getCacheDir(), "torrents").getAbsolutePath(),
                });
                Log.e(TAG, "Node exited with code " + code);
            } catch (Exception e) {
                Log.e(TAG, "Engine failed to start", e);
            }
            Runnable r = onExit;
            if (r != null) r.run();
        };
        // V8 needs a large native stack.
        new Thread(null, run, "node", 16L * 1024 * 1024).start();
    }

    /** Blocks (call off the UI thread) until the server answers, or the timeout passes. */
    public static boolean waitUntilReady(long timeoutMs) {
        long end = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < end) {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(BASE_URL + "/api/config").openConnection();
                c.setConnectTimeout(1000);
                c.setReadTimeout(2000);
                int status = c.getResponseCode();
                c.disconnect();
                if (status == 200) return true;
            } catch (IOException ignored) {
                // not up yet
            }
            try {
                Thread.sleep(250);
            } catch (InterruptedException e) {
                return false;
            }
        }
        return false;
    }

    /** Re-copies the bundled server from the APK after every install/update. */
    private static void copyAssetsIfUpdated(Context app, File target) throws IOException {
        SharedPreferences prefs = app.getSharedPreferences("engine", Context.MODE_PRIVATE);
        long installed;
        try {
            installed = app.getPackageManager().getPackageInfo(app.getPackageName(), 0).lastUpdateTime;
        } catch (PackageManager.NameNotFoundException e) {
            installed = -1;
        }
        if (target.isDirectory() && prefs.getLong("copiedFor", 0) == installed) return;
        deleteRecursively(target);
        copyAssetDir(app.getAssets(), ASSET_DIR, target);
        prefs.edit().putLong("copiedFor", installed).apply();
    }

    private static void copyAssetDir(AssetManager assets, String path, File dest) throws IOException {
        String[] children = assets.list(path);
        if (children == null || children.length == 0) { // a file
            dest.getParentFile().mkdirs();
            try (InputStream in = assets.open(path); OutputStream out = new FileOutputStream(dest)) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            }
            return;
        }
        dest.mkdirs();
        for (String child : children) copyAssetDir(assets, path + "/" + child, new File(dest, child));
    }

    private static void deleteRecursively(File f) {
        File[] children = f.listFiles();
        if (children != null) for (File c : children) deleteRecursively(c);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }
}

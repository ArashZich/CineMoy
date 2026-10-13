package app.cinemoy;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.os.Process;

/**
 * Restarts CineMoy with a fresh process (the only way to restart the Node engine). Runs in its
 * own process (":restart" in the manifest): it ends the old app process, then opens the app again.
 */
public class RestartActivity extends Activity {
    private static final String EXTRA_PID = "pid";

    /** Call from a visible activity. */
    public static void restart(Activity from) {
        Intent i = new Intent(from, RestartActivity.class);
        i.putExtra(EXTRA_PID, Process.myPid());
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        from.startActivity(i);
        from.finishAffinity();
        Runtime.getRuntime().exit(0);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        int pid = getIntent().getIntExtra(EXTRA_PID, -1);
        if (pid > 0 && pid != Process.myPid()) Process.killProcess(pid);
        Intent main = new Intent(this, MainActivity.class);
        main.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        startActivity(main);
        finish();
        Runtime.getRuntime().exit(0);
    }
}

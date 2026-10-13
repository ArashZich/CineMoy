package app.cinemoy;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * Hands the downloaded update APK to the system installer (Android 7+ only accepts content:// URIs).
 * Serves exactly one file: cache/updates/CineMoy-update.apk.
 */
public class ApkProvider extends ContentProvider {
    public static final String AUTHORITY = "app.cinemoy.apk";
    public static final String FILE_NAME = "CineMoy-update.apk";
    public static final String MIME = "application/vnd.android.package-archive";

    public static File file(android.content.Context c) {
        return new File(new File(c.getCacheDir(), "updates"), FILE_NAME);
    }

    public static Uri uri() {
        return Uri.parse("content://" + AUTHORITY + "/" + FILE_NAME);
    }

    private File resolve(Uri uri) throws FileNotFoundException {
        if (!FILE_NAME.equals(uri.getLastPathSegment())) throw new FileNotFoundException(uri.toString());
        return file(getContext());
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        return ParcelFileDescriptor.open(resolve(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public String getType(Uri uri) {
        return MIME;
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        File f;
        try {
            f = resolve(uri);
        } catch (FileNotFoundException e) {
            return null;
        }
        MatrixCursor c = new MatrixCursor(new String[] {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
        c.addRow(new Object[] {FILE_NAME, f.length()});
        return c;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        throw new UnsupportedOperationException();
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException();
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException();
    }
}

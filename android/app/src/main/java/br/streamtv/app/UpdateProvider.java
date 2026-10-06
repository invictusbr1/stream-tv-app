package br.streamtv.app;
import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;

/** Shares only the verified installer, read-only, through a temporary URI grant. */
public final class UpdateProvider extends ContentProvider {
    public boolean onCreate(){return true;}
    private File file(Uri u) throws FileNotFoundException {
        if(!"/update.apk".equals(u.getPath()) || u.getQuery()!=null || u.getFragment()!=null)throw new FileNotFoundException();
        File f=new File(getContext().getCacheDir(),"stream-update.apk");if(!f.isFile())throw new FileNotFoundException();return f;
    }
    public ParcelFileDescriptor openFile(Uri u,String mode) throws FileNotFoundException {if(!"r".equals(mode))throw new FileNotFoundException();return ParcelFileDescriptor.open(file(u),ParcelFileDescriptor.MODE_READ_ONLY);}
    public String getType(Uri u){return "application/vnd.android.package-archive";}
    public Cursor query(Uri u,String[] projection,String selection,String[] args,String sort){try{File f=file(u);String[] cols=projection==null?new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE}:projection;MatrixCursor c=new MatrixCursor(cols);Object[] row=new Object[cols.length];for(int i=0;i<cols.length;i++)row[i]=OpenableColumns.DISPLAY_NAME.equals(cols[i])?"Stream-TV.apk":OpenableColumns.SIZE.equals(cols[i])?f.length():null;c.addRow(row);return c;}catch(Exception e){return null;}}
    public Uri insert(Uri u,ContentValues v){throw new UnsupportedOperationException();}
    public int update(Uri u,ContentValues v,String s,String[] a){throw new UnsupportedOperationException();}
    public int delete(Uri u,String s,String[] a){throw new UnsupportedOperationException();}
}

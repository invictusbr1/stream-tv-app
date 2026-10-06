package br.streamtv.app;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.ProgressDialog;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.ClipData;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.widget.Toast;
import org.json.JSONObject;
import javax.net.ssl.HttpsURLConnection;
import java.net.URL;
import java.io.*;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class AppUpdater {
    private final Activity activity;
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private boolean busy,active;
    private File pending;
    private boolean awaitingPermission,ready;
    private final Handler timer=new Handler(Looper.getMainLooper());
    private final Runnable periodic=new Runnable(){@Override public void run(){check(false);if(active)timer.postDelayed(this,30*60*1000L);}};
    AppUpdater(Activity a){activity=a;}
    void resume(){active=true;timer.removeCallbacks(periodic);timer.postDelayed(periodic,30*60*1000L);if(ready){ready=false;new AlertDialog.Builder(activity).setTitle("Atualização pronta").setMessage("O download terminou. Deseja instalar agora?").setNegativeButton("Depois",null).setPositiveButton("Instalar",(v,w)->install()).show();}if(awaitingPermission){awaitingPermission=false;if(Build.VERSION.SDK_INT<26||activity.getPackageManager().canRequestPackageInstalls())install();else tell("Instalação não autorizada. Você pode tentar novamente em Atualizações.");}}
    void pause(){active=false;timer.removeCallbacks(periodic);}
    void close(){timer.removeCallbacks(periodic);worker.shutdownNow();}
    private void ui(Runnable r){activity.runOnUiThread(()->{if(!activity.isFinishing()&&!activity.isDestroyed())r.run();});}
    private void tell(String message){if(active)new AlertDialog.Builder(activity).setTitle("Atualizações do Stream TV").setMessage(message).setPositiveButton("OK",null).show();}
    private long version(PackageInfo p){return Build.VERSION.SDK_INT>=28?p.getLongVersionCode():p.versionCode;}
    private PackageInfo installed() throws Exception{return activity.getPackageManager().getPackageInfo(activity.getPackageName(),PackageManager.GET_SIGNATURES);}
    void check(boolean explicit){
        if(busy){if(explicit)Toast.makeText(activity,"Aguarde a atualização em andamento.",Toast.LENGTH_SHORT).show();return;}
        android.content.SharedPreferences prefs=activity.getSharedPreferences("updates",0);
        if(!explicit && System.currentTimeMillis()-prefs.getLong("checked",0)<30*60*1000L)return;
        busy=true;
        if(explicit)Toast.makeText(activity,"Procurando atualização…",Toast.LENGTH_SHORT).show();
        worker.execute(()->{try{
            JSONObject d=new JSONObject(new String(readFeed(),java.nio.charset.StandardCharsets.UTF_8));
            PackageInfo currentPackage=installed();long current=version(currentPackage), next=d.getLong("versionCode");
            if(next<=current){ui(()->{busy=false;prefs.edit().putLong("checked",System.currentTimeMillis()).apply();if(explicit)tell("Você está usando a versão "+currentPackage.versionName+". Nenhuma atualização disponível.");});return;}
            if(!UpdatePolicy.valid(next,current,d.getLong("bytes"),d.getString("sha256"),d.getString("apkUrl")))throw new IOException("invalid feed");
            ui(()->{busy=false;prefs.edit().putLong("checked",System.currentTimeMillis()).apply();notifyUpdate(safeVersion(d));if(!active)return;new AlertDialog.Builder(activity).setTitle("Nova versão: "+safeVersion(d)).setMessage("Atualize agora sem perder seu histórico.\n\n"+d.optString("notes","").substring(0,Math.min(1500,d.optString("notes","").length()))).setNegativeButton("Depois",null).setPositiveButton("Atualizar agora",(v,w)->download(d)).show();});
        }catch(Exception e){ui(()->{busy=false;if(explicit)tell("Não foi possível consultar as atualizações. O canal pode ainda não estar publicado ou a internet está indisponível. Seu aplicativo continua funcionando.");});}});
    }
    private String safeVersion(JSONObject d){return d.optString("versionName","disponível").substring(0,Math.min(50,d.optString("versionName","disponível").length()));}
    private void notifyUpdate(String version){
        try{
            if(Build.VERSION.SDK_INT>=33&&activity.checkSelfPermission("android.permission.POST_NOTIFICATIONS")!=PackageManager.PERMISSION_GRANTED){activity.requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"},741);return;}
            NotificationManager manager=(NotificationManager)activity.getSystemService(Activity.NOTIFICATION_SERVICE);
            if(manager==null)return;
            if(Build.VERSION.SDK_INT>=26)manager.createNotificationChannel(new NotificationChannel("stream-tv-updates","Atualizações do Stream TV",NotificationManager.IMPORTANCE_DEFAULT));
            Intent open=new Intent(activity,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pendingIntent=PendingIntent.getActivity(activity,741,open,Build.VERSION.SDK_INT>=23?PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT:PendingIntent.FLAG_UPDATE_CURRENT);
            android.app.Notification.Builder builder=Build.VERSION.SDK_INT>=26?new android.app.Notification.Builder(activity,"stream-tv-updates"):new android.app.Notification.Builder(activity);
            manager.notify(741,builder.setSmallIcon(android.R.drawable.stat_sys_download_done).setContentTitle("Atualização do Stream TV").setContentText("A versão "+version+" está pronta. Toque para atualizar.").setContentIntent(pendingIntent).setAutoCancel(true).build());
        }catch(Exception ignored){}
    }
    private HttpsURLConnection connection(String url) throws Exception {HttpsURLConnection c=(HttpsURLConnection)new URL(url).openConnection();c.setConnectTimeout(15000);c.setReadTimeout(20000);c.setInstanceFollowRedirects(false);c.setRequestProperty("User-Agent","StreamTV-Updater");c.setRequestProperty("Cache-Control","no-cache");return c;}
    private byte[] readFeed() throws Exception {HttpsURLConnection c=connection(UpdatePolicy.FEED);try{if(c.getResponseCode()!=200)throw new IOException();try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1){if(out.size()+n>32768)throw new IOException();out.write(b,0,n);}return out.toByteArray();}}finally{c.disconnect();}}
    private void download(JSONObject d){
        if(busy)return;busy=true;
        ProgressDialog dialog=new ProgressDialog(activity);dialog.setTitle("Baixando atualização");dialog.setMessage("O Android pedirá sua confirmação para instalar.");dialog.setProgressStyle(ProgressDialog.STYLE_HORIZONTAL);dialog.setMax(100);dialog.setCancelable(false);dialog.show();
        worker.execute(()->{File temp=new File(activity.getCacheDir(),"stream-update.part");try{
            String url=d.getString("apkUrl");HttpsURLConnection c=null;
            try{for(int i=0;i<6;i++){if(!UpdatePolicy.downloadUrl(url,i>0))throw new IOException();c=connection(url);int status=c.getResponseCode();if(status==200)break;if(status<300||status>399)throw new IOException();String target=c.getHeaderField("Location");c.disconnect();c=null;url=new URL(new URL(url),target).toString();}
                if(c==null||c.getResponseCode()!=200)throw new IOException();long expected=d.getLong("bytes"),total=0;MessageDigest digest=MessageDigest.getInstance("SHA-256");
                try(InputStream in=c.getInputStream();FileOutputStream out=new FileOutputStream(temp)){byte[] b=new byte[32768];int n,last=-1;while((n=in.read(b))!=-1){if(Thread.currentThread().isInterrupted())throw new IOException();total+=n;if(total>expected||total>UpdatePolicy.MAX_BYTES)throw new IOException();out.write(b,0,n);digest.update(b,0,n);int progress=(int)(total*100/expected);if(progress!=last){last=progress;ui(()->dialog.setProgress(progress));}}}
                if(total!=expected||!UpdatePolicy.hex(digest.digest()).equalsIgnoreCase(d.getString("sha256")))throw new IOException();
            }finally{if(c!=null)c.disconnect();}
            verify(temp,d.getLong("versionCode"));File apk=new File(activity.getCacheDir(),"stream-update.apk");if(apk.exists()&&!apk.delete())throw new IOException();if(!temp.renameTo(apk))throw new IOException();
            ui(()->{busy=false;dialog.dismiss();pending=apk;if(active)install();else ready=true;});
        }catch(Exception e){temp.delete();ui(()->{busy=false;dialog.dismiss();tell("Não foi possível baixar ou verificar a atualização. Nenhum aplicativo foi instalado. Tente novamente com uma conexão estável.");});}});
    }
    private byte[][] signers(Signature[] s){if(s==null)return null;byte[][] b=new byte[s.length][];for(int i=0;i<s.length;i++)b[i]=s[i].toByteArray();return b;}
    private void verify(File f,long expected) throws Exception {PackageInfo old=installed(),next=activity.getPackageManager().getPackageArchiveInfo(f.getAbsolutePath(),PackageManager.GET_SIGNATURES);if(next==null||!activity.getPackageName().equals(next.packageName)||version(next)<=version(old)||(expected>0&&version(next)!=expected)||!UpdatePolicy.sameSigners(signers(old.signatures),signers(next.signatures)))throw new IOException("signature or version");}
    private void install(){if(pending==null||!pending.isFile())return;
        try{verify(pending,0);
            if(Build.VERSION.SDK_INT>=26&&!activity.getPackageManager().canRequestPackageInstalls()){new AlertDialog.Builder(activity).setTitle("Permitir atualização").setMessage("Na próxima tela, permita que o Stream TV instale atualizações. Depois volte para confirmar a instalação.").setNegativeButton("Agora não",null).setPositiveButton("Abrir configuração",(v,w)->{try{awaitingPermission=true;activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+activity.getPackageName())));}catch(Exception e){awaitingPermission=false;tell("Abra as configurações do Android e permita instalações pelo Stream TV.");}}).show();return;}
            Uri uri=Uri.parse("content://"+activity.getPackageName()+".updates/update.apk");Intent intent=new Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);intent.setClipData(ClipData.newRawUri("Stream TV",uri));activity.startActivity(intent);
        }catch(Exception e){tell("Não foi possível abrir o instalador deste aparelho. Você ainda pode instalar o APK manualmente.");}
    }
}

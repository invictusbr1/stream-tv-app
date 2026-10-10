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
    private void tell(String message){if(active)new AlertDialog.Builder(activity).setTitle("Atualizações do Conecta TV").setMessage(message).setPositiveButton("OK",null).show();}
    private long version(PackageInfo p){return Build.VERSION.SDK_INT>=28?p.getLongVersionCode():p.versionCode;}
    // O Android 11 em diante deixou de devolver as assinaturas em GET_SIGNATURES:
    // sem GET_SIGNING_CERTIFICATES a verificação do APK baixado falhava sempre.
    private int sinalizadores(){return Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES;}
    private PackageInfo installed() throws Exception{return activity.getPackageManager().getPackageInfo(activity.getPackageName(),sinalizadores());}
    private byte[][] assinaturas(PackageInfo p){
        if(p==null)return null;
        if(Build.VERSION.SDK_INT>=28){
            android.content.pm.SigningInfo info=p.signingInfo;
            if(info==null)return null;
            android.content.pm.Signature[] lista=info.hasMultipleSigners()?info.getApkContentsSigners():info.getSigningCertificateHistory();
            if(lista==null||lista.length==0)lista=info.getApkContentsSigners();
            if(lista==null)return null;
            byte[][] saida=new byte[lista.length][];
            for(int i=0;i<lista.length;i++)saida[i]=lista[i].toByteArray();
            return saida;
        }
        return signers(p.signatures);
    }
    void check(boolean explicit){
        if(busy){if(explicit)Toast.makeText(activity,"Aguarde a atualização em andamento.",Toast.LENGTH_SHORT).show();return;}
        android.content.SharedPreferences prefs=activity.getSharedPreferences("updates",0);
        if(!explicit && System.currentTimeMillis()-prefs.getLong("checked",0)<30*60*1000L)return;
        busy=true;
        if(explicit)Toast.makeText(activity,"Procurando atualização…",Toast.LENGTH_SHORT).show();
        worker.execute(()->{try{
            JSONObject d=paraEsteAparelho(lerFeed());
            PackageInfo currentPackage=installed();long current=version(currentPackage), next=d.getLong("versionCode");
            if(next<=current){ui(()->{busy=false;prefs.edit().putLong("checked",System.currentTimeMillis()).apply();relatar(currentPackage.versionName,safeVersion(d),"atualizado","");if(explicit)tell("Você está usando a versão "+currentPackage.versionName+". Nenhuma atualização disponível.");});return;}
            if(!UpdatePolicy.valid(next,current,d.getLong("bytes"),d.getString("sha256"),d.getString("apkUrl"))){ui(()->relatar(currentPackage.versionName,safeVersion(d),"aviso-invalido",""));throw new IOException("invalid feed");}
            ui(()->{busy=false;prefs.edit().putLong("checked",System.currentTimeMillis()).apply();relatar(currentPackage.versionName,safeVersion(d),"disponivel","");notifyUpdate(safeVersion(d));if(!active)return;new AlertDialog.Builder(activity).setTitle("Nova versão: "+safeVersion(d)).setMessage("Sua versão: "+currentPackage.versionName+". Atualize agora sem perder seu histórico.\n\n"+d.optString("notes","").substring(0,Math.min(1500,d.optString("notes","").length()))).setNegativeButton("Depois",null).setPositiveButton("Atualizar agora",(v,w)->download(d)).show();});
        }catch(Exception e){ui(()->{busy=false;relatar("","","falhou",e.getClass().getSimpleName());if(explicit)tell("Não foi possível consultar as atualizações agora ("+e.getClass().getSimpleName()+"). Confira a internet do aparelho — o aplicativo continua funcionando.");});}});
    }
    // Conta para a central (pela própria interface) o que foi medido no aparelho.
    // O aplicativo da TV usa o APK próprio (apkTv*) quando o aviso oferece os dois.
    private JSONObject paraEsteAparelho(JSONObject d){
        if(!BuildConfig.TV)return d;
        try{
            if(d.has("apkTvUrl")){
                d.put("apkUrl",d.getString("apkTvUrl"));
                if(d.has("apkTvBytes"))d.put("bytes",d.getLong("apkTvBytes"));
                if(d.has("apkTvSha256"))d.put("sha256",d.getString("apkTvSha256"));
            }
        }catch(Exception ignored){}
        return d;
    }
    private void relatar(String instalada,String publicada,String resultado,String motivo){
        try{
            JSONObject aviso=new JSONObject();
            aviso.put("instalada",instalada==null?"":instalada);
            aviso.put("publicada",publicada==null?"":publicada);
            aviso.put("resultado",resultado==null?"":resultado);
            aviso.put("motivo",motivo==null?"":motivo);
            aviso.put("canal",BuildConfig.TV?"tv":"celular");
            final String chamada="window.StreamAtualizacao&&window.StreamAtualizacao("+aviso.toString()+")";
            activity.runOnUiThread(()->{try{MainActivity m=(MainActivity)activity;m.relatarAtualizacao(chamada);}catch(Exception ignored){}});
        }catch(Exception ignored){}
    }
    private String safeVersion(JSONObject d){return d.optString("versionName","disponível").substring(0,Math.min(50,d.optString("versionName","disponível").length()));}
    private void notifyUpdate(String version){
        try{
            if(Build.VERSION.SDK_INT>=33&&activity.checkSelfPermission("android.permission.POST_NOTIFICATIONS")!=PackageManager.PERMISSION_GRANTED){activity.requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"},741);return;}
            NotificationManager manager=(NotificationManager)activity.getSystemService(Activity.NOTIFICATION_SERVICE);
            if(manager==null)return;
            if(Build.VERSION.SDK_INT>=26)manager.createNotificationChannel(new NotificationChannel("stream-tv-updates","Atualizações do Conecta TV",NotificationManager.IMPORTANCE_DEFAULT));
            Intent open=new Intent(activity,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pendingIntent=PendingIntent.getActivity(activity,741,open,Build.VERSION.SDK_INT>=23?PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT:PendingIntent.FLAG_UPDATE_CURRENT);
            android.app.Notification.Builder builder=Build.VERSION.SDK_INT>=26?new android.app.Notification.Builder(activity,"stream-tv-updates"):new android.app.Notification.Builder(activity);
            manager.notify(741,builder.setSmallIcon(android.R.drawable.stat_sys_download_done).setContentTitle("Atualização do Conecta TV").setContentText("A versão "+version+" está pronta. Toque para atualizar.").setContentIntent(pendingIntent).setAutoCancel(true).build());
        }catch(Exception ignored){}
    }
    private HttpsURLConnection connection(String url) throws Exception {HttpsURLConnection c=(HttpsURLConnection)new URL(url).openConnection();c.setConnectTimeout(15000);c.setReadTimeout(20000);c.setInstanceFollowRedirects(false);c.setRequestProperty("User-Agent","StreamTV-Updater");c.setRequestProperty("Cache-Control","no-cache");return c;}
    // Procura o manifesto no primeiro endereço que responder (o GitHub tem mais
    // de um caminho e algumas redes bloqueiam um deles).
    private JSONObject lerFeed() throws Exception {
        Exception ultimo=null;
        for(String endereco:UpdatePolicy.FEEDS){
            try{return new JSONObject(new String(readFeed(endereco),java.nio.charset.StandardCharsets.UTF_8));}
            catch(Exception e){ultimo=e;}
        }
        throw ultimo!=null?ultimo:new IOException("feed");
    }
    private byte[] readFeed(String endereco) throws Exception {HttpsURLConnection c=connection(endereco);try{c.setInstanceFollowRedirects(true);if(c.getResponseCode()!=200)throw new IOException();try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1){if(out.size()+n>32768)throw new IOException();out.write(b,0,n);}return out.toByteArray();}}finally{c.disconnect();}}
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
            ui(()->{busy=false;dialog.dismiss();relatar("",safeVersion(d),"baixado","");pending=apk;if(active)install();else ready=true;});
        }catch(Exception e){temp.delete();final String link=linkDaVersao(d);ui(()->{busy=false;dialog.dismiss();relatar("",safeVersion(d),"download-falhou",e.getClass().getSimpleName());new AlertDialog.Builder(activity).setTitle("Atualização não concluída").setMessage("Não consegui baixar ou conferir a atualização ("+e.getClass().getSimpleName()+"). Nada foi instalado.\n\nA versão nova também pode ser baixada pelo navegador.").setNegativeButton("Fechar",null).setPositiveButton("Baixar pelo navegador",(v,w)->abrirNoNavegador(link)).show();});}});
    }
    // Endereço do APK publicado; se o aviso não trouxer um endereço seguro, abre
    // a página de versões do projeto.
    private String linkDaVersao(JSONObject d){
        String url=d.optString("apkUrl","");
        if(UpdatePolicy.downloadUrl(url,false))return url;
        return "https://github.com/"+UpdatePolicy.REPOSITORY+"/releases/latest";
    }
    private void abrirNoNavegador(String url){
        try{activity.startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(url)));}
        catch(Exception e){tell("Abra no navegador: "+url);}
    }
    private byte[][] signers(Signature[] s){if(s==null)return null;byte[][] b=new byte[s.length][];for(int i=0;i<s.length;i++)b[i]=s[i].toByteArray();return b;}
    private void verify(File f,long expected) throws Exception {PackageInfo old=installed(),next=activity.getPackageManager().getPackageArchiveInfo(f.getAbsolutePath(),sinalizadores());if(next==null||!activity.getPackageName().equals(next.packageName)||version(next)<=version(old)||(expected>0&&version(next)!=expected)||!UpdatePolicy.sameSigners(assinaturas(old),assinaturas(next)))throw new IOException("signature or version");}
    private void install(){if(pending==null||!pending.isFile())return;
        try{verify(pending,0);
            if(Build.VERSION.SDK_INT>=26&&!activity.getPackageManager().canRequestPackageInstalls()){new AlertDialog.Builder(activity).setTitle("Permitir atualização").setMessage("Na próxima tela, permita que o Conecta TV instale atualizações. Depois volte para confirmar a instalação.").setNegativeButton("Agora não",null).setPositiveButton("Abrir configuração",(v,w)->{try{awaitingPermission=true;activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+activity.getPackageName())));}catch(Exception e){awaitingPermission=false;tell("Abra as configurações do Android e permita instalações pelo Conecta TV.");}}).show();return;}
            Uri uri=Uri.parse("content://"+activity.getPackageName()+".updates/update.apk");Intent intent=new Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);intent.setClipData(ClipData.newRawUri("Conecta TV",uri));activity.startActivity(intent);
        }catch(Exception e){tell("Não foi possível abrir o instalador deste aparelho. Você ainda pode instalar o APK manualmente.");}
    }
}

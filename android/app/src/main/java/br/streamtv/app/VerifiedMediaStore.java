package br.streamtv.app;
import java.io.*;
import java.util.*;

/** Memória privada por título; carregar uma URL nunca substitui a sonda atual. */
final class VerifiedMediaStore {
    private static final long TTL=7L*24*60*60*1000;
    private final File file;
    private boolean readable;
    private static final class Row {String title;QualitySelector.Candidate c;int width,height;long at;}
    VerifiedMediaStore(File file){this.file=file;}
    static boolean title(String key){return key!=null&&key.matches("movie:[0-9]{1,10}|tv:[0-9]{1,10}:[0-9]{1,3}:[0-9]{1,4}");}
    private static boolean safe(QualitySelector.Candidate c){try{MediaHttp.safe(c.url);if(!c.referer.isEmpty())MediaHttp.safe(c.referer);return c.id.matches("[a-z0-9_-]{1,64}")&&c.url.length()<=4096&&c.referer.length()<=2048&&c.json.length()<=16384&&"file".equals(c.type);}catch(Exception invalid){return false;}}
    private List<Row> read(){
        readable=false;List<Row> rows=new ArrayList<>();if(!file.isFile()||file.length()>2000000)return rows;
        try(DataInputStream in=new DataInputStream(new FileInputStream(file))){
            if(in.readInt()!=0x43545631)return rows;int count=in.readInt();if(count<0||count>192)return rows;
            for(int i=0;i<count;i++){Row r=new Row();r.title=in.readUTF();String id=in.readUTF(),url=in.readUTF(),ref=in.readUTF(),json=in.readUTF();r.width=in.readInt();r.height=in.readInt();r.at=in.readLong();
                r.c=new QualitySelector.Candidate(id,url,ref,"file",json,(int)QualitySelector.equivalent(r.width,r.height));r.c.remembered=true;
                if(title(r.title)&&safe(r.c)&&r.width>0&&r.height>0&&r.at>System.currentTimeMillis()-TTL&&r.at<=System.currentTimeMillis()+60000)rows.add(r);
            }
            readable=in.available()==0;
        }catch(Exception corrupt){rows.clear();}return rows;
    }
    synchronized boolean healthy(){read();return readable;}
    private static void remove(List<Row> rows,String title,QualitySelector.Candidate c){for(Iterator<Row> i=rows.iterator();i.hasNext();){Row r=i.next();if(r.title.equals(title)&&r.c.key().equals(c.key()))i.remove();}}
    synchronized List<QualitySelector.Candidate> load(String title,Set<String> allowed){
        List<QualitySelector.Candidate> out=new ArrayList<>();if(!title(title))return out;
        for(Row r:read())if(r.title.equals(title)&&allowed.contains(r.c.id))out.add(r.c);return out;
    }
    synchronized void save(String title,List<QualitySelector.Candidate> candidates){
        if(!title(title))return;List<Row> rows=read();
        for(QualitySelector.Candidate c:candidates){
            if(c.ephemeral){remove(rows,title,c);continue;}
            if(!safe(c)||c.measure==null)continue;QualitySelector.Measure m=c.measure;
            if(m.language<0){remove(rows,title,c);continue;}
            if(!m.playable)continue; // Indisponibilidade temporária não apaga uma fonte já comprovada.
            if(m.language!=2||m.width<=0||m.height<=0)continue;
            remove(rows,title,c);Row r=new Row();r.title=title;r.c=c;r.width=m.width;r.height=m.height;r.at=System.currentTimeMillis();rows.add(r);
        }
        Collections.sort(rows,(a,b)->Long.compare(b.at,a.at));Map<String,List<Row>> groups=new LinkedHashMap<>();
        for(Row r:rows){if(!groups.containsKey(r.title)&&groups.size()>=64)continue;if(!groups.containsKey(r.title))groups.put(r.title,new ArrayList<>());groups.get(r.title).add(r);}
        rows=new ArrayList<>();for(List<Row> group:groups.values()){Collections.sort(group,(a,b)->Double.compare(QualitySelector.equivalent(b.width,b.height),QualitySelector.equivalent(a.width,a.height)));rows.addAll(group.subList(0,Math.min(3,group.size())));}
        File temp=new File(file.getPath()+".tmp");try{
            File parent=file.getParentFile();if(parent!=null&&!parent.isDirectory()&&!parent.mkdirs())return;
            try(FileOutputStream stream=new FileOutputStream(temp);DataOutputStream out=new DataOutputStream(stream)){
                out.writeInt(0x43545631);out.writeInt(rows.size());for(Row r:rows){out.writeUTF(r.title);out.writeUTF(r.c.id);out.writeUTF(r.c.url);out.writeUTF(r.c.referer);out.writeUTF(r.c.json);out.writeInt(r.width);out.writeInt(r.height);out.writeLong(r.at);}out.flush();stream.getFD().sync();
            }
            if(!temp.renameTo(file)){if(file.exists()&&!file.delete())return;temp.renameTo(file);}
        }catch(Exception optional){ /* Uma falha no cache não bloqueia o player. */ }
    }
}

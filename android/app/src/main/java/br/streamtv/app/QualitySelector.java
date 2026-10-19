package br.streamtv.app;

import java.util.*;
import java.util.concurrent.*;
import java.util.regex.*;

/** Compara mídia do aparelho, sem abrir players externos e sem usar servidor. */
final class QualitySelector implements AutoCloseable {
    static final class Measure {
        final int width, height, language; // 2: português comprovado; 1: não informado; -1: outro idioma
        final long bitrate;
        final boolean playable;
        Measure(int width,int height,int language,long bitrate,boolean playable) {
            this.width=width;this.height=height;this.language=language;this.bitrate=bitrate;this.playable=playable;
        }
    }
    static final class Candidate {
        final String id,url,referer,type,json;
        final int declared;
        volatile Measure measure;
        volatile String deliveryUrl;
        boolean remembered;
        boolean requiresProof;
        boolean ephemeral;
        Candidate(String id,String url,String referer,String type,String json,int declared) {
            this.id=id;this.url=url;this.referer=referer==null?"":referer;this.type=type;this.json=json;this.declared=declared;
        }
        String key() { return type+"\n"+url+"\n"+referer; }
    }
    interface Source {
        Candidate resolve(long deadline) throws Exception;
        default List<Candidate> resolveAll(long deadline)throws Exception {
            Candidate c=resolve(deadline);return c==null?Collections.emptyList():Collections.singletonList(c);
        }
    }
    interface Probe { Measure read(Candidate candidate,long deadline) throws Exception; }
    interface Evidence {
        void load(long deadline) throws Exception;
        Measure apply(String title,Candidate candidate);
    }
    private static final class Entry<T> { final T value;final long expires;Entry(T v,long e){value=v;expires=e;} }
    private final ExecutorService workers=Executors.newFixedThreadPool(6,r->{Thread t=new Thread(r,"conecta-quality");t.setDaemon(true);return t;});
    private final Map<String,Entry<List<Candidate>>> choices=new LinkedHashMap<>();
    private final Map<String,Entry<Measure>> measures=new LinkedHashMap<>();
    private volatile boolean closed;
    private final VerifiedMediaStore history;
    // O aparelho declara se decodifica HEVC. Sem isso, a maior resolução da
    // lista pode ser um 4K HEVC que o WebView não renderiza — e aí o teto é AVC.
    private final boolean allowHevc;
    QualitySelector(){this(null);}
    QualitySelector(VerifiedMediaStore history){this(history,false);}
    QualitySelector(VerifiedMediaStore history,boolean allowHevc){this.history=history;this.allowHevc=allowHevc;}
    static long now() { return System.nanoTime()/1000000L; }

    Candidate choose(String key,List<Source> sources,Set<String> excluded,Probe probe,long budget) {
        return choose(key,sources,excluded,probe,budget,"",Collections.emptySet());
    }
    Candidate choose(String key,List<Source> sources,Set<String> excluded,Probe probe,long budget,String title,Set<String> allowed) {
        return choose(key,sources,excluded,probe,budget,title,allowed,null);
    }
    Candidate choose(String key,List<Source> sources,Set<String> excluded,Probe probe,long budget,String title,Set<String> allowed,Evidence evidence) {
        if(closed)return null;
        long deadline=now()+budget;
        List<Candidate> cached;
        synchronized(this){Entry<List<Candidate>> e=choices.get(key);cached=e!=null&&e.expires>now()?new ArrayList<>(e.value):null;}
        List<Candidate> found=Collections.synchronizedList(new ArrayList<>());
        List<Future<List<Candidate>>> futures=new ArrayList<>();
        boolean complete=false;
        boolean sourcesComplete=true;
        try {
            CompletionService<List<Candidate>> finished=new ExecutorCompletionService<>(workers);
            if(evidence!=null)futures.add(finished.submit(()->{try{evidence.load(deadline);}catch(Exception ignored){}return Collections.emptyList();}));
            if(history!=null)for(Candidate c:history.load(title,allowed))futures.add(finished.submit(()->{assess(c,excluded,probe,deadline,found);return Collections.emptyList();}));
            if(cached!=null)for(Candidate c:cached)futures.add(finished.submit(()->{assess(c,excluded,probe,deadline,found);return Collections.emptyList();}));
            else for(Source source:sources)futures.add(finished.submit(()->{List<Candidate> result=now()<deadline&&!Thread.currentThread().isInterrupted()?source.resolveAll(deadline):null;return result==null||result.isEmpty()?null:result;}));
            int pending=futures.size();
            while(pending>0){
                long left=deadline-now();if(left<=0)break;
                Future<List<Candidate>> done=finished.poll(left,TimeUnit.MILLISECONDS);if(done==null)break;
                pending--;
                List<Candidate> candidates;try{candidates=done.get();}catch(ExecutionException e){sourcesComplete=false;continue;}
                if(candidates==null){sourcesComplete=false;continue;}
                // Uma medição por lote de fornecedor. As demais opções voltam
                // ao fim da fila após a leitura atual; oito URLs lentas do mesmo
                // fornecedor não bloqueiam outra fonte que acabou de resolver.
                if(!candidates.isEmpty()){
                    Candidate c=candidates.get(0);
                    List<Candidate> remaining=new ArrayList<>(candidates.subList(1,candidates.size()));
                    futures.add(finished.submit(()->{assess(c,excluded,probe,deadline,found);return remaining;}));pending++;
                }
            }
            complete=pending==0;
        } catch(InterruptedException e){Thread.currentThread().interrupt();return null;}
        catch(RejectedExecutionException e){return null;}
        finally { for(Future<List<Candidate>> f:futures)if(!f.isDone())f.cancel(true); }
        List<Candidate> snapshot;
        synchronized(found){snapshot=new ArrayList<>(found);}
        if(evidence!=null)for(Candidate c:snapshot)c.measure=evidence.apply(title,c);
        // Estável nos empates: não deixa a ordem das respostas da rede decidir.
        Collections.sort(snapshot,(a,b)->(a.id+"\n"+a.url).compareTo(b.id+"\n"+b.url));
        Collections.sort(snapshot,QualitySelector::compare);
        if(history!=null)history.save(title,snapshot);
        if(snapshot.isEmpty())return null;
        boolean verified=complete&&sourcesComplete;long cacheFor=10*60*1000;
        for(Candidate c:snapshot){if(c.ephemeral||c.measure==null||c.measure.playable&&(c.measure.width<=0||c.measure.height<=0))verified=false;if(c.measure!=null&&!c.measure.playable)cacheFor=1500;}
        synchronized(this){if(!closed&&verified){trim(choices,64);choices.put(key,new Entry<>(snapshot,now()+cacheFor));}}
        for(Candidate c:snapshot)if(c.remembered||c.requiresProof?c.measure!=null&&c.measure.playable&&c.measure.language==2&&c.measure.width>0&&c.measure.height>0:c.measure==null||(c.measure.playable&&c.measure.language>=0))return c;
        return null;
    }
    private void assess(Candidate c,Set<String> excluded,Probe probe,long deadline,List<Candidate> found) {
        if(c==null||excluded.contains(c.id)||now()>=deadline||Thread.currentThread().isInterrupted())return;
        Candidate original=c;c=new Candidate(c.id,c.url,c.referer,c.type,c.json,c.declared);c.remembered=original.remembered;c.requiresProof=original.requiresProof;c.ephemeral=original.ephemeral;
        synchronized(found){for(Candidate other:found)if(other.key().equals(c.key()))return;found.add(c);}
        synchronized(this){Entry<Measure> e=measures.get(c.key());if(!c.ephemeral&&!c.remembered&&e!=null&&e.expires>now()){c.measure=e.value;return;}}
        try {
            Measure m;
            try{m=probe.read(c,Math.min(deadline,now()+6000));}catch(Exception first){m=null;}
            // Uma falha de metadados não deve esconder a versão superior.
            // Repete só a leitura inconclusiva, dentro do prazo total.
            if((m==null||m.playable&&(m.width<=0||m.height<=0))&&deadline-now()>500&&!Thread.currentThread().isInterrupted())m=probe.read(c,Math.min(deadline,now()+2500));
            if(m!=null){c.measure=m;synchronized(this){if(!closed&&!c.ephemeral){trim(measures,128);measures.put(c.key(),new Entry<>(m,now()+(!m.playable?1500:"hls".equals(c.type)?60000:600000)));}}}
        }catch(Exception ignored){ /* Sem prova, conserva a alternativa existente sem inventar resolução. */ }
    }
    synchronized void forget(String key){choices.remove(key);}
    // A capacidade é do aparelho, não do candidato: quem mede precisa dela.
    boolean podeHevc(){return allowHevc;}
    static double equivalent(int width,int height){return width>0&&height>0?Math.max(Math.min(width,height),Math.max(width,height)*9.0/16):Math.max(0,height);}
    static int compare(Candidate a,Candidate b){
        Measure x=a.measure,y=b.measure;
        int language=Integer.compare(y==null?1:y.playable?y.language:-2,x==null?1:x.playable?x.language:-2);
        if(language!=0)return language;
        boolean xm=x!=null&&x.width>0&&x.height>0,ym=y!=null&&y.width>0&&y.height>0;
        int proof=Boolean.compare(ym,xm);if(proof!=0)return proof;
        int quality=Double.compare(ym?equivalent(y.width,y.height):b.declared,xm?equivalent(x.width,x.height):a.declared);
        if(quality!=0)return quality;
        return Long.compare(y==null?0:y.bitrate,x==null?0:x.bitrate);
    }
    static Measure playlist(String text){return playlist(text,false);}
    static Measure playlist(String text,boolean allowHevc){
        if(text==null||!text.trim().startsWith("#EXTM3U"))return null;
        int w=0,h=0,aw=0,ah=0;long bitrate=0,avcRate=0;boolean pt=false,other=false;
        // Sem o filtro prévio: quem decide é a resolução de cada faixa, e o
        // teto AVC é aplicado no fim (antes o filtro descartava a lista inteira).
        for(String raw:text.split("\n")){
            String line=raw.trim();
            if(line.startsWith("#EXT-X-STREAM-INF:")){
                // Cuidado: o codec real vem completo (avc1.640028 / hvc1.1.6.L150).
                // A versão anterior exigia a aspa logo depois de avc1 e não casava
                // com nenhum manifesto de verdade — a lista voltava 0x0.
                boolean avc=Pattern.compile("(?i)CODECS=\"[^\"]*avc[13]").matcher(line).find();
                Matcher banda=Pattern.compile("(?:^|,)BANDWIDTH=(\\d+)").matcher(line.substring(line.indexOf(':')+1));
                long bw=banda.find()?Long.parseLong(banda.group(1)):0;
                Matcher m=Pattern.compile("RESOLUTION=(\\d{2,5})x(\\d{2,5})",Pattern.CASE_INSENSITIVE).matcher(line);
                if(m.find()){
                    int nw=Integer.parseInt(m.group(1)),nh=Integer.parseInt(m.group(2));
                    if(equivalent(nw,nh)>equivalent(w,h)){w=nw;h=nh;bitrate=bw;}
                    if(avc&&equivalent(nw,nh)>equivalent(aw,ah)){aw=nw;ah=nh;avcRate=bw;}
                }
            }
            if(line.startsWith("#EXT-X-MEDIA:")&&line.contains("TYPE=AUDIO")){
                Matcher m=Pattern.compile("LANGUAGE=\"([^\"]+)\"").matcher(line);
                if(m.find()){String lang=m.group(1);if(portuguese(lang))pt=true;else if(!lang.equals("und"))other=true;}
            }
        }
        if(!allowHevc&&aw>0){w=aw;h=ah;bitrate=avcRate;}
        return new Measure(w,h,pt?2:other?-1:1,bitrate,true);
    }
    static boolean portuguese(String value){return value!=null&&value.matches("(?i)(pt|por)([-_].*)?");}
    private static <T> void trim(Map<String,T> map,int limit){if(map.size()>=limit)map.remove(map.keySet().iterator().next());}
    @Override public synchronized void close(){closed=true;workers.shutdownNow();choices.clear();measures.clear();}
}

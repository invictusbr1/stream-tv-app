package br.streamtv.app;

import java.util.*;
import java.util.concurrent.*;
import java.util.regex.*;

/** Compara mídia do aparelho, sem abrir players externos e sem usar servidor. */
final class QualitySelector implements AutoCloseable {
    static final class Measure {
        final int width, height, language; // 2: português comprovado; 1: não informado; -1: outro idioma
        final long bitrate;
        final boolean playable,retryable;
        Measure(int width,int height,int language,long bitrate,boolean playable) {
            this(width,height,language,bitrate,playable,false);
        }
        Measure(int width,int height,int language,long bitrate,boolean playable,boolean retryable) {
            this.width=width;this.height=height;this.language=language;this.bitrate=bitrate;this.playable=playable;this.retryable=retryable;
        }
    }
    static final class Candidate {
        final String id,url,referer,type,json;
        final int declared;
        volatile Measure measure;
        volatile String deliveryUrl;
        volatile String secureDeliveryUrl;
        volatile String diagnosticReason="";
        boolean remembered;
        boolean requiresProof;
        boolean ephemeral;
        Candidate(String id,String url,String referer,String type,String json,int declared) {
            this.id=id;this.url=url;this.referer=referer==null?"":referer;this.type=type;this.json=json;this.declared=declared;
        }
        String key() { return type+"\n"+url+"\n"+referer; }
    }
    static final class Check {
        final String id;volatile String reason="na_fila";volatile int width,height,language=1;volatile long ms;
        Check(String id){this.id=id;}
        Check(Check c){id=c.id;reason=c.reason;width=c.width;height=c.height;language=c.language;ms=c.ms;}
    }
    private final Map<String,List<Check>> audits=new LinkedHashMap<>();
    synchronized List<Check> audit(String key){List<Check> rows=audits.get(key);List<Check> copy=new ArrayList<>();if(rows!=null)for(Check c:rows)copy.add(new Check(c));return copy;}
    private static Check check(Map<String,Check> rows,String id){synchronized(rows){Check c=rows.get(id);if(c==null){c=new Check(id);rows.put(id,c);}return c;}}
    static String problem(Exception e){
        if(e instanceof javax.net.ssl.SSLException)return "conexao_tls";
        if(e instanceof java.net.SocketTimeoutException)return "tempo_esgotado";
        if(e instanceof java.net.UnknownHostException)return "dns";
        if(e instanceof InterruptedException||Thread.currentThread().isInterrupted())return "cancelado";
        return e instanceof java.io.IOException?"leitura_falhou":"verificacao_falhou";
    }
    interface Source {
        Candidate resolve(long deadline) throws Exception;
        default String id(){return "";}
        default String problem(){return "";}
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
    private static final class Reserve { final List<Candidate> candidates;final List<Check> checks;Reserve(List<Candidate> c,List<Check> r){candidates=c;checks=r;} }
    private final Map<String,Entry<Reserve>> reserves=new LinkedHashMap<>();
    private final Map<String,Entry<Integer>> hints=new LinkedHashMap<>();
    static Source named(String id,Source source){return new Source(){
        public String id(){return id;}
        public String problem(){return source.problem();}
        public Candidate resolve(long deadline)throws Exception{return source.resolve(deadline);}
        public List<Candidate> resolveAll(long deadline)throws Exception{return source.resolveAll(deadline);}
    };}
    // As gavetas só aprovam dimensões medidas e áudio português. Rótulos e
    // memórias servem para decidir o que verificar primeiro, nunca para aprovar.
    static int tier(double height){return height>=4320*.98?6:height>=2160*.98?5:height>=1440*.98?4:height>=1080*.98?3:height>=720*.98?2:height>0?1:0;}
    static int drawer(Candidate c){Measure m=c.measure;return m!=null&&m.playable&&m.language==2&&m.width>0&&m.height>0?tier(equivalent(m.width,m.height)):0;}
    private static List<Candidate> ordered(List<Candidate> list){
        List<Candidate> result=new ArrayList<>(list);
        Collections.sort(result,(a,b)->Integer.compare(b.declared,a.declared));return result;
    }
    private static int hint(Map<String,Integer> values,String id){Integer value=values.get(id);return value==null?0:value;}
    private volatile boolean closed;
    private final VerifiedMediaStore history;
    // O aparelho declara se decodifica HEVC. Sem isso, a maior resolução da
    // lista pode ser um 4K HEVC que o WebView não renderiza — e aí o teto é AVC.
    private final boolean allowHevc;
    QualitySelector(){this(null);}
    QualitySelector(VerifiedMediaStore history){this(history,false);}
    QualitySelector(VerifiedMediaStore history,boolean allowHevc){this.history=history;this.allowHevc=allowHevc;}
    static long now() { return System.nanoTime()/1000000L; }

    private static Candidate copy(Candidate c){
        Candidate n=new Candidate(c.id,c.url,c.referer,c.type,c.json,c.declared);
        n.measure=c.measure;n.deliveryUrl=c.deliveryUrl;n.secureDeliveryUrl=c.secureDeliveryUrl;n.diagnosticReason=c.diagnosticReason;
        n.remembered=c.remembered;n.requiresProof=c.requiresProof;n.ephemeral=c.ephemeral;return n;
    }
    private static final class Pass {final List<Candidate> candidates=new ArrayList<>();final Map<String,List<Candidate>> discovered=new ConcurrentHashMap<>();}
    private static boolean reviewable(Check c){return c!=null&&Arrays.asList("prazo_consulta","prazo_midia","tempo_esgotado","conexao_tls","dns","leitura_falhou","verificacao_falhou","http_temporario","sem_metadados","idioma_sem_prova","cancelado").contains(c.reason);}
    /** Segunda rodada apenas para provas inconclusivas; reserva validada nunca é descartada. */
    Candidate chooseVerified(String key,List<Source> sources,Set<String> excluded,Probe probe,long firstBudget,long reviewBudget,String title,Set<String> allowed,Evidence evidence){
        long start=now();
        // Uma troca da mesma abertura usa a comparação recém-feita, com nova
        // leitura de mídia. Não repete consultas lentas a todos os fornecedores.
        if(!title.isEmpty()&&!excluded.isEmpty()){
            Entry<Reserve> saved;synchronized(this){saved=reserves.get(title);}
            if(saved!=null&&saved.expires>now()){
                List<Source> ready=new ArrayList<>();
                for(Candidate c:saved.value.candidates)if(!excluded.contains(c.id)&&(allowed.isEmpty()||allowed.contains(c.id))&&eligible(c)&&c.measure.width>0&&c.measure.height>0){
                    final Candidate reserve=copy(c);ready.add(named(c.id,end->reserve));
                }
                if(!ready.isEmpty())try(QualitySelector verification=new QualitySelector(null,allowHevc)){
                    Candidate next=verification.choose(key,ready,excluded,probe,Math.min(2000,firstBudget),title,allowed,evidence==null?null:new Evidence(){public void load(long end){}public Measure apply(String target,Candidate c){return evidence.apply(target,c);}});
                    if(next!=null&&!closed){
                        Map<String,Check> rows=new LinkedHashMap<>();for(Check c:saved.value.checks){Check row=new Check(c);if(excluded.contains(row.id))row.reason="falhou_reproducao";rows.put(row.id,row);}
                        for(Check row:verification.audit(key))rows.put(row.id,row);
                        synchronized(this){audits.put(key,new ArrayList<>(rows.values()));}
                        return next;
                    }
                }
            }
        }
        Pass first=new Pass();
        Candidate best=choose(key,sources,excluded,probe,firstBudget,title,allowed,evidence,first);
        if(closed||Thread.currentThread().isInterrupted())return best;
        if(reviewBudget<=0||best!=null&&drawer(best)>=5){rememberReserves(title,first.candidates,audit(key));return best;}
        Map<String,Check> checks=new LinkedHashMap<>();for(Check c:audit(key))checks.put(c.id,c);
        List<Source> retry=new ArrayList<>();
        for(Source source:sources){
            if(excluded.contains(source.id()))continue;
            List<Candidate> pending=new ArrayList<>();
            List<Candidate> discovered=first.discovered.get(source.id());
            // Dá oportunidade aos arquivos descobertos que ainda nem foram medidos.
            if(discovered!=null)for(Candidate c:discovered){boolean seen=false;for(Candidate done:first.candidates)if(c.key().equals(done.key())){seen=true;break;}if(!seen)pending.add(copy(c));}
            for(Candidate c:first.candidates)if(c.id.equals(source.id())&&(c.measure==null||c.measure.retryable||c.measure.playable&&(c.measure.width<=0||c.measure.height<=0||c.measure.language==1)))pending.add(copy(c));
            if(pending.isEmpty()&&!reviewable(checks.get(source.id())))continue;
            retry.add(pending.isEmpty()?source:named(source.id(),new Source(){
                public Candidate resolve(long end){return pending.get(0);}
                public List<Candidate> resolveAll(long end){return pending;}
            }));
        }
        if(retry.isEmpty()){rememberReserves(title,first.candidates,audit(key));return best;}
        forget(key);long offset=now()-start;
        // Vagas próprias: conexões da rodada vencida não bloqueiam a revisão.
        try(QualitySelector second=new QualitySelector(null,allowHevc)){
            Pass reviewed=new Pass();
            Candidate alternative=second.choose(key,retry,excluded,probe,reviewBudget,title,allowed,evidence==null?null:new Evidence(){public void load(long end){}public Measure apply(String target,Candidate c){return evidence.apply(target,c);}},reviewed);
            first.candidates.addAll(reviewed.candidates);
            if(alternative!=null&&(best==null||compare(alternative,best)<0))best=alternative;
            for(Check row:second.audit(key)){
                row.ms+=offset;Check old=checks.get(row.id);
                if(old==null||!old.reason.equals("validada")||row.reason.equals("validada")&&(row.language>old.language||row.language==old.language&&equivalent(row.width,row.height)>=equivalent(old.width,old.height)))checks.put(row.id,row);
            }
        }
        synchronized(this){audits.put(key,new ArrayList<>(checks.values()));}
        if(best!=null&&history!=null)history.save(title,Collections.singletonList(best));
        rememberReserves(title,first.candidates,audit(key));
        return best;
    }

    private static boolean eligible(Candidate c){
        Measure m=c.measure;
        return m!=null&&m.playable&&!m.retryable&&m.language>=0&&(!(c.remembered||c.requiresProof)||(m.language==2&&m.width>0&&m.height>0));
    }
    private synchronized void rememberReserves(String title,List<Candidate> candidates,List<Check> checks){
        if(closed||title.isEmpty())return;
        Map<String,Candidate> unique=new LinkedHashMap<>();
        for(Candidate c:candidates){Candidate old=unique.get(c.key());if(eligible(c)&&(old==null||compare(c,old)<0))unique.put(c.key(),copy(c));}
        if(unique.isEmpty())return;
        List<Candidate> sorted=new ArrayList<>(unique.values());Collections.sort(sorted,QualitySelector::compare);
        trim(reserves,32);reserves.put(title,new Entry<>(new Reserve(sorted,checks),now()+30000));
    }

    Candidate choose(String key,List<Source> sources,Set<String> excluded,Probe probe,long budget) {
        return choose(key,sources,excluded,probe,budget,"",Collections.emptySet());
    }
    Candidate choose(String key,List<Source> sources,Set<String> excluded,Probe probe,long budget,String title,Set<String> allowed) {
        return choose(key,sources,excluded,probe,budget,title,allowed,null);
    }
    Candidate choose(String key,List<Source> sources,Set<String> excluded,Probe probe,long budget,String title,Set<String> allowed,Evidence evidence) {
        return choose(key,sources,excluded,probe,budget,title,allowed,evidence,null);
    }
    private Candidate choose(String key,List<Source> sources,Set<String> excluded,Probe probe,long budget,String title,Set<String> allowed,Evidence evidence,Pass pass) {
        if(closed)return null;
        long begun=now(),deadline=begun+budget;Map<String,Check> trace=new LinkedHashMap<>();for(Source src:sources)if(!src.id().isEmpty())check(trace,src.id());
        List<Candidate> cached;
        synchronized(this){Entry<List<Candidate>> e=choices.get(key);cached=e!=null&&e.expires>now()?new ArrayList<>(e.value):null;}
        List<Candidate> remembered=history==null?Collections.emptyList():history.load(title,allowed);
        Map<String,Integer> preferred=new HashMap<>();
        synchronized(this){for(Source s:sources){Entry<Integer> e=hints.get(title+"\n"+s.id());if(e!=null&&e.expires>now())preferred.put(s.id(),e.value);}}
        for(Candidate c:remembered)preferred.put(c.id,Math.max(hint(preferred,c.id),tier(c.declared)));
        List<Source> scheduled=new ArrayList<>(sources);
        Collections.sort(scheduled,(a,b)->Integer.compare(hint(preferred,b.id()),hint(preferred,a.id())));
        List<Candidate> found=Collections.synchronizedList(new ArrayList<>());
        List<Future<List<Candidate>>> futures=new ArrayList<>();
        boolean complete=false;
        boolean sourcesComplete=true;
        try {
            CompletionService<List<Candidate>> finished=new ExecutorCompletionService<>(workers);
            if(evidence!=null)futures.add(finished.submit(()->{try{evidence.load(deadline);}catch(Exception ignored){}return Collections.emptyList();}));
            if(history!=null)for(Candidate c:remembered)futures.add(finished.submit(()->{assess(c,excluded,probe,deadline,found,trace,begun);return Collections.emptyList();}));
            if(cached!=null)for(Candidate c:cached)futures.add(finished.submit(()->{assess(c,excluded,probe,deadline,found,trace,begun);return Collections.emptyList();}));
            else for(Source source:scheduled)futures.add(finished.submit(()->{
                Check sourceCheck=check(trace,source.id());sourceCheck.reason="consulta";List<Candidate> result=null;
                try{if(now()<deadline&&!Thread.currentThread().isInterrupted())result=source.resolveAll(deadline);}catch(InterruptedException stopped){Thread.currentThread().interrupt();return null;}catch(Exception failure){sourceCheck.reason=problem(failure);}
                // Falha/retorno vazio recebe uma segunda consulta, sem ultrapassar
                // o prazo geral nem ocupar a vaga de outro fornecedor.
                if((result==null||result.isEmpty())&&deadline-now()>1500&&!Thread.currentThread().isInterrupted()){
                    long retryEnd=Math.min(deadline,now()+Math.min(2500,(deadline-now())/2));
                    try{result=source.resolveAll(retryEnd);}catch(InterruptedException stopped){Thread.currentThread().interrupt();return null;}catch(Exception failure){sourceCheck.reason=problem(failure);}
                }
                if(result==null||result.isEmpty()){sourceCheck.reason=source.problem().isEmpty()?(sourceCheck.reason.equals("consulta")?"sem_endereco":sourceCheck.reason):source.problem();sourceCheck.ms=now()-begun;return null;}
                result=ordered(result);
                if(pass!=null){List<Candidate> discovered=new ArrayList<>();for(Candidate c:result)discovered.add(copy(c));pass.discovered.put(source.id(),discovered);}
                // Conserva a vaga entre resolver e medir a primeira opção:
                // outras consultas lentas não empurram essa prova para o fim.
                assess(result.get(0),excluded,probe,deadline,found,trace,begun);
                return new ArrayList<>(result.subList(1,result.size()));
            }));
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
                    futures.add(finished.submit(()->{assess(c,excluded,probe,deadline,found,trace,begun);return remaining;}));pending++;
                }
            }
            complete=pending==0;
        } catch(InterruptedException e){Thread.currentThread().interrupt();return null;}
        catch(RejectedExecutionException e){return null;}
        finally { for(Future<List<Candidate>> f:futures)if(!f.isDone())f.cancel(true); }
        List<Candidate> snapshot;
        synchronized(found){snapshot=new ArrayList<>();for(Candidate c:found)snapshot.add(copy(c));}
        if(evidence!=null)for(Candidate c:snapshot)c.measure=evidence.apply(title,c);
        Map<String,Candidate> bestByProvider=new LinkedHashMap<>();
        for(Candidate c:snapshot)if(c.measure!=null){Candidate previous=bestByProvider.get(c.id);if(previous==null||compare(c,previous)<0)bestByProvider.put(c.id,c);}
        for(Candidate c:bestByProvider.values()){Check row=check(trace,c.id);Measure m=c.measure;row.width=m.width;row.height=m.height;row.language=m.language;row.reason=!m.playable?(!c.diagnosticReason.isEmpty()?c.diagnosticReason:m.retryable?"http_temporario":"midia_indisponivel"):m.width<=0||m.height<=0?"sem_metadados":m.language<0?"idioma_outro":(c.requiresProof||c.remembered)&&m.language!=2?"idioma_sem_prova":"validada";}
        List<Check> report=new ArrayList<>();synchronized(trace){for(Check sourceRow:trace.values()){if(sourceRow.id.isEmpty()||report.size()>=12)continue;Check row=new Check(sourceRow);if(row.reason.equals("consulta")||row.reason.equals("na_fila")||row.reason.equals("sonda")){row.reason=row.reason.equals("sonda")?"prazo_midia":"prazo_consulta";row.ms=now()-begun;}report.add(row);}}
        synchronized(this){trim(audits,32);audits.put(key,report);}
        if(pass!=null)pass.candidates.addAll(snapshot);
        // Estável nos empates: não deixa a ordem das respostas da rede decidir.
        Collections.sort(snapshot,(a,b)->(a.id+"\n"+a.url).compareTo(b.id+"\n"+b.url));
        Collections.sort(snapshot,QualitySelector::compare);
        if(history!=null)history.save(title,snapshot);
        Map<String,Integer> currentHints=new HashMap<>();
        for(Candidate c:snapshot)if(drawer(c)>0)currentHints.put(c.id,Math.max(hint(currentHints,c.id),drawer(c)));
        synchronized(this){for(Map.Entry<String,Integer> e:currentHints.entrySet()){trim(hints,192);hints.put(title+"\n"+e.getKey(),new Entry<>(e.getValue(),now()+600000));}}
        if(snapshot.isEmpty())return null;
        boolean verified=complete&&sourcesComplete;long cacheFor=drawer(snapshot.get(0))<5?1500:60000;
        for(Candidate c:snapshot){if(c.ephemeral||c.measure==null||c.measure.retryable||c.measure.playable&&(c.measure.width<=0||c.measure.height<=0))verified=false;if(c.measure!=null&&!c.measure.playable)cacheFor=1500;}
        synchronized(this){if(!closed&&verified){trim(choices,64);choices.put(key,new Entry<>(snapshot,now()+cacheFor));}}
        for(Candidate c:snapshot)if(eligible(c))return c;
        return null;
    }
    private void assess(Candidate c,Set<String> excluded,Probe probe,long deadline,List<Candidate> found,Map<String,Check> trace,long begun) {
        if(c==null||excluded.contains(c.id)||now()>=deadline||Thread.currentThread().isInterrupted())return;
        Check row=check(trace,c.id);row.reason="sonda";Candidate original=c;c=new Candidate(c.id,c.url,c.referer,c.type,c.json,c.declared);c.remembered=original.remembered;c.requiresProof=original.requiresProof;c.ephemeral=original.ephemeral;c.secureDeliveryUrl=original.secureDeliveryUrl;
        synchronized(found){for(Candidate other:found)if(other.key().equals(c.key()))return;found.add(c);}
        synchronized(this){Entry<Measure> e=measures.get(c.key());if(!c.ephemeral&&!c.remembered&&e!=null&&e.expires>now()){c.measure=e.value;return;}}
        try {
            Measure m;
            try{m=probe.read(c,Math.min(deadline,now()+6000));}catch(Exception first){if(c.diagnosticReason.isEmpty())c.diagnosticReason=problem(first);m=null;}
            // Uma falha de metadados não deve esconder a versão superior.
            // Repete só a leitura inconclusiva, dentro do prazo total.
            if((m==null||m.retryable||m.playable&&(m.width<=0||m.height<=0))&&deadline-now()>500&&!Thread.currentThread().isInterrupted())m=probe.read(c,Math.min(deadline,now()+2500));
            if(m!=null){c.measure=m;if(m.playable&&m.width>0&&m.height>0)c.diagnosticReason="";synchronized(this){if(!closed&&!c.ephemeral&&!m.retryable){trim(measures,128);measures.put(c.key(),new Entry<>(m,now()+(!m.playable||tier((int)equivalent(m.width,m.height))<5?1500:60000)));}}}
        }catch(Exception failure){if(c.diagnosticReason.isEmpty())c.diagnosticReason=problem(failure);}finally{row.ms=now()-begun;row.reason=!c.diagnosticReason.isEmpty()?c.diagnosticReason:c.measure==null?"sem_metadados":"medida";}
    }
    synchronized void forget(String key){choices.remove(key);}
    // A capacidade é do aparelho, não do candidato: quem mede precisa dela.
    boolean podeHevc(){return allowHevc;}
    static double equivalent(int width,int height){return width>0&&height>0?Math.max(Math.min(width,height),Math.max(width,height)*9.0/16):Math.max(0,height);}
    static int compare(Candidate a,Candidate b){
        Measure x=a.measure,y=b.measure;
        int language=Integer.compare(y==null?1:y.playable?y.language:-2,x==null?1:x.playable?x.language:-2);
        if(language!=0)return language;
        int drawer=Integer.compare(drawer(b),drawer(a));if(drawer!=0)return drawer;
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
    @Override public synchronized void close(){closed=true;workers.shutdownNow();choices.clear();measures.clear();hints.clear();audits.clear();reserves.clear();}
}

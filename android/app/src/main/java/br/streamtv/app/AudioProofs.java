package br.streamtv.app;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/** Prova de áudio vinculada ao arquivo, nunca apenas ao nome do fornecedor. */
final class AudioProofs {
    static final class Proof {
        final String hash,language;final long expires;
        Proof(String hash,String language,long expires){this.hash=hash;this.language=language;this.expires=expires;}
    }
    private final Map<String,List<Proof>> titles=new LinkedHashMap<>();
    static String identity(String title,QualitySelector.Candidate candidate){
        try{
            byte[] digest=MessageDigest.getInstance("SHA-256").digest((title+"\n"+candidate.id+"\n"+candidate.url+"\n"+candidate.referer).getBytes(StandardCharsets.UTF_8));
            StringBuilder hex=new StringBuilder();for(byte b:digest)hex.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return hex.toString();
        }catch(Exception e){return "";}
    }
    synchronized void replace(String title,List<Proof> proofs){
        if(titles.size()>=64&&!titles.containsKey(title))titles.remove(titles.keySet().iterator().next());
        titles.put(title,new ArrayList<>(proofs.subList(0,Math.min(128,proofs.size()))));
    }
    synchronized QualitySelector.Measure apply(String title,QualitySelector.Candidate candidate){
        QualitySelector.Measure m=candidate.measure;
        // Não ressuscita mídia incompatível nem altera áudio explicitamente estrangeiro.
        if(m==null||!m.playable||m.language!=1)return m;
        String hash=identity(title,candidate);long now=System.currentTimeMillis();
        List<Proof> list=titles.get(title);if(list==null)return m;
        for(Proof proof:list){
            if(proof.expires>now&&proof.expires<=now+7L*24*60*60*1000&&proof.hash.equals(hash)){
                if("pt".equals(proof.language))return new QualitySelector.Measure(m.width,m.height,2,m.bitrate,true);
                if("outro".equals(proof.language))return new QualitySelector.Measure(m.width,m.height,-1,m.bitrate,true);
            }
        }
        return m;
    }
}

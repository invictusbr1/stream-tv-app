package br.streamtv.app;

/** Recupera somente a entrega ClickHost que falhou no TLS intermediário. */
final class SecureDelivery {
    interface Lookup {String resolve(long deadline)throws Exception;}
    static QualitySelector.Measure read(QualitySelector.Candidate candidate,long deadline,QualitySelector.Probe probe,Lookup lookup)throws Exception{
        Exception original=null;
        if(candidate.secureDeliveryUrl!=null)return recovered(candidate,deadline,probe,candidate.secureDeliveryUrl);
        try{return probe.read(candidate,deadline);}catch(Exception failure){
            if(!(failure instanceof javax.net.ssl.SSLException)&&!"conexao_tls".equals(candidate.diagnosticReason))throw failure;
            candidate.diagnosticReason="conexao_tls";original=failure;
        }
        if(!"clickhost".equals(candidate.id)||!"file".equals(candidate.type)||deadline-QualitySelector.now()<700||Thread.currentThread().isInterrupted())throw original;
        try{
            String url=lookup.resolve(deadline);java.net.URL parsed=MediaHttp.safe(url);
            if(!parsed.getHost().matches("[a-z0-9-]+\\.[a-z0-9-]+\\.workers\\.dev"))throw original;
            candidate.secureDeliveryUrl=url;return recovered(candidate,deadline,probe,url);
        }catch(Exception failed){throw original;}
    }
    private static QualitySelector.Measure recovered(QualitySelector.Candidate candidate,long deadline,QualitySelector.Probe probe,String url)throws Exception{
        QualitySelector.Candidate delivery=new QualitySelector.Candidate(candidate.id,url,candidate.referer,candidate.type,candidate.json,0);
        QualitySelector.Measure measure=probe.read(delivery,deadline);
        if(measure!=null&&measure.playable&&measure.width>0&&measure.height>0){candidate.deliveryUrl=delivery.deliveryUrl==null?url:delivery.deliveryUrl;candidate.diagnosticReason="";}
        return measure;
    }
}

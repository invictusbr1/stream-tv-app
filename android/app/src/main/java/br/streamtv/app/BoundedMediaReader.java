package br.streamtv.app;

import java.io.IOException;

/** Leitura de metadados por faixas: não baixa o filme inteiro. */
final class BoundedMediaReader implements AutoCloseable {
    static final class Block {
        final int status;final long start,total;final byte[] bytes;final String mime;
        Block(int status,long start,long total,byte[] bytes,String mime){this.status=status;this.start=start;this.total=total;this.bytes=bytes;this.mime=mime==null?"":mime;}
    }
    interface Fetcher { Block read(long start,int count,long deadline) throws IOException; }
    private final Fetcher fetcher;private final long deadline;private long total=-1;private int used,requests;private boolean closed;
    BoundedMediaReader(Fetcher fetcher,long deadline){this.fetcher=fetcher;this.deadline=deadline;}
    private Block fetch(long position,int length)throws IOException{
        if(closed||Thread.currentThread().isInterrupted()||QualitySelector.now()>=deadline||++requests>40||used+length>2*1024*1024)throw new IOException("Fim do prazo ou limite da medição");
        Block b=fetcher.read(position,length,deadline);
        if(b==null||b.bytes==null||b.bytes.length>length||b.total<=0||b.start!=position||(b.status!=206&&!(b.status==200&&position==0))||b.mime.matches("(?is).*(text/html|application/json|text/xml).*"))throw new IOException("Resposta não corresponde à faixa de mídia");
        if(total>=0&&b.total!=total)throw new IOException("Arquivo mudou durante a medição");
        total=b.total;used+=b.bytes.length;return b;
    }
    synchronized long size()throws IOException{if(total<0)fetch(0,1);return total;}
    synchronized int readAt(long position,byte[] buffer,int offset,int count)throws IOException{
        if(position<0||offset<0||count<0||offset>buffer.length-count)throw new IOException("Faixa inválida");
        if(count==0)return 0;
        if(position>=size())return -1;
        int length=(int)Math.min(Math.min(count,65536),total-position);
        Block b=fetch(position,length);if(b.bytes.length==0)return -1;
        System.arraycopy(b.bytes,0,buffer,offset,b.bytes.length);return b.bytes.length;
    }
    @Override public synchronized void close(){closed=true;}
}

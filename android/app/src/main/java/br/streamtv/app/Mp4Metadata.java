package br.streamtv.app;

import java.io.IOException;
import java.nio.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Lê cabeçalhos MP4 e pula tabelas de amostras, que podem ter vários MiB. */
final class Mp4Metadata {
    static final class Track {
        String kind="",mime="",language="";int width,height,channels=2,sampleRate=48000;boolean enabled;
    }
    static final class Result {
        final List<Track> tracks=new ArrayList<>();int boxes;
        QualitySelector.Measure measure(){
            int width=0,height=0;boolean pt=false,other=false,first=true,defaultPt=false;
            for(Track t:tracks){
                if(t.kind.equals("vide")&&!t.mime.isEmpty()){width=t.width;height=t.height;}
                if(t.kind.equals("soun")){
                    if(QualitySelector.portuguese(t.language))pt=true;else if(!t.language.isEmpty()&&!t.language.equals("und"))other=true;
                    if(first){defaultPt=QualitySelector.portuguese(t.language)&&t.enabled;first=false;}
                }
            }
            return width>0&&height>0?new QualitySelector.Measure(width,height,defaultPt||pt&&!other?2:other&&!pt?-1:1,0,true):null;
        }
    }
    private final BoundedMediaReader reader;private final Result result=new Result();
    private Mp4Metadata(BoundedMediaReader r){reader=r;}
    static Result read(BoundedMediaReader reader)throws IOException {
        Mp4Metadata parser=new Mp4Metadata(reader);parser.walk(0,reader.size(),null,0);return parser.result;
    }
    private byte[] bytes(long p,int count)throws IOException {
        byte[] b=new byte[count];int done=0;
        while(done<count){int n=reader.readAt(p+done,b,done,count-done);if(n<=0)throw new IOException("Cabeçalho MP4 incompleto");done+=n;}
        return b;
    }
    private static long unsigned(byte[] b,int p){return ByteBuffer.wrap(b).order(ByteOrder.BIG_ENDIAN).getInt(p)&0xffffffffL;}
    private static int shortInt(byte[] b,int p){return ((b[p]&255)<<8)|(b[p+1]&255);}
    private static String name(byte[] b,int p){return new String(b,p,4,StandardCharsets.US_ASCII);}
    private void walk(long from,long end,Track track,int depth)throws IOException {
        if(depth>6)throw new IOException("Estrutura MP4 excessiva");
        for(long p=from;p+8<=end;){
            if(++result.boxes>256)throw new IOException("Limite de cabeçalhos MP4");
            byte[] head=bytes(p,8);long size=unsigned(head,0);String kind=name(head,4);int header=8;
            if(size==1){size=ByteBuffer.wrap(bytes(p+8,8)).getLong();header=16;}
            if(size==0)size=end-p;
            if(size<header||size>end-p)throw new IOException("Tamanho MP4 inválido");
            long data=p+header,limit=p+size;
            if(kind.equals("trak")){Track next=new Track();result.tracks.add(next);walk(data,limit,next,depth+1);}
            else if(kind.equals("moov")||kind.equals("mdia")||kind.equals("minf")||kind.equals("stbl")){walk(data,limit,track,depth+1);if(kind.equals("moov")&&depth==0)return;}
            else if(track!=null){
                if(kind.equals("tkhd")&&size>=header+84){byte[] flags=bytes(data,4);track.enabled=(flags[3]&1)!=0;byte[] dimensions=bytes(limit-8,8);track.width=(int)(unsigned(dimensions,0)>>>16);track.height=(int)(unsigned(dimensions,4)>>>16);}
                else if(kind.equals("hdlr")&&size>=header+12)track.kind=name(bytes(data+8,4),0);
                else if(kind.equals("mdhd")&&size>=header+24){int version=bytes(data,1)[0]&255;long at=data+(version==1?32:20);if(at+2<=limit){int lang=shortInt(bytes(at,2),0),a=(lang>>10)&31,b=(lang>>5)&31,c=lang&31;if(a>=1&&a<=26&&b>=1&&b<=26&&c>=1&&c<=26)track.language=""+(char)(a+96)+(char)(b+96)+(char)(c+96);}}
                else if(kind.equals("stsd")&&size>=header+16){
                    byte[] entry=bytes(data+8,8);long entrySize=unsigned(entry,0);String codec=name(entry,4);
                    if(entrySize<8||entrySize>limit-(data+8))throw new IOException("Descrição MP4 inválida");
                    track.mime=mime(codec);
                    if(track.mime.startsWith("video/")&&entrySize>=36){byte[] dimensions=bytes(data+8+32,4);track.width=shortInt(dimensions,0);track.height=shortInt(dimensions,2);}
                    if(track.mime.startsWith("audio/")&&entrySize>=36){byte[] audio=bytes(data+8+24,12);track.channels=shortInt(audio,0);track.sampleRate=(int)(unsigned(audio,8)>>>16);}
                    // stsd já descreve o codec. As próximas caixas de stbl são
                    // tabelas de cada quadro; seus cabeçalhos também são dispensáveis.
                    return;
                }
            }
            // Nenhuma leitura do conteúdo de mdat ou das tabelas stsz/stco/stts.
            p=limit;
        }
    }
    private static String mime(String codec){
        switch(codec){
        case "avc1":case "avc3":return "video/avc";
        case "hvc1":case "hev1":return "video/hevc";
        case "av01":return "video/av01";
        case "vp09":return "video/x-vnd.on2.vp9";
        case "mp4v":return "video/mp4v-es";
        case "mp4a":return "audio/mp4a-latm";
        case "ac-3":return "audio/ac3";
        case "ec-3":return "audio/eac3";
        case "Opus":return "audio/opus";
        case ".mp3":return "audio/mpeg";
        default:return "";
        }
    }
}

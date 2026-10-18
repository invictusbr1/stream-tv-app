package br.streamtv.app;
import java.util.regex.*;

/** Idioma por opção do addon; o rótulo geral da ficha não basta. */
final class AddonPolicy {
    static boolean dubbed(String label){
        return label!=null&&!Pattern.compile("(?i)\\b(cam|hdcam|ts|telesync)\\b").matcher(label).find()
            &&Pattern.compile("(?i)\\b(dublado|dual(?:[ -]?[áa]udio)?)\\b|🇧🇷").matcher(label).find()
            &&(!Pattern.compile("(?i)\\blegendado\\b").matcher(label).find()||Pattern.compile("(?i)\\bdual\\b").matcher(label).find());
    }
    static int height(String name){
        if(name==null)return 0;
        if(Pattern.compile("(?i)\\b(4k|uhd)\\b").matcher(name).find())return 2160;
        Matcher m=Pattern.compile("(?i)\\b(\\d{3,4})p\\b").matcher(name);
        if(m.find())return Integer.parseInt(m.group(1));
        if(Pattern.compile("(?i)\\bfull[ -]?hd\\b|\\bfhd\\b").matcher(name).find())return 1080;
        return Pattern.compile("(?i)\\bhd\\b").matcher(name).find()?720:0;
    }
}

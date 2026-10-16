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
        if(Pattern.compile("(?i)\\b(4k|uhd|2160p)\\b").matcher(name).find())return 2160;
        Matcher m=Pattern.compile("(?i)\\b(\\d{3,4})p\\b").matcher(name);return m.find()?Integer.parseInt(m.group(1)):0;
    }
}

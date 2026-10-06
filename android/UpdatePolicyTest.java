package br.streamtv.app;
public class UpdatePolicyTest {
 static int count=0;static void check(boolean value){count++;if(!value)throw new AssertionError("check "+count);}
 public static void main(String[] args){
 String url="https://github.com/"+UpdatePolicy.REPOSITORY+"/releases/download/v1.8.2/Stream-TV.apk",hash="a".repeat(64);
 check(UpdatePolicy.valid(182,181,2000,hash,url));
 check(!UpdatePolicy.valid(181,181,2000,hash,url));check(!UpdatePolicy.valid(180,181,2000,hash,url));
 check(!UpdatePolicy.valid(182,181,0,hash,url));check(!UpdatePolicy.valid(182,181,UpdatePolicy.MAX_BYTES+1,hash,url));
 check(!UpdatePolicy.valid(182,181,2000,"invalid",url));
 check(!UpdatePolicy.downloadUrl(url.replace("https:","http:"),false));
 check(!UpdatePolicy.downloadUrl(url.replace("github.com/","github.com.evil.test/"),false));
 check(!UpdatePolicy.downloadUrl(url.replace("github.com/","person@github.com/"),false));
 check(!UpdatePolicy.downloadUrl(url.replace("github.com/","github.com:444/"),false));
 check(!UpdatePolicy.downloadUrl(url.replace(UpdatePolicy.REPOSITORY,"someone/else"),false));
 check(!UpdatePolicy.downloadUrl("https://release-assets.githubusercontent.com/asset",false));
 check(UpdatePolicy.downloadUrl("https://release-assets.githubusercontent.com/asset?token=abc",true));
 check(!UpdatePolicy.downloadUrl("https://arbitrary.example/asset",true));
 check(!UpdatePolicy.downloadUrl(url+"#fragment",false));
 check(UpdatePolicy.sameSigners(new byte[][]{{1,2}},new byte[][]{{1,2}}));
 check(!UpdatePolicy.sameSigners(new byte[][]{{1,2}},new byte[][]{{1,3}}));
 check(!UpdatePolicy.sameSigners(null,new byte[][]{{1,2}}));
 check(!UpdatePolicy.sameSigners(new byte[][]{},new byte[][]{}));
 check(UpdatePolicy.hex(new byte[]{0,15,(byte)255}).equals("000fff"));
 System.out.println(count+" update policy checks passed");
 }
}

const {test}=require('node:test'),assert=require('node:assert/strict');
const {extract,resolve,PAGE}=require('./la18hd-source');
const a='https://media.fubo18.com/premiere1/mono.m3u8?token=one';
test('LA18HD renova o endereco em cada abertura e exige HLS de video',async()=>{
 let pageCalls=0;const get=async u=>u===PAGE?`var playbackURL = "${a.replace('one',String(++pageCalls))}";`:'#EXTM3U\n#EXTINF:6,\nsegment.ts';
 assert.notEqual((await resolve(get)).url,(await resolve(get)).url);assert.equal(pageCalls,2);
 await assert.rejects(resolve(async u=>u===PAGE?`var playbackURL="${a}";`:'<html>offline</html>'));
 await assert.rejects(resolve(async u=>u===PAGE?`var playbackURL="${a}";`:'#EXTM3U\n#EXT-X-ENDLIST'));
});
test('LA18HD recusa destino arbitrario, credenciais, portas e outros canais',()=>{
 for(const u of ['http://media.fubo18.com/premiere1/mono.m3u8','https://127.0.0.1/premiere1/mono.m3u8','https://fubo18.com.evil.test/premiere1/mono.m3u8','https://user:pass@media.fubo18.com/premiere1/mono.m3u8','https://media.fubo18.com:444/premiere1/mono.m3u8','https://media.fubo18.com/other/mono.m3u8'])assert.throws(()=>extract(`var playbackURL="${u}";`));
 assert.throws(()=>extract('<script>location.href="https://example.com"</script>'));
});

const {test}=require('node:test'),assert=require('node:assert/strict');
const h=require('./crystal-lake-hd'),c=require('./crystal-lake-source');
const master='#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="Portuguese",LANGUAGE="portuguese",DEFAULT=YES,URI="https://audio.s1q2105.com/audio/pt.m3u8"\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="English",LANGUAGE="english",DEFAULT=NO,URI="https://audio.s1q2105.com/audio/en.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,AUDIO="a"\nhttps://video.97bf1.com/hd.m3u8\n';
test('Crystal Lake HD mantém português e recusa publicidade, idioma ausente e destinos externos',()=>{
 assert.ok(h.master(master));assert.doesNotMatch(h.master(master),/English|en\.m3u8/);
 assert.match(h.master(master.replace('https://video.97bf1.com/hd.m3u8','hd.m3u8'),'https://video.97bf1.com/master.m3u8'),/https:\/\/video\.97bf1\.com\/hd.m3u8/);
 for(const bad of [master+'#EXT-X-CUE-OUT:30',master.replace('LANGUAGE="portuguese"','LANGUAGE="english"'),master.replace('https://video.97bf1.com','https://evil.test'),master.replace('1280x720','842x480')])assert.equal(h.master(bad),null);
 for(const u of ['http://video.97bf1.com/a','https://97bf1.com.evil.test/a','https://user@97bf1.com/a','https://localhost/a'])assert.equal(h.segura(u),false);
 const media='#EXTM3U\n#EXTINF:8,\npart.woff2\n#EXT-X-ENDLIST';
 assert.equal(h.limpa(media,'https://video.97bf1.com/hd.m3u8'),true);
 assert.equal(h.limpa(media+'\n#EXT-X-DATERANGE:CLASS="ad"','https://video.97bf1.com/hd.m3u8'),false);
 assert.equal(h.limpa(media.replace('part.woff2','https://evil.test/p.ts'),'https://video.97bf1.com/hd.m3u8'),false);
});
test('Crystal Lake usa HD aprovado mesmo se a reserva falhar e renova na próxima abertura',async()=>{
 let calls=0;
 const source=c.criar({get:async()=>{throw Error('reserva fora');},hd:async()=>{calls++;return {url:'https://video.97bf1.com/hd.m3u8',playlist:h.master(master),largura:calls===1?1280:1920,altura:calls===1?720:1080,resolucao:calls===1?'720p':'1080p',until:Date.now()+300000,referer:'https://mgeb.top/'};}});
 const target={tipo:'tv',tmdbId:'213562',temporada:'1',episodio:'1'};
 assert.equal((await source.resolver(target)).resolucao,'720p');
 assert.match(await source.playlist('1'),/\/api\/hls\?/);assert.equal(calls,1);
 assert.equal((await source.resolver(target)).resolucao,'1080p');
 assert.equal(await source.resolver({...target,tmdbId:'1'}),null);
});

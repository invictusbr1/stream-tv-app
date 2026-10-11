const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('./mininovelas-source');
const html = p => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: p } })}</script>`;
test('páginas de mininovelas não permitem proxy arbitrário, credenciais ou consultas', () => {
    assert.ok(s.paginaPermitida('https://www.reelshort.com/pt'));
    for (const url of ['http://www.reelshort.com/pt','https://www.reelshort.com.evil.test/pt','https://user@www.reelshort.com/pt','https://www.reelshort.com:444/pt','https://www.reelshort.com/pt?url=http://localhost','https://127.0.0.1/pt','https://www.reelshort.com/episodes/%2e%2e']) assert.equal(s.paginaPermitida(url),false,url);
});
test('DramaBox só expõe mídia quando episódio é explicitamente gratuito e liberado', () => {
    const media = 'https://hwvideoseo.dramaboxdb.com/free.mp4';
    const eps = s.episodios('dramabox', html({ chapterList: [
        { index: 0, unlock: true, chapterPrice: 0, mp4: media },
        { index: 1, unlock: false, chapterPrice: 0, mp4: media },
        { index: 2, unlock: true, chapterPrice: 10, mp4: media },
        { index: 3, unlock: true, mp4: media },
        { index: 4, unlock: true, chapterPrice: 0, mp4: 'https://localhost/a.mp4' }
    ] }));
    assert.deepEqual(eps.map(e => e.disponivel), [true,false,false,false,false]);
    assert.ok(eps.slice(1).every(e => e.url === null));
});
test('ReelShort respeita início pago e proibição de reprodução web', () => {
    const data = { serial_number: 1, paid_start: 9, video_url: 'https://v-mps.crazymaplestudios.com/first.mp4', lang:'pt' };
    assert.ok(s.episodios('reelshort',html({data,web_prohibit:0}))[0].disponivel);
    assert.equal(s.episodios('reelshort',html({data:{...data,serial_number:9},web_prohibit:0}))[0].url,null);
    assert.equal(s.episodios('reelshort',html({data,web_prohibit:1}))[0].url,null);
    assert.equal(s.episodios('reelshort',html({data:{...data,paid_start:undefined},web_prohibit:0}))[0].url,null);
});
test('catálogo usa links publicados, mantém identidade por fornecedor e remove duplicatas', () => {
    const item = {bookId:'123',bookName:'Novela'};
    const pagina = '/pt/movie/123/novela';
    const items = s.catalogo('dramabox',html({bigList:[item,item]})+`<a href="${pagina}">Ver</a>`);
    assert.equal(items.length,1); assert.equal(items[0].id,'dramabox:123');
    assert.equal(s.catalogo('dramabox',html({bigList:[item]})).length,0);
});
test('NetShort lê apenas JSON público e não libera episódio com preço ou bloqueio ambíguo', () => {
    const info = { episodeId:'123', episodeNo:1, isLock:false, episodeGoldCoinPrice:50, playVoucher:'https://cfcdn.netshort.com/video?mime_type=video_mp4' };
    const dados = { initialCurrentEpisodeInfo:info, book:{isDelisted:false,language:'pt_BR',videoEpisodeInfos:[{episodeId:'123',isLock:false}]} };
    const pagina = `<script>self.__next_f.push(${JSON.stringify([1,'a:'+JSON.stringify(dados)+'\n'])})</script>`;
    assert.equal(s.episodios('netshort',pagina)[0].url,null);
    assert.throws(() => s.dadosNetShort('<script>self.__next_f.push(executar())</script>'));
    assert.equal(s.fornecedores.find(f => f.id === 'netshort').conector,false);
});
const page=p=>`<script id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:p}})}</script>`;
test('ReelShort identifica indice paginado do mesmo livro e conserva limite gratuito',()=>{
 const p='https://www.reelshort.com/pt/episodes/episode-2-novela-book-chapter';const info=s.indiceReelShort(p,page({data:{book_id:'book',chapter_id:'chapter',paid_start:4,chapter_count:12}}));assert.equal(info.pagina,'https://www.reelshort.com/pt/full-episodes/novela-book');assert.equal(info.limite,4);
 const next='https://www.reelshort.com/pt/full-episodes/novela-book/2';assert.equal(s.indiceReelShort(info.pagina,page({data:{book_id:'book',chapter_list:[],chapter_count:12},nextPageLink:next})).proxima,next);
 assert.equal(s.paginaPermitida(next+'/extra'),false);assert.equal(s.paginaPermitida(next+'?url=http://localhost'),false);
});
test('lista ReelShort usa links publicados, ignora trailer e nao libera capitulos pagos ou sem confirmacao',()=>{
 const chapters=[{serial_number:0,chapter_id:'trailer'},{serial_number:1,chapter_id:'c1'},{serial_number:2,chapter_id:'c2'},{serial_number:3,chapter_id:'c3'}];
 const h=page({web_prohibit:0,data:{book_id:'book',chapter_list:chapters,lang:'pt'}})+chapters.map(c=>`<a href="/pt/episodes/episode-${c.serial_number}-novela-book-${c.chapter_id}">Ep</a>`).join('');
 const eps=s.episodios('reelshort',h,{limite:3});assert.deepEqual(eps.map(e=>e.numero),[1,2,3]);assert.deepEqual(eps.map(e=>e.disponivel),[true,true,false]);assert(eps.every(e=>e.url===null));assert(s.episodios('reelshort',h).every(e=>!e.disponivel));
});

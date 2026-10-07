(function (root) {
    'use strict';
    function createCatalog(fetcher, key) {
        const cache = new Map();
        const oscar = [238, 240, 424, 13, 122, 497, 680, 389, 11216, 244786, 129, 857, 313369];
        async function tmdb(path, params = {}, signal) {
            const query = new URLSearchParams({ api_key: key, language: 'pt-BR', ...params });
            const url = `https://api.themoviedb.org/3/${path}?${query}`;
            if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
            const saved = cache.get(url);
            if (saved && saved.until > Date.now()) return saved.value;
            const response = await fetcher(url, { signal });
            if (!response.ok) throw new Error('Catálogo indisponível');
            const value = await response.json();
            cache.set(url, { value, until: Date.now() + 600000 });
            if (cache.size > 100) cache.delete(cache.keys().next().value);
            return value;
        }
        function movie(f) {
            // Nomes de gênero em português, usados no destaque da tela inicial.
            const GENEROS = {28:'Ação',12:'Aventura',16:'Animação',35:'Comédia',80:'Crime',99:'Documentário',18:'Drama',10751:'Família',14:'Fantasia',36:'História',27:'Terror',10402:'Música',9648:'Mistério',10749:'Romance',878:'Ficção científica',10770:'Cinema TV',53:'Suspense',10752:'Guerra',37:'Faroeste',10759:'Ação e aventura',10762:'Infantil',10763:'Notícias',10764:'Reality show',10765:'Ficção científica e fantasia',10766:'Novela',10767:'Talk show',10768:'Guerra e política'};
            const generos = (f.genre_ids || []).map(id => GENEROS[id]).filter(Boolean).slice(0, 3);
            return { id: f.id, tipo: f.media_type==='tv'||(!f.title&&f.name)?'tv':'movie', titulo: f.title || f.name || 'Sem título', sinopse: f.overview || '',
                nota: f.vote_average ? Number(f.vote_average).toFixed(1) : 'N/A',
                ano: (f.release_date || f.first_air_date || '').slice(0, 4),
                capa: f.poster_path ? `https://image.tmdb.org/t/p/w500${f.poster_path}` : '',
                fundo: f.backdrop_path ? `https://image.tmdb.org/t/p/w1280${f.backdrop_path}` : '',
                generos };
        }
        async function discover(params, signal) {
            return ((await tmdb('discover/movie', { include_adult: 'false', page: '1', ...params }, signal)).results || []).map(movie);
        }
        function extras(id, imdb, tv=false, season, episode) {
            const local=index=>tv?`/assistir.html?type=tv&id=${id}&season=${season}&episode=${episode}&source=${index}`:`/assistir.html?id=${id}&source=${index}`;
            const base=(nome,index,fields)=>({nome,index,dub:false,optional:true,manual:true,funcionou:true,status:'nao-testada',urlCompatibilidade:local(index),...fields});
            const list=[base('Doramogo · buscar título',tv?4:9,{directory:'doramogo'}),base('PobreFlix / YouCine · buscar título',tv?5:10,{directory:'pobreflix'})];
            if(tv||imdb)list.unshift(base('SuperFlix · com anúncios',tv?3:8,{url:tv?`https://superflixapi.monster/serie/${id}/${season}/${episode}`:`https://superflixapi.monster/filme/${imdb}`,status:'verificacao-no-navegador'}));
            return list;
        }
        async function directoryUrl(source, id, tv, signal, season, episode) {
            const d=await tmdb(`${tv?'tv':'movie'}/${id}`,{},signal);
            const title=tv?d.name:d.title;if(!title)throw Error('Título indisponível');
            if(source.directory==='doramogo')return 'https://www.doramogo.net/search/?q='+encodeURIComponent(title);
            if(source.directory==='pobreflix')return 'https://youcinehd.lat/pesquisar?s='+encodeURIComponent(title);
            if(source.directory==='dattebayo')return 'https://www.dattebayo-br.com/anime-dublado';
            if(source.directory==='plenoflu')return `https://plenoflu.com/${tv?'tvshow':'movie'}/${id}${tv?'/'+season+'/'+episode:''}`;
            throw Error('Fonte inválida');
        }
        async function sources(id, signal) {
            if (!/^\d{1,10}$/.test(String(id))) throw new Error('Filme inválido');
            let imdb = null;
            try { imdb = (await tmdb(`movie/${id}/external_ids`, {}, signal)).imdb_id; }
            catch (error) { if (signal && signal.aborted) throw error; }
            if (!/^tt\d+$/.test(imdb || '')) imdb = null;
            const entries = [
                ['WatchCDN (indisponível)', `https://embed.watchcdn.org/filme/${imdb}`, false, false],
                ['CdnEmbed (indisponível)', `https://cdn-embed.com/filme/${id}`, false, false],
                ['UltraEmbed (indisponível)', `https://ultraembed.com/filme/${imdb}`, false, false],
                ['VidSrc.me', `https://vidsrc.me/embed/movie?tmdb=${id}`, false, true],
                ['AutoEmbed', `https://autoembed.co/movie/tmdb/${id}`, false, true],
                ['MoviesAPI', `https://moviesapi.club/movie/${id}`, false, true],
                ['VidSrc.in', `https://vidsrc.in/embed/movie?tmdb=${id}`, false, true]
            ];
            const players = entries.map(([nome, url, dub, available], index) => ({
                nome, url, dub, funcionou: available, manual: index===1, status: 'nao-testada',
                motivo: available ? null : 'Fonte indisponível na última verificação.',
                urlCompatibilidade: available ? `/assistir.html?id=${id}&source=${index}` : null, index
            }));
            // Preserve source indices so previously saved compatibility links remain valid.
            return [players[1], players[0], players[2], {nome:'VidLink (Full HD)',url:`https://vidlink.pro/movie/${id}`,dub:false,optional:true,funcionou:true,status:'audio-nao-confirmado',qualidade:'1080p (HEVC)',urlCompatibilidade:`/assistir.html?id=${id}&source=6`,manual:true,index:6}, {nome:'PipocaCine',url:`https://pipocacine.lat/embed/${id}`,dub:false,optional:true,funcionou:true,status:'audio-nao-confirmado',qualidade:'720p · PT e EN',urlCompatibilidade:`/assistir.html?id=${id}&source=7`,manual:true,index:7},...extras(id,imdb)];
        }
        async function request(input, signal) {
            const url = new URL(input, 'https://appassets.androidplatform.net');
            const type=url.searchParams.get('tipo')||'movie';
            const kind=['tv','dorama','short-drama','anime'].includes(type)?'tv':'movie';
            const isDorama=type==='dorama'||type==='short-drama',isShort=type==='short-drama',isAnime=type==='anime'||type==='anime-film';
            const asian=['KR','JP','CN','TW','TH'];
            const belongs=x=>{const genres=x.genre_ids||[];return isAnime?genres.includes(16)&&(x.origin_country||[]).includes('JP'):isDorama?(x.origin_country||[]).some(c=>asian.includes(c))&&genres.includes(18)&&!genres.some(g=>[16,99,10764,10763,10767].includes(g)):true;};
            if(url.pathname==='/api/genres'){const pt={10759:'Ação e aventura',10762:'Infantil',10763:'Notícias',10765:'Ficção científica e fantasia',10766:'Novelas',10767:'Entrevistas',10768:'Guerra e política'};return ((await tmdb(`genre/${kind}/list`,{},signal)).genres||[]).filter(g=>!isAnime||[28,12,10759,35,18,878,14,10765,9648,10762].includes(g.id)).filter(g=>!isDorama||![16,99,10764,10763,10767].includes(g.id)).map(g=>({...g,name:pt[g.id]||g.name}));}
            if(url.pathname==='/api/explore'){
                const page=Number(url.searchParams.get('page')||1),genre=url.searchParams.get('genre')||'';
                if(!Number.isInteger(page)||page<1||page>500||!/^\d*$/.test(genre))throw Error('Filtro inválido');
                const params={include_adult:'false',sort_by:'popularity.desc',page:String(page)};
                if(genre)params.with_genres=genre;else if(kind==='tv')params.with_type='2|4';
                // "Filmes e séries" juntos: uma lista só, misturando os dois,
                // ordenada pela popularidade do momento.
                if(type==='video'&&!isDorama&&!isAnime){
                    const [filmes,series]=await Promise.all([
                        tmdb('discover/movie',{...params},signal),
                        tmdb('discover/tv',{...params,with_type:'2|4'},signal)
                    ]);
                    const juntos=[...(filmes.results||[]).map(x=>({...x,media_type:'movie'})),...(series.results||[]).map(x=>({...x,media_type:'tv'}))]
                        .filter(x=>!x.media_type||['movie','tv'].includes(x.media_type))
                        .sort((a,b)=>(b.popularity||0)-(a.popularity||0));
                    return {items:juntos.map(movie),page,pages:Math.min(Math.max(filmes.total_pages||1,series.total_pages||1),500)};
                }
                if(isDorama){params.with_origin_country='KR|JP|CN|TW|TH';params.with_genres=[...new Set([genre,'18'].filter(Boolean))].join(',');params.without_genres='16,99,10764,10763,10767';params.with_type='2|4';params[isShort?'with_runtime.lte':'with_runtime.gte']=isShort?'20':'21';if(isShort)params['with_runtime.gte']='1';}
                if(isAnime){params.with_origin_country='JP';params.with_genres=[...new Set([genre,'16'].filter(Boolean))].join(',');}
                const q=(url.searchParams.get('nome')||'').trim();
                let data;
                if(q){data=await tmdb(`search/${url.searchParams.get('tipo')==='all'?'multi':kind}`,{query:q,include_adult:'false',page:String(page)},signal);if(isDorama||isAnime){
                    let results=(data.results||[]).filter(x=>type==='anime-film'?(x.genre_ids||[]).includes(16):belongs(x));
                    if(isDorama||type==='anime-film')results=(await Promise.all(results.map(async x=>{try{const d=await tmdb(`${kind}/${x.id}`,{},signal);if(type==='anime-film')return (d.production_countries||[]).some(c=>c.iso_3166_1==='JP')?x:null;const runtimes=[...(d.episode_run_time||[]),d.last_episode_to_air?.runtime].filter(n=>n>0);if(!runtimes.length)return null;const short=Math.max(...runtimes)<=20;return short===isShort?x:null;}catch{return null;}}))).filter(Boolean);
                    data.results=results;
                }}
                else data=await tmdb(`discover/${kind}`,params,signal);
                return {items:(data.results||[]).filter(x=>!x.media_type||['movie','tv'].includes(x.media_type)).map(x=>movie({...x,media_type:x.media_type||kind})),page:data.page||page,pages:Math.min(data.total_pages||1,500)};
            }
            if(url.pathname==='/api/top-br'){
                const d=await tmdb('discover/movie',{watch_region:'BR',with_watch_monetization_types:'flatrate|free|ads',sort_by:'popularity.desc',include_adult:'false','vote_count.gte':'50'},signal);
                return {items:(d.results||[]).slice(0,10).map(movie),checkedAt:new Date().toISOString()};
            }
            // Top 10 "em alta" do dia, com o nome dos streamings que têm o
            // título no Brasil. A lista muda todo dia e o aplicativo guarda o
            // resultado do dia para não repetir consultas.
            if(url.pathname==='/api/alta'){
                const tipoAlta=url.searchParams.get('tipo')==='tv'?'tv':'movie';
                const d=await tmdb(`trending/${tipoAlta}/day`,{},signal);
                const lista=(d.results||[]).filter(x=>!x.media_type||x.media_type!=='person').slice(0,10);
                // Uma consulta por título (arte + onde assistir juntas). Antes eram
                // duas por título, o que estourava o limite do TMDB e derrubava a
                // lista inteira quando uma delas falhava.
                const comStreamings=await Promise.all(lista.map(async x=>{
                    const base=movie({...x,media_type:tipoAlta});
                    let logo='';
                    let streamings=[];
                    try{
                        const extra=await tmdb(`${tipoAlta}/${x.id}`,{language:'pt-BR',append_to_response:'watch/providers,images',include_image_language:'pt,en,null'},signal);
                        const logos=((extra.images&&extra.images.logos)||[]).slice().sort((a,b)=>(b.vote_average||0)-(a.vote_average||0));
                        const escolhido=logos.find(l=>l.iso_639_1==='pt')||logos.find(l=>l.iso_639_1==='en')||logos[0];
                        if(escolhido&&escolhido.file_path)logo=`https://image.tmdb.org/t/p/w500${escolhido.file_path}`;
                        const br=((extra['watch/providers']||{}).results||{}).BR||{};
                        const nomes=[...(br.flatrate||[]),...(br.free||[]),...(br.ads||[])].map(v=>v.provider_name).filter(Boolean);
                        streamings=[...new Set(nomes)].slice(0,3);
                    }catch{ /* segue sem arte/streaming, mas o título continua na lista */ }
                    return {...base,logo,streamings};
                }));
                return {tipo:tipoAlta,items:comStreamings,checkedAt:new Date().toISOString()};
            }
            let series=url.pathname.match(/^\/api\/tv\/(\d{1,10})$/);
            if(series){const d=await tmdb(`tv/${series[1]}`,{},signal);return {title:d.name,overview:d.overview,seasons:(d.seasons||[]).filter(x=>x.episode_count>0).map(x=>({number:x.season_number,name:x.name,count:x.episode_count}))};}
            let season=url.pathname.match(/^\/api\/season\/(\d{1,10})\/(\d{1,3})$/);
            if(season){const d=await tmdb(`tv/${season[1]}/season/${season[2]}`,{},signal);return {episodes:(d.episodes||[]).map(x=>({number:x.episode_number,name:x.name,overview:x.overview,date:x.air_date,image:x.still_path?`https://image.tmdb.org/t/p/w300${x.still_path}`:null}))};}
            let ep=url.pathname.match(/^\/api\/episode\/(\d{1,10})\/(\d{1,3})\/([1-9]\d{0,3})$/);
            if(ep){const [_,id,season,episode]=ep;return {players:[
                // Lista refeita em 07/10/2026 depois de uma varredura nova.
                // Regra: o player limpo (sem anúncio) toca sozinho; estas opções
                // são dubladas e só entram depois, dentro do próprio aplicativo,
                // porque a própria fonte pede uma verificação de segurança.
                {nome:'Dublado · StreamBetter',url:`https://streambetter.shop/serie/${id}/${season}/${episode}`,dub:true,optional:true,funcionou:true,status:'verificacao-no-navegador',manual:true,preferida:true,index:0,urlCompatibilidade:`/assistir.html?type=tv&id=${id}&season=${season}&episode=${episode}&source=0`},
                {nome:'Dublado · SuperFlix',url:`https://superflixapi.monster/serie/${id}/${season}/${episode}`,dub:true,optional:true,funcionou:true,status:'verificacao-no-navegador',manual:true,index:1,urlCompatibilidade:`/assistir.html?type=tv&id=${id}&season=${season}&episode=${episode}&source=1`},
                {nome:'Doramas e novelas dubladas · buscar no site',url:'https://youcinehd.lat/',dub:false,optional:true,funcionou:true,status:'escolha-o-episodio',manual:true,directory:'pobreflix',index:2,urlCompatibilidade:`/assistir.html?type=tv&id=${id}&season=${season}&episode=${episode}&source=2`}
            ]};}
            if (url.pathname === '/api/buscar') {
                const q = (url.searchParams.get('nome') || '').trim();
                if (!q) return [];
                return ((await tmdb('search/movie', { query: q, include_adult: 'false' }, signal)).results || []).map(movie);
            }
            const match = url.pathname.match(/^\/api\/player\/(\d{1,10})$/);
            if (match) return { players: await sources(match[1], signal) };
            if (url.pathname !== '/api/rankings') throw new Error('Rota inválida');
            const selectionPage=Number(url.searchParams.get('page')||1);if(!Number.isInteger(selectionPage)||selectionPage<1||selectionPage>10)throw Error('Página inválida');
            const [relevantes, melhores, recentes, awards] = await Promise.all([
                discover({ page:String(selectionPage), sort_by: 'popularity.desc', 'vote_count.gte': '80', 'vote_average.gte': '6' }, signal),
                discover({ page:String(selectionPage), sort_by: 'vote_average.desc', 'vote_count.gte': '500', 'vote_average.gte': '7' }, signal),
                discover({ page:String(selectionPage), sort_by: 'primary_release_date.desc', 'vote_count.gte': '40', 'vote_average.gte': '6', 'primary_release_date.lte': new Date().toISOString().slice(0, 10) }, signal),
                Promise.all(oscar.map(id => tmdb(`movie/${id}`, {}, signal).then(movie).catch(() => null)))
            ]);
            if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
            return { relevantes, melhores, recentes, oscar: awards.filter(Boolean).sort((a, b) => (parseFloat(b.nota) || 0) - (parseFloat(a.nota) || 0)) };
        }
        return { request, sources, directoryUrl, describe:async(id,tv,signal)=>movie({...await tmdb(`${tv?'tv':'movie'}/${id}`,{},signal),media_type:tv?'tv':'movie'}) };
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = { createCatalog };
    else root.createCatalog = createCatalog;
})(globalThis);

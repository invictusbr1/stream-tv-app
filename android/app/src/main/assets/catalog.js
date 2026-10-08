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
        async function sources(id, signal) {
            if (!/^\d{1,10}$/.test(String(id))) throw new Error('Filme inválido');
            let imdb = null;
            try { imdb = (await tmdb(`movie/${id}/external_ids`, {}, signal)).imdb_id; }
            catch (error) { if (signal && signal.aborted) throw error; }
            if (!/^tt\d+$/.test(imdb || '')) imdb = null;
            // Sem fontes com anúncio. Só entra o que atende as três regras do
            // aplicativo: dublado, sem anúncio e em HD — e isso quem resolve é o
            // motor de fontes, que entrega o endereço direto para o player.
            // VidLink, PipocaCine (página), SuperFlix, Doramogo e YouCine saíram
            // em 07/10/2026: pediam verificação no navegador e exibiam anúncio.
            return [];
        }
        // ---- TV ao vivo no aparelho (mesmas listas públicas do servidor) ----
        const LISTAS_TV = [
            { id: 'brasil', nome: 'Canais do Brasil', url: 'https://iptv-org.github.io/iptv/countries/br.m3u', nota: 9.0 },
            { id: 'portugues', nome: 'Canais em português', url: 'https://iptv-org.github.io/iptv/languages/por.m3u', nota: 8.5 },
            { id: 'esportes', nome: 'Esportes', url: 'https://iptv-org.github.io/iptv/categories/sports.m3u', nota: 9.8 },
            { id: 'noticias', nome: 'Notícias', url: 'https://iptv-org.github.io/iptv/categories/news.m3u', nota: 10 },
            { id: 'latam', nome: 'América Latina', url: 'https://iptv-org.github.io/iptv/regions/latam.m3u', nota: 9.5 }
        ];
        const canaisTvCache = new Map();
        async function canaisTv(idLista, signal) {
            const lista = LISTAS_TV.find(l => l.id === idLista) || LISTAS_TV[0];
            const salvo = canaisTvCache.get(lista.id);
            if (salvo && salvo.ate > Date.now()) return salvo.canais;
            const resposta = await fetcher(lista.url, { signal });
            if (!resposta.ok) throw new Error('Lista de canais indisponível');
            const linhas = String(await resposta.text()).split('\n').map(l => l.trim());
            const canais = [];
            for (let i = 0; i < linhas.length; i++) {
                if (!/^#EXTINF/i.test(linhas[i])) continue;
                const endereco = linhas[i + 1];
                if (!endereco || endereco.startsWith('#') || !/^https:\/\//i.test(endereco)) continue;
                const nome = ((linhas[i].match(/,(.*)$/) || [])[1] || 'Canal').replace(/\s*\[[^\]]*\]/g, '').trim().slice(0, 70);
                const logo = (linhas[i].match(/tvg-logo="([^"]*)"/i) || [])[1] || '';
                const grupo = (linhas[i].match(/group-title="([^"]*)"/i) || [])[1] || '';
                canais.push({ nome, logo: /^https:\/\//i.test(logo) ? logo : '', grupo: grupo.slice(0, 40), url: endereco, lista: lista.id });
            }
            canaisTvCache.set(lista.id, { canais, ate: Date.now() + 30 * 60 * 1000 });
            return canais;
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
            if(url.pathname==='/api/tv/listas'){return {listas:LISTAS_TV.map(l=>({id:l.id,nome:l.nome,nota:l.nota,url:l.url}))};}
            if(url.pathname==='/api/tv/canais'){return {canais:await canaisTv(url.searchParams.get('lista')||'brasil', signal)};}
            if(url.pathname==='/api/tv/categorias'){
                const canais=await canaisTv(url.searchParams.get('lista')||'brasil', signal);
                const contagem=new Map();
                for(const canal of canais){const grupo=canal.grupo||'undefined';contagem.set(grupo,(contagem.get(grupo)||0)+1);}
                const categorias=[...contagem.entries()].map(([nome,total])=>({nome,total})).sort((a,b)=>b.total-a.total);
                return {categorias};
            }
            if(url.pathname==='/api/top-br'){
                const d=await tmdb('discover/movie',{watch_region:'BR',with_watch_monetization_types:'flatrate|free|ads',sort_by:'popularity.desc',include_adult:'false','vote_count.gte':'50'},signal);
                return {items:(d.results||[]).slice(0,10).map(movie),checkedAt:new Date().toISOString()};
            }
            // Alta definição sem anúncio quando o título não tem dublado limpo:
            // no celular o próprio aparelho resolve (o provedor libera o acesso
            // entre sites) e o vídeo toca dentro do player do aplicativo.
            if(url.pathname==='/api/stream-hd'){
                const tipo=url.searchParams.get('tipo')==='tv'?'tv':'movie';
                const id=url.searchParams.get('id')||'';
                const temporada=url.searchParams.get('season')||'1';
                const episodio=url.searchParams.get('episode')||'1';
                if(!/^\d{1,10}$/.test(id))return {ok:false};
                const fonte=(typeof globalThis!=='undefined'?globalThis:window).VidSrcSource;
                if(!fonte||typeof fonte.resolver!=='function')return {ok:false,motivo:'sem fonte de alta definição'};
                try{
                    let dados=null;
                    for(let tentativa=0;tentativa<2&&!dados;tentativa++){
                        try{ dados=await fonte.resolver(tipo,id,temporada,episodio); }catch{ dados=null; }
                    }
                    if(!dados)return {ok:false};
                    return {ok:true,url:dados.url,urlAplicativo:dados.url,qualidade:dados.qualidade,fonte:dados.fonte,legendas:[]};
                }catch{return {ok:false};}
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
            // Nenhuma opção com anúncio neste ponto: o episódio é resolvido pelo
            // motor de fontes (dublado limpo primeiro, alta definição limpa depois).
            if(ep)return {players:[]};
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
        return { request, sources, describe:async(id,tv,signal)=>movie({...await tmdb(`${tv?'tv':'movie'}/${id}`,{},signal),media_type:tv?'tv':'movie'}) };
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = { createCatalog };
    else root.createCatalog = createCatalog;
})(globalThis);

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { criar } = require('./anime-player');
const StreamPlaybackSession = require('./reproducao-sessao');

const BLOGGER = 'https://www.blogger.com/video.g?token=publico_integracao_1234567890';
const EPISODIO = { season: 1, number: 1, anime: true };
function setup() {
    const nodes = new Map(), timers = new Map(), store = new Map();
    const requests = [], starts = [], events = [];
    let seq = 0, handler = async url => {
        if (url.startsWith('/api/anime-player?')) {
            const query = new URL(url, 'http://localhost').searchParams;
            return { ok: true, tipo: 'embed', anime: true, fonteId: 'meus-animes', audio: 'original',
                legendaPortugues: true, legendaEmbutida: true, url: BLOGGER,
                episode: { season: Number(query.get('temporada')), number: Number(query.get('episodio')) } };
        }
        return url.startsWith('/api/stream-hd?') ? { ok: false } : { players: [] };
    };
    let play = async () => true, playbackState = {}, playbackActive = false;
    function node(id = '') {
        const classes = new Set();
        return { id, hidden: true, children: [], style: {}, value: '0', textContent: '',
            classList: { add: (...v) => v.forEach(x => classes.add(x)), remove: (...v) => v.forEach(x => classes.delete(x)), contains: v => classes.has(v) },
            setAttribute(k, v) { this[k] = v; }, getAttribute(k) { return this[k] ?? null; },
            removeAttribute(k) { delete this[k]; }, hasAttribute(k) { return this[k] !== undefined; },
            append(...n) { this.children.push(...n); }, replaceChildren(...n) { this.children = n; },
            focus() { doc.activeElement = this; }, cloneNode() { return node(id); },
            replaceWith(n) { nodes.set(id, n); }, querySelectorAll() { return []; }, querySelector() { return null; },
            scrollIntoView() {} };
    }
    const get = id => { if (!nodes.has(id)) nodes.set(id, node(id)); return nodes.get(id); };
    const doc = { getElementById: get, createElement: () => node(), body: node(), activeElement: node(),
        addEventListener() {}, querySelector: s => get(s), querySelectorAll: () => [] };
    const localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
    const setTimeout = (fn, ms) => { timers.set(++seq, { fn, ms }); return seq; };
    const clearTimeout = id => timers.delete(id);
    const window = { document: doc, localStorage, setTimeout, clearTimeout, StreamPlaybackSession,
        StreamAcesso: { reportar: async dados => events.push(dados) }, StreamChrome: { wake() {} } };
    const player = criar(window);
    window.StreamAnimePlayer = player;
    const playback = { stop() { playbackActive = false; }, estado() { return playbackState; }, isActive() { return playbackActive; },
        async start(...args) {
            starts.push(args);
            const ok = await play(...args);
            playbackActive = Boolean(ok);
            playbackState = { fonteId: 'watchplay', audio: args[5] ? 'Original' : 'Dublado', posicao: 0 };
            return ok;
        } };
    window.StreamPlayback = playback;
    const ctx = vm.createContext({ document: doc, window, localStorage, navigator: { userAgent: 'Test' },
        URL, URLSearchParams, location: { origin: 'http://localhost:3106' }, AbortController, Set, console,
        StreamAnimePlayer: player, StreamPlayback: playback,
        fetch: async (url, opts) => { requests.push({ url: String(url), signal: opts?.signal }); return { ok: true, json: async () => handler(String(url), opts) }; },
        setTimeout, clearTimeout });
    const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
    vm.runInContext(html.match(/<script>\r?\n([\s\S]*?)<\/script>/)[1], ctx);
    timers.clear();
    requests.length = 0;
    return { get, timers, store, requests, starts, events, player,
        run: code => vm.runInContext(code, ctx), fetch: fn => { handler = fn; }, play: fn => { play = fn; },
        open: (id = 37854, title = 'One Piece', episode = EPISODIO) => vm.runInContext(`abrirPlayer(${JSON.stringify(id)},${JSON.stringify(title)},${JSON.stringify(episode)})`, ctx) };
}
const urls = s => s.requests.map(r => r.url);
const tick = () => new Promise(setImmediate);

test('anime legendado conserva o player original sem anúncio',async()=>{
 const s=setup();await s.open();assert.equal(s.player.isActive(),true);assert.equal(s.get('frame').src,BLOGGER);assert.equal(s.starts.length,0);
});
test('preferência dublada conserva o caminho de reprodução dublado',async()=>{
 const s=setup();s.store.set('streamtv-anime-audio','dublado');await s.open();assert.equal(s.starts[0][3],'/api/playback/serie/37854/1/1');assert.equal(s.starts[0][5],false);assert.equal(s.player.isActive(),false);
});
test('trocar de legendado para dublado encerra o embed anterior',async()=>{
 const s=setup();await s.open();await s.run("selecionarAudioAnime('dublado')");assert.equal(s.player.isActive(),false);assert.equal(s.starts.at(-1)[5],false);assert.equal(s.get('frame').src,'about:blank');
});
test('fechar invalida a resposta tardia de anime',async()=>{
 const s=setup();let resolver;s.fetch(()=>new Promise(r=>resolver=r));const pendente=s.open();await tick();s.run('fechar()');resolver({ok:true,tipo:'embed',anime:true,url:BLOGGER});await pendente;assert.equal(s.player.isActive(),false);assert.equal(s.get('frame').src,'about:blank');
});
test('série comum conserva a alternativa original limpa depois do anime',async()=>{
 const s=setup();await s.open();s.run('fechar()');await s.open(1399,'Série',{season:2,number:4});assert.equal(s.starts.at(-1)[3],'/api/playback/serie/1399/2/4');assert.equal(s.starts.at(-1)[5],true);
});
test('TV ao vivo mantém contexto próprio depois do anime',async()=>{
 const s=setup();await s.open();await s.run("tocarCanal({nome:'Canal',url:'https://canal.example/master.m3u8'})");assert.equal(s.run('filmeAtual'),null);assert.equal(s.starts.at(-1)[6].live,true);assert.equal(s.player.isActive(),false);
});

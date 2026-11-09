// rotas/paginas.js — Páginas e scripts da interface (index, PWA, diagnóstico, arquivos .js/.json).
// Separado do server.js na reorganização de 10/2026: o código é o mesmo,
// só mudou de arquivo. RAIZ é a pasta do server.js (antes, __dirname).
module.exports = function registrar(app, ctx) {
const { LOCAL_CONFIG, PAGE_CANDIDATES, RAIZ, TMDB_KEY, fs, path } = ctx;
app.get(['/','/index.html'], (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    for (const file of PAGE_CANDIDATES) {
        try { return res.type('html').send(require('../pwa/page.cjs').webPage(fs.readFileSync(file, 'utf8'))); } catch { /* tenta o próximo local */ }
    }
    res.status(500).send('Interface do Conecta TV não encontrada.');
});
app.get('/manifest.webmanifest',(req,res)=>res.type('application/manifest+json').sendFile(path.join(RAIZ,'pwa/manifest.webmanifest')));
app.get('/conecta-mark.svg',(req,res)=>{res.setHeader('Cache-Control','no-cache');res.type('image/svg+xml').sendFile(path.join(RAIZ,'conecta-mark.svg'));});
// Diagnóstico: mostra (na tela e na central) o que o navegador do aparelho
// consegue tocar. É a ferramenta usada para descobrir por que uma TV não abre
// o vídeo, sem adivinhar.
app.get('/diagnostico', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(require('../diagnostico').pagina('A Luta pela Esperança'));
});
app.get('/diagnostico/controle.mp4', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.type('video/mp4').sendFile(path.join(RAIZ, 'diagnostico-controle.mp4'));
});
app.get('/sw.js',(req,res)=>{res.setHeader('Cache-Control','no-cache');res.type('js').sendFile(path.join(RAIZ,'pwa/sw.js'));});
app.get(['/pwa/install.js','/pwa/icon-180.png','/pwa/icon-192.png','/pwa/icon-512.png','/pwa/grupo-conecta.webp'],(req,res)=>res.sendFile(path.join(RAIZ,req.path)));
app.get('/api/health', (req, res) => res.json({ status: 'ok', app: 'stream-tv' }));

// ============================================================
app.get('/hls.min.js', (req, res) => res.type('js').send(fs.readFileSync(path.join(RAIZ, 'node_modules/hls.js/dist/hls.min.js'))));
// O player vai sem cache: a atualização vale na hora, sem o navegador ficar
// com a versão antiga guardada.
app.get('/enquadramento.js', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.type('js').send(fs.readFileSync(path.join(RAIZ, 'enquadramento.js'))); });
app.get('/playback.js', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.type('js').send(fs.readFileSync(path.join(RAIZ, 'playback.js'))); });
app.get('/reproducao-sessao.js', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.type('js').send(fs.readFileSync(path.join(RAIZ, 'reproducao-sessao.js'))); });

app.get('/personal.js',(req,res)=>{res.setHeader('Cache-Control','no-store');res.sendFile(path.join(RAIZ,'personal.js'));});
app.get('/abertura.js',(req,res)=>{res.setHeader('Cache-Control','no-store');res.type('js').sendFile(path.join(RAIZ,'abertura.js'));});
app.get('/creditos.js',(req,res)=>{res.setHeader('Cache-Control','no-store');res.type('js').sendFile(path.join(RAIZ,'creditos.js'));});
app.get('/episodios.js',(req,res)=>{res.setHeader('Cache-Control','no-store');res.sendFile(path.join(RAIZ,'episodios.js'));});
app.get('/avisos-servidor.js',(req,res)=>{res.setHeader('Cache-Control','no-store');res.type('js').sendFile(path.join(RAIZ,'avisos-servidor.js'));});
app.get('/library.js',(req,res)=>{res.setHeader('Cache-Control','no-store');res.type('js').send(fs.readFileSync(path.join(RAIZ,'library.js')));});
app.get(['/avatares.js','/perfis-conta.js'],(req,res)=>{res.setHeader('Cache-Control','no-store');res.type('js').send(fs.readFileSync(path.join(RAIZ,req.path.slice(1))));});
app.get('/auth.js',(req,res)=>{res.setHeader('Cache-Control','no-store');res.type('js').send(fs.readFileSync(path.join(RAIZ,'auth.js')));});
app.get('/jarvis.js',(req,res)=>{res.setHeader('Cache-Control','no-store');res.type('js').send(fs.readFileSync(path.join(RAIZ,'jarvis.js')));});
app.get('/fontes.json',(req,res)=>{res.setHeader('Cache-Control','no-store');res.type('json').sendFile(path.join(RAIZ,'fontes.json'));});
app.get('/acesso.js',(req,res)=>{res.setHeader('Cache-Control','no-store');res.type('js').send(fs.readFileSync(path.join(RAIZ,'acesso.js')));});
app.get('/legendas.js',(req,res)=>{res.setHeader('Cache-Control','no-store');res.type('js').send(fs.readFileSync(path.join(RAIZ,'legendas.js')));});

app.get('/assistir.html',(req,res)=>res.type('html').send(fs.readFileSync(path.join(RAIZ,'android/app/src/main/assets/assistir.html'))));
app.get('/catalog.js',(req,res)=>res.type('js').send(fs.readFileSync(path.join(RAIZ,'android/app/src/main/assets/catalog.js'))));
// A página de reprodução com anúncios usa este arquivo; sem a rota ele
// respondia 404 e a página perdia os controles no computador.
app.get('/android.js',(req,res)=>res.type('js').send(fs.readFileSync(path.join(RAIZ,'android/app/src/main/assets/android.js'))));
app.get('/config.json',(req,res)=>res.json({
    tmdbKey: TMDB_KEY,
    app: 'desktop',
    versionName: (() => { try { return require('../package.json').version; } catch { return ''; } })(),
    // O anon key do Supabase é público por desenho; chaves de serviço nunca são enviadas ao cliente.
    supabaseUrl: process.env.SUPABASE_URL || LOCAL_CONFIG.supabaseUrl || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || LOCAL_CONFIG.supabaseAnonKey || '',
    // Endereço da central de status (opcional). O aplicativo reporta acessos e sessões para lá.
    central: String(process.env.CENTRAL_URL || LOCAL_CONFIG.central || '').replace(/\/$/, '')
}));

return {  };
};

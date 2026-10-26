// rotas/jarvis.js — Jarvis: assistente de IA (Groq/Gemini) com limite diário por IP.
// Separado do server.js na reorganização de 10/2026: o código é o mesmo,
// só mudou de arquivo. RAIZ é a pasta do server.js (antes, __dirname).
module.exports = function registrar(app, ctx) {
const { GEMINI_KEY, GROQ_KEY, axios } = ctx;
const JARVIS_PROVIDER = String(process.env.JARVIS_PROVIDER || 'groq').toLowerCase();
const JARVIS_SISTEMA = 'Você é o Jarvis do Conecta TV. Responda em português e nunca prometa que uma fonte funciona.';
// Se o provedor aposentar um modelo, o Jarvis tenta o próximo da lista antes de responder erro.
const JARVIS_PREFERIDOS = {
    groq: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b', 'llama-3.3-70b-versatile'],
    gemini: ['gemini-2.5-flash-lite', 'gemini-2.5-flash']
};
const MODELO_NAO_CONVERSA = /whisper|guard|orpheus|tts|embedding|moderation/i;
const jarvisUsage = new Map();
let cacheModelosGroq = null;
async function modelosGroqDisponiveis() {
    if (cacheModelosGroq) return cacheModelosGroq;
    try {
        const r = await axios.get('https://api.groq.com/openai/v1/models', { timeout: 8000, headers: { Authorization: `Bearer ${GROQ_KEY}` } });
        cacheModelosGroq = (r.data?.data || []).map(modelo => modelo.id).filter(id => !MODELO_NAO_CONVERSA.test(id));
    } catch { cacheModelosGroq = []; }
    return cacheModelosGroq;
}
async function modelosJarvis(provider) {
    const escolhido = String(process.env.JARVIS_MODEL || '').trim();
    const ordem = [...(escolhido && JARVIS_PROVIDER === provider ? [escolhido] : []), ...(JARVIS_PREFERIDOS[provider] || [])];
    if (provider !== 'groq') return [...new Set(ordem)];
    const disponiveis = await modelosGroqDisponiveis();
    const conhecidos = ordem.filter(modelo => !disponiveis.length || disponiveis.includes(modelo));
    return [...new Set([...conhecidos, ...disponiveis.filter(id => !conhecidos.includes(id))])].slice(0, 4);
}
app.post('/api/jarvis', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim().slice(0, 1200) : '';
    if (!prompt) return res.status(400).json({ error: 'Escreva o que deseja encontrar.' });
    const ip = String(req.ip || 'unknown').slice(0, 80), now = Date.now();
    const usage = jarvisUsage.get(ip) || { started: now, count: 0 };
    if (now - usage.started > 86400000) { usage.started = now; usage.count = 0; }
    if (usage.count >= 40) return res.status(429).json({ error: 'Limite gratuito diário atingido. Tente novamente amanhã.' });
    usage.count++; jarvisUsage.set(ip, usage);
    const providers = JARVIS_PROVIDER === 'gemini' ? ['gemini', 'groq'] : ['groq', 'gemini'];
    const available = providers.filter(provider => provider === 'gemini' ? GEMINI_KEY : GROQ_KEY);
    if (!available.length) return res.status(503).json({ error: 'Jarvis ainda não foi configurado neste servidor.' });
    for (const provider of available) {
        for (const model of await modelosJarvis(provider)) {
            try {
                let answer;
                if (provider === 'gemini') {
                    const r = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`, { contents: [{ role: 'user', parts: [{ text: `${JARVIS_SISTEMA}\n\n${prompt}` }] }], generationConfig: { temperature: 0.6, maxOutputTokens: 700 } }, { timeout: 20000 });
                    answer = r.data?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim();
                } else {
                    const r = await axios.post('https://api.groq.com/openai/v1/chat/completions', { model, temperature: 0.6, max_tokens: 900, messages: [{ role: 'system', content: JARVIS_SISTEMA }, { role: 'user', content: prompt }] }, { timeout: 20000, headers: { Authorization: `Bearer ${GROQ_KEY}` } });
                    answer = r.data?.choices?.[0]?.message?.content?.trim();
                }
                if (answer) return res.json({ answer, provider, model });
            } catch { if (provider === 'groq') cacheModelosGroq = null; /* modelo aposentado: reconsulta a lista */ }
        }
    }
    res.status(502).json({ error: 'O Jarvis está indisponível no momento. Nenhuma cobrança foi iniciada pelo Conecta TV.' });
});

return { JARVIS_PROVIDER, JARVIS_SISTEMA, JARVIS_PREFERIDOS, MODELO_NAO_CONVERSA, jarvisUsage, cacheModelosGroq, modelosGroqDisponiveis, modelosJarvis };
};

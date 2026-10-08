// Episódios: quem decide a fonte é o motor (fontes-motor.js).
// Ordem da regra do projeto: dublado limpo → alta definição limpa.

async function resolverEpisodio({ tmdbId, temporada, episodio, cookie = '', exceto = [] }) {
    if (cookie) process.env.WATCHPLAY_COOKIE = cookie;
    const alvo = {
        tipo: 'tv',
        tmdbId: String(tmdbId),
        temporada: String(temporada),
        episodio: String(episodio)
    };
    const motor = require('./fontes-motor');
    const escolhido = await motor.escolher('dublado', alvo, { exceto }) || await motor.escolher('hd', alvo, { exceto });
    return escolhido ? motor.prepararParaPlayer(escolhido) : null;
}

module.exports = { resolverEpisodio };

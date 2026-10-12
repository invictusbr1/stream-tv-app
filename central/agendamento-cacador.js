'use strict';
// A próxima categoria vem do histórico persistido, inclusive após reiniciar.
function proximaCategoria(categorias, ultimo = {}) {
    return [...categorias].sort((a,b) => {
        const instante = id => Date.parse(ultimo.tentativasCategoria?.[id] || ultimo.porCategoria?.[id]?.atualizadoEm || '') || 0;
        return instante(a) - instante(b);
    })[0];
}
module.exports = { proximaCategoria };

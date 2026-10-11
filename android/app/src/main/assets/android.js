'use strict';
// Marca o aparelho como TV (o visual fica maior e com foco para o controle).
try{
  const pediuTv = new URLSearchParams(location.search).get('canal') === 'tv';
  if (pediuTv || /Android ?TV|FireTV|BRAVIA|GoogleTV|SMART-TV|Tizen/i.test(navigator.userAgent)) document.documentElement.classList.add('modo-tv');
}catch(e){}
// Use the device's network directly. There is no localhost API or Node runtime.
const androidCatalog = fetch('/config.json').then(r => {
    if (!r.ok) throw new Error('Configuração ausente');
    return r.json();
}).then(config => createCatalog(window.fetch.bind(window), config.tmdbKey));
window.streamBack = function () {
    if(document.getElementById('series-dialog')?.open){StreamLibrary.closeSeries();return true;}
    if (!document.getElementById('opcoes').hidden) { fecharOpcoes(); return true; }
    if (document.getElementById('player').classList.contains('ativo')) { fechar(); return true; }
    if (!document.getElementById('tv').hidden) { irParaCategoria('inicio'); return true; }
    if (!document.getElementById('resultados').classList.contains('oculto')) {
        document.getElementById('q').value = ''; emAlta(); return true;
    }
    return false;
};
// Controle remoto: navegar na fileira evita medir todo o catálogo por seta.
(() => {
    const selector = 'button:not(:disabled),a[href],input,select,summary,[tabindex="0"],iframe,video';
    let cachedArea = null, cachedNodes = [], dirty = true, lastRepeat = 0;
    const invalidate = () => { dirty = true; };
    new MutationObserver(invalidate).observe(document.documentElement, {
        childList: true, subtree: true, attributes: true,
        attributeFilter: ['hidden', 'class', 'style', 'disabled', 'open', 'inert']
    });
    window.addEventListener('resize', invalidate);
    function areaAtual() {
        const gate = document.getElementById('portao');
        if (gate) return gate;
        const dialog = document.querySelector('dialog[open]');
        if (dialog) return dialog;
        const drawer = document.getElementById('gaveta');
        if (drawer && !drawer.hidden) return drawer;
        const options = document.getElementById('opcoes');
        if (options && !options.hidden) return options;
        const player = document.getElementById('player');
        return player?.classList.contains('ativo') ? player : document;
    }
    function visible(node) { return !node.closest('[hidden],[inert]') && node.getClientRects().length > 0; }
    function move(node) {
        node.focus({ preventScroll: true });
        node.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
    }
    document.addEventListener('keydown', event => {
        if (event.defaultPrevented || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        const active = document.activeElement;
        if (active && (['SELECT','IFRAME','VIDEO'].includes(active.tagName) ||
            (active.tagName === 'INPUT' && active.type !== 'checkbox'))) return;
        if (event.repeat && event.timeStamp - lastRepeat < 80) { event.preventDefault(); return; }
        lastRepeat = event.timeStamp;
        const area = areaAtual();
        const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
        const sign = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
        const card = active?.closest('.card');
        const row = card?.parentElement;
        if (horizontal && row?.classList.contains('poster-row') && area.contains(card)) {
            let next = sign < 0 ? card.previousElementSibling : card.nextElementSibling;
            while (next && (!next.matches(selector) || !visible(next))) next = sign < 0 ? next.previousElementSibling : next.nextElementSibling;
            if (next) move(next);
            event.preventDefault();
            return;
        }
        if (dirty || cachedArea !== area) {
            cachedNodes = [...area.querySelectorAll(selector)].filter(visible);
            cachedArea = area; dirty = false;
        }
        if (!cachedNodes.length) return;
        if (!cachedNodes.includes(active)) { move(cachedNodes[0]); event.preventDefault(); return; }
        const from = active.getBoundingClientRect();
        const x = from.left + from.width / 2, y = from.top + from.height / 2;
        let winner = null, best = Infinity;
        for (const node of cachedNodes) {
            if (node === active) continue;
            const rect = node.getBoundingClientRect();
            const dx = rect.left + rect.width / 2 - x, dy = rect.top + rect.height / 2 - y;
            const forward = (horizontal ? dx : dy) * sign;
            if (forward <= 1) continue;
            const across = Math.abs(horizontal ? dy : dx);
            const score = forward + across * 4;
            if (score < best) { best = score; winner = node; }
        }
        if (winner) move(winner);
        event.preventDefault();
    });
})();

document.addEventListener('DOMContentLoaded',()=>{
    const barra=document.querySelector('.barra');
    if(!barra)return;
    const button=document.createElement('button');button.className='quiet';button.textContent='Cursor';button.setAttribute('aria-label','Ativar cursor do controle');
    button.onclick=()=>{location.href='/remote-pointer';};
    barra.append(button);
});

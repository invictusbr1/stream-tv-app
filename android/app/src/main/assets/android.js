'use strict';
// Use the device's network directly. There is no localhost API or Node runtime.
const androidCatalog = fetch('/config.json').then(r => {
    if (!r.ok) throw new Error('Configuração ausente');
    return r.json();
}).then(config => createCatalog(window.fetch.bind(window), config.tmdbKey));
window.streamBack = function () {
    if(document.getElementById('series-dialog')?.open){StreamLibrary.closeSeries();return true;}
    if (!document.getElementById('opcoes').hidden) { fecharOpcoes(); return true; }
    if (document.getElementById('player').classList.contains('ativo')) { fechar(); return true; }
    if (!document.getElementById('resultados').classList.contains('oculto')) {
        document.getElementById('q').value = ''; emAlta(); return true;
    }
    return false;
};
// Spatial focus for the catalog and local player controls on TV remotes.
document.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const active = document.activeElement;
    if (active && (['SELECT', 'IFRAME', 'VIDEO'].includes(active.tagName) || (active.tagName === 'INPUT' && active.type !== 'checkbox'))) return;
    const modal = document.getElementById('player').classList.contains('ativo');
    const area = document.querySelector('dialog[open]') || (!document.getElementById('opcoes').hidden ? document.getElementById('opcoes') : modal ? document.getElementById('player') : document);
    const nodes = [...area.querySelectorAll('button:not(:disabled),a[href],input,select,summary,[tabindex="0"],iframe,video')]
        .filter(el => el.getClientRects().length && !el.closest('[hidden]'));
    if (!nodes.length) return;
    if (!nodes.includes(active)) { nodes[0].focus(); event.preventDefault(); return; }
    const from = active.getBoundingClientRect();
    const x = from.left + from.width / 2, y = from.top + from.height / 2;
    const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
    const sign = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    let winner = null, best = Infinity;
    for (const node of nodes) {
        if (node === active) continue;
        const rect = node.getBoundingClientRect();
        const dx = rect.left + rect.width / 2 - x, dy = rect.top + rect.height / 2 - y;
        const forward = (horizontal ? dx : dy) * sign;
        if (forward <= 1) continue;
        const across = Math.abs(horizontal ? dy : dx);
        const score = forward + across * 4;
        if (score < best) { best = score; winner = node; }
    }
    if (winner) {
        event.preventDefault(); winner.focus();
        winner.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
});

document.addEventListener('DOMContentLoaded',()=>{
    const button=document.createElement('button');button.className='quiet';button.textContent='Cursor';button.setAttribute('aria-label','Ativar cursor do controle');
    button.onclick=()=>{location.href='/remote-pointer';};
    document.querySelector('.barra').append(button);
});

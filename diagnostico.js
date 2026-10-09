'use strict';
// Página de diagnóstico: mostra na própria tela (e envia para a central) o que
// o navegador do aparelho consegue tocar. Serve para TVs e celulares — é assim
// que descobrimos, sem adivinhação, por que um vídeo não abre.

function pagina(tituloPadrao) {
    const titulo = String(tituloPadrao || 'A Luta pela Esperança').replace(/[<>&]/g, '');
    return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Diagnóstico · Conecta TV</title>
<style>
  body{margin:0;background:#0b0e15;color:#e8ecf3;font:16px system-ui,-apple-system,'Segoe UI',sans-serif;padding:22px}
  h1{font-size:26px;margin:0 0 6px}
  p{color:#93a0b4;margin:0 0 16px;font-size:14px}
  #saida{white-space:pre-wrap;font:600 20px/1.5 ui-monospace,Consolas,monospace;background:#12161f;border:1px solid #ffffff1f;
         border-radius:14px;padding:16px;min-height:220px}
  #area{margin-top:16px;display:flex;gap:14px;flex-wrap:wrap}
  video{width:420px;height:236px;background:#000;border-radius:10px;border:1px solid #ffffff22}
  .ok{color:#5ce08d}.ruim{color:#ff8f8f}
  button{background:#e50914;color:#fff;border:0;border-radius:14px;padding:16px 30px;font:700 20px system-ui;margin:0 0 16px}
</style>
</head>
<body>
  <h1>Diagnóstico do Conecta TV</h1>
  <p id="alvo">Teste do vídeo: ${titulo}. Aperte o botão com o controle — o resultado aparece aqui e vai para a central.</p>
  <button id="comecar" type="button">▶ Fazer o teste agora</button>
  <div id="saida"></div>
  <div id="area"></div>
<script>
(function () {
  'use strict';
  var alvoId = new URLSearchParams(location.search).get('id') || '921';
  var linhas = [];
  var enviadas = 0;
  function tela(texto) { linhas.push(texto); document.getElementById('saida').textContent = linhas.join('\\n'); }
  tela('navegador: ' + (navigator.userAgent || '?'));   // mostrado antes do teste, para foto
  document.getElementById('comecar').onclick = function () { document.getElementById('comecar').hidden = true; rodar(); };
  function rodar() {
  function contar(texto) {
    var curto = String(texto).slice(0, 118);
    try {
      fetch('/api/evento', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo: 'diagnostico', nome: 'Diagnóstico da TV', aparelho: 'TV ou TV box', motivo: curto, navegador: (navigator.userAgent || '').slice(0, 160), versao: 'diagnostico' })
      });
    } catch (e) { /* segue */ }
    enviadas++;
  }
  function anotar(texto) { tela(texto); contar(texto); }

  // 1) O que o navegador diz que consegue tocar
  var v = document.createElement('video');
  var mse = typeof window.MediaSource !== 'undefined';
  var mp4 = v.canPlayType('video/mp4; codecs="avc1.42E01E,mp4a.40.2"') || 'nao';
  var hls1 = v.canPlayType('application/vnd.apple.mpegurl') || 'nao';
  var hls2 = v.canPlayType('application/x-mpegURL') || 'nao';
  var tipos = 'erro';
  try {
    tipos = ['avc1.42E01E,mp4a.40.2', 'avc1.4D401F,mp4a.40.2'].map(function (t) {
      return (window.MediaSource && MediaSource.isTypeSupported && MediaSource.isTypeSupported('video/mp4; codecs="' + t + '"')) ? 'sim' : 'nao';
    }).join('/');
  } catch (e) { tipos = 'erro'; }
  anotar('navegador: ' + (navigator.userAgent || '?'));
  anotar('MSE=' + (mse ? 'sim' : 'NAO') + ' mp4=' + mp4 + ' hlsNativo=' + hls1 + '/' + hls2 + ' codecs=' + tipos);

  // 2) Teste real de reprodução (dois vídeos: o nosso, de controle, e o da fonte)
  function testar(nome, url, final) {
    var el = document.createElement('video');
    el.playsInline = true; el.setAttribute('playsinline', ''); el.setAttribute('webkit-playsinline', '');
    el.muted = false; el.volume = 0.15;
    document.getElementById('area').appendChild(el);
    var comeco = Date.now(), pronto = false, tocou = false;
    function fim(texto, bom) {
      if (pronto) return; pronto = true;
      try { el.pause(); } catch (e) { /* segue */ }
      anotar(nome + ': ' + texto);
      if (final) anotar('fim do diagnostico');
    }
    el.addEventListener('loadedmetadata', function () { anotar(nome + ': metadados em ' + (Date.now() - comeco) + 'ms · ' + el.videoWidth + 'x' + el.videoHeight); });
    el.addEventListener('playing', function () { tocou = true; anotar(nome + ': começou a tocar em ' + (Date.now() - comeco) + 'ms'); });
    el.addEventListener('error', function () { fim('ERRO ' + (el.error ? el.error.code : '?') + ' · pronto=' + el.readyState + ' · rede=' + el.networkState, false); });
    el.addEventListener('timeupdate', function () { if (el.currentTime > 0.5 && el.videoWidth) fim('OK (' + el.currentTime.toFixed(1) + 's tocados)', true); });
    setTimeout(function () { fim('sem imagem em 25s · erro=' + (el.error ? el.error.code : 'nenhum') + ' · pronto=' + el.readyState + ' · rede=' + el.networkState + ' · tocou=' + tocou, false); }, 25000);
    el.src = url;
    var p = el.play(); if (p && p.catch) p.catch(function (e) { anotar(nome + ': play recusado (' + (e && e.name) + ')'); });
  }

  testar('controle (mesmo site)', '/diagnostico/controle.mp4', false);
  fetch('/api/playback/' + alvoId, { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (dados) {
      if (!dados || !dados.url) { anotar('fonte: o aplicativo não devolveu endereço (' + JSON.stringify(dados || {}).slice(0, 80) + ')'); anotar('fim do diagnostico'); return; }
      anotar('fonte: ' + (dados.source || '?') + ' · tipo=' + (dados.type || 'hls') + ' · ' + (dados.resolucao || ''));
      testar('fonte real', dados.url, true);
    })
    .catch(function (e) { anotar('fonte: falhou ao pedir (' + (e && e.message ? e.message : 'erro') + ')'); anotar('fim do diagnostico'); });
  }
})();
</script>
</body>
</html>`;
}

module.exports = { pagina };

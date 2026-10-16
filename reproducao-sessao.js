// Medidas de uma sessão do player. Não guarda o endereço do vídeo nem faz rede.
(function (raiz, fabrica) {
    if (typeof module === 'object' && module.exports) module.exports = fabrica(raiz);
    else raiz.StreamPlaybackSession = fabrica(raiz);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (raiz) {
    'use strict';

    var MAX_TENTATIVAS = 20;
    var MAX_TEMPO_MS = 7 * 24 * 60 * 60 * 1000;
    var MAX_POSICAO = 365 * 24 * 60 * 60;
    var sequenciaLocal = 0;

    function numero(valor, maximo, reserva) {
        return typeof valor === 'number' && isFinite(valor)
            ? Math.min(maximo, Math.max(0, valor)) : reserva;
    }

    function texto(valor, limite) {
        if (typeof valor !== 'string') return '';
        // Os campos são nomes/identificadores. URLs e parâmetros nunca entram no relato.
        if (/[\x00-\x1f\x7f/?&=#\\]|https?:|www\./i.test(valor)) return '';
        return valor.trim().slice(0, limite);
    }

    function identificador(valor) {
        return typeof valor === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(valor) ? valor : '';
    }

    function idSessao() {
        var crypto = raiz && raiz.crypto;
        if (!crypto && typeof require === 'function') {
            try { crypto = require('node:crypto').webcrypto; } catch (_) {}
        }
        if (crypto && typeof crypto.getRandomValues === 'function') {
            try {
                var bytes = new Uint8Array(16);
                crypto.getRandomValues(bytes);
                return 'rp_' + Array.prototype.map.call(bytes, function (b) {
                    return ('0' + b.toString(16)).slice(-2);
                }).join('');
            } catch (_) {}
        }
        // Compatibilidade com WebViews antigos; o identificador fica somente nesta sessão.
        sequenciaLocal += 1;
        return 'rp_local_' + Date.now().toString(36) + '_' + sequenciaLocal.toString(36)
            + '_' + Math.random().toString(36).slice(2, 14);
    }

    function criar(opcoes) {
        opcoes = opcoes || {};
        var relogio = typeof opcoes.agora === 'function' ? opcoes.agora : function () {
            return raiz.performance && typeof raiz.performance.now === 'function'
                ? raiz.performance.now() : Date.now();
        };
        var notificar = typeof opcoes.onEvent === 'function' ? opcoes.onEvent : function () {};
        var sessao = identificador(opcoes.sessao) || idSessao();
        var tentativa = null, total = 0, ultimoAgora = 0;

        function agora() {
            var valor;
            try { valor = relogio(); } catch (_) { valor = ultimoAgora; }
            if (typeof valor !== 'number' || !isFinite(valor)) valor = ultimoAgora;
            ultimoAgora = Math.max(ultimoAgora, valor);
            return ultimoAgora;
        }

        function posicao(valor) {
            if (tentativa) tentativa.posicao = numero(valor, MAX_POSICAO, tentativa.posicao);
        }

        function resumo() {
            var t = tentativa;
            return {
                sessao: sessao,
                tentativa: t ? t.numero : 0,
                fonteId: t ? t.fonteId : '',
                fonte: t ? t.fonte : '',
                audio: t ? t.audio : '',
                resolucao: t ? t.resolucao : '',
                tempoAberturaMs: t ? t.tempoAberturaMs : null,
                posicao: t ? t.posicao : 0,
                travamentos: t ? t.travamentos : 0,
                tempoTravadoMs: t ? t.tempoTravadoMs : 0,
                resultado: t ? t.resultado : 'aguardando',
                encerrada: t ? t.encerrada : false
            };
        }

        function emitir(motivo) {
            var evento = resumo();
            evento.tipo = 'reproducao';
            if (motivo) evento.motivo = texto(motivo, 160);
            // Telemetria opcional não pode impedir a reprodução ou a troca de fonte.
            try { notificar(evento); } catch (_) {}
        }

        function atualizarFonte(dados) {
            if (!tentativa || tentativa.encerrada) return null;
            dados = dados || {};
            if (Object.prototype.hasOwnProperty.call(dados, 'fonteId')) tentativa.fonteId = identificador(dados.fonteId);
            if (Object.prototype.hasOwnProperty.call(dados, 'fonte')) tentativa.fonte = texto(dados.fonte, 80);
            if (Object.prototype.hasOwnProperty.call(dados, 'audio')) tentativa.audio = texto(dados.audio, 40);
            if (Object.prototype.hasOwnProperty.call(dados, 'resolucao')) tentativa.resolucao = texto(dados.resolucao, 40);
            return resumo();
        }

        function fecharEspera(instante, contar) {
            if (tentativa.espera === null) return;
            if (contar) {
                tentativa.travamentos = Math.min(10000, tentativa.travamentos + 1);
                tentativa.tempoTravadoMs = numero(tentativa.tempoTravadoMs
                    + Math.max(0, instante - tentativa.espera), MAX_TEMPO_MS, MAX_TEMPO_MS);
            }
            tentativa.espera = null;
        }

        function finalizar(resultado, valor, motivo) {
            if (!tentativa || tentativa.encerrada) return false;
            posicao(valor);
            fecharEspera(agora(), true);
            tentativa.encerrada = true;
            tentativa.resultado = /^[a-z][a-z0-9_-]{0,31}$/.test(resultado || '') ? resultado : 'encerrou';
            emitir(motivo);
            return true;
        }

        return {
            iniciar: function (dados) {
                if (total >= MAX_TENTATIVAS) return null;
                finalizar('trocou');
                tentativa = {
                    numero: ++total, inicio: agora(), tempoAberturaMs: null,
                    fonteId: '', fonte: '', audio: '', resolucao: '', posicao: 0,
                    travamentos: 0, tempoTravadoMs: 0, espera: null, suspensa: false,
                    resultado: 'iniciou', encerrada: false
                };
                atualizarFonte(dados);
                return resumo();
            },
            fonte: atualizarFonte,
            imagem: function (valor) {
                if (!tentativa || tentativa.encerrada || tentativa.tempoAberturaMs !== null) return false;
                posicao(valor);
                tentativa.tempoAberturaMs = numero(agora() - tentativa.inicio, MAX_TEMPO_MS, null);
                tentativa.suspensa = false;
                tentativa.resultado = 'abriu';
                emitir();
                return true;
            },
            esperar: function (valor) {
                if (!tentativa || tentativa.encerrada || tentativa.tempoAberturaMs === null || tentativa.suspensa) return false;
                posicao(valor);
                if (tentativa.espera !== null) return false;
                tentativa.espera = agora();
                return true;
            },
            tocando: function (valor) {
                if (!tentativa || tentativa.encerrada) return false;
                posicao(valor);
                fecharEspera(agora(), true);
                tentativa.suspensa = false;
                return true;
            },
            pausar: function (valor) {
                if (!tentativa || tentativa.encerrada) return false;
                posicao(valor);
                fecharEspera(agora(), false);
                tentativa.suspensa = true;
                return true;
            },
            buscar: function (valor) {
                if (!tentativa || tentativa.encerrada) return false;
                posicao(valor);
                fecharEspera(agora(), false);
                tentativa.suspensa = true;
                return true;
            },
            falha: function (motivo, valor) { return finalizar('falhou', valor, motivo); },
            encerrar: function (resultado, valor) { return finalizar(resultado, valor); },
            estado: resumo
        };
    }

    return { criar: criar };
}));

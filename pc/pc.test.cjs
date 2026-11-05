'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { criarPlayer, argumentos, urlSegura } = require('./mpv.cjs');

const FALSO = path.join(__dirname, 'mpv-falso.cjs');
const executarFalso = (env = {}) => (exe, args, opts) => spawn(process.execPath, [FALSO, ...args], { ...opts, env: { ...process.env, ...env } });

test('argumentos do mpv: tela cheia, português primeiro, retomada e título sem aspas', () => {
    const a = argumentos({ url: 'https://cdn.example/v.mkv', titulo: 'Filme "x"\nlinha', posicao: 125.7, referer: 'https://site.example/', ipc: 'P' });
    assert.ok(a.includes('--fs'));
    assert.ok(a.includes('--start=125'));
    assert.ok(a.includes('--referrer=https://site.example/'));
    assert.ok(a.some(x => x.startsWith('--alang=pt-BR')));
    assert.ok(a.includes('--force-media-title=Filme  x  linha'));
    assert.deepEqual(a.slice(-2), ['--', 'https://cdn.example/v.mkv']);
    assert.equal(argumentos({ url: 'u', posicao: 2, ipc: 'P' }).some(x => x.startsWith('--start')), false);
    assert.equal(urlSegura('file:///C:/Windows/x'), '');
    assert.equal(urlSegura('https://u:p@x.example/'), '');
    assert.equal(urlSegura('--script=x'), '');
});

test('player: imagem em 2160p, posição sobe e o fim (eof) é avisado', async () => {
    const p = criarPlayer({ acharExe: () => 'mpv', executar: executarFalso() });
    const r = p.tocar({ url: 'https://cdn.example/v.mkv', titulo: 'X', posicao: 30 });
    assert.ok(r.sessao);
    let e = p.estado();
    for (let i = 0; i < 100 && !e.terminou; i++) e = await p.esperar(3000);
    assert.equal(e.imagem, true);
    assert.equal(e.altura, 2160);
    assert.ok(e.posicao >= 30.8, 'posição ' + e.posicao);
    assert.equal(e.duracao, 100);
    assert.equal(e.motivo, 'eof');
    assert.equal(p.ocupado(), false);
});

test('player: arquivo que o mpv não abre vira erro, sem imagem', async () => {
    const p = criarPlayer({ acharExe: () => 'mpv', executar: executarFalso({ MPV_FALSO: 'erro' }) });
    p.tocar({ url: 'https://cdn.example/ruim.mkv' });
    let e = p.estado();
    for (let i = 0; i < 100 && !e.terminou; i++) e = await p.esperar(3000);
    assert.equal(e.imagem, false);
    assert.equal(e.motivo, 'error');
    assert.match(e.erro, /unrecognized/);
});

test('player: parar fecha o mpv (motivo quit) e sem mpv instalado avisa', async () => {
    const p = criarPlayer({ acharExe: () => 'mpv', executar: executarFalso({ MPV_FALSO: 'longo' }) });
    p.tocar({ url: 'https://cdn.example/v.mkv' });
    let e = p.estado();
    for (let i = 0; i < 50 && !e.imagem; i++) e = await p.esperar(3000);
    p.parar();
    for (let i = 0; i < 50 && !e.terminou; i++) e = await p.esperar(3000);
    assert.equal(e.motivo, 'quit');
    assert.match(criarPlayer({ acharExe: () => '' }).tocar({ url: 'https://x.example/' }).erro, /não está instalado/);
    assert.match(p.tocar({ url: 'javascript:alert(1)' }).erro, /inválido/);
});

function pedir(porta, caminho, { metodo = 'GET', chave, host, corpo } = {}) {
    return new Promise((ok, falha) => {
        const req = http.request({ host: '127.0.0.1', port: porta, path: caminho, method: metodo, headers: { Host: host || `127.0.0.1:${porta}`, 'Content-Type': 'application/json', ...(chave ? { 'x-conecta-pc': chave } : {}) } }, res => {
            let s = ''; res.on('data', d => { s += d; }); res.on('end', () => ok({ codigo: res.statusCode, json: (() => { try { return JSON.parse(s); } catch { return null; } })() }));
        });
        req.on('error', falha); if (corpo) req.write(JSON.stringify(corpo)); req.end();
    });
}

test('rotas do PC: só existem no app do PC, exigem chave e Host; endereço relativo vira deste PC', async () => {
    const express = require('express');
    const rotas = require('../rotas/pc.js');
    const antes = { pc: process.env.CONECTA_PC, chave: process.env.CONECTA_PC_TOKEN };
    try {
        delete process.env.CONECTA_PC;
        assert.deepEqual(rotas(express(), {}), {});
        process.env.CONECTA_PC = '1'; process.env.CONECTA_PC_TOKEN = 'a'.repeat(48);
        const tocados = [];
        const app = express(); app.use(express.json());
        rotas(app, { playerPc: { tocar: o => { tocados.push(o); return { ok: true, sessao: 's1' }; }, parar() {}, esperar: async () => ({ sessao: 's1' }), estado: () => ({ sessao: 's1' }), ocupado: () => false }, instaladorPc: { estado: () => ({ pronto: true }), iniciar: () => ({}) } });
        const srv = app.listen(0, '127.0.0.1'); await new Promise(r => srv.once('listening', r));
        const porta = srv.address().port, chave = 'a'.repeat(48);
        try {
            assert.equal((await pedir(porta, '/api/pc/estado')).codigo, 403);
            assert.equal((await pedir(porta, '/api/pc/estado', { chave, host: 'evil.example' })).codigo, 403);
            assert.equal((await pedir(porta, '/api/pc/estado', { chave })).codigo, 200);
            const r = await pedir(porta, '/api/pc/tocar', { metodo: 'POST', chave, corpo: { url: '/api/hls?u=abc', titulo: 'T', posicao: 10 } });
            assert.equal(r.codigo, 200);
            assert.equal(tocados[0].url, `http://127.0.0.1:${porta}/api/hls?u=abc`);
        } finally { srv.close(); }
    } finally {
        if (antes.pc === undefined) delete process.env.CONECTA_PC; else process.env.CONECTA_PC = antes.pc;
        if (antes.chave === undefined) delete process.env.CONECTA_PC_TOKEN; else process.env.CONECTA_PC_TOKEN = antes.chave;
    }
});

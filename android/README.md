# Conecta TV Android — teste pessoal

Aplicativo independente do PC. A interface e a consulta HTTPS ao TMDB ficam no aparelho. Não há servidor Node, porta local ou domínio hospedado necessário. A reprodução depende de internet, do Android System WebView e dos fornecedores externos.

## Plataforma

- Android 6 (API 23) ou posterior, com WebView atualizado.
- Celular e entrada no launcher Android TV; foco direcional no catálogo, Voltar e vídeo em tela cheia.
- O modo padrão limita pop-ups. O modo com anúncios permite uma janela por toque e oferece um botão nativo para fechá-la.
- Captchas são concluídos pela pessoa. WebViews podem ser rejeitados pelo fornecedor; o APK não garante funcionamento de toda fonte.
- Catálogo de filmes do projeto existente; não adiciona catálogo de séries.

## Construção

JDK 17, Gradle 8.11.1, Android SDK 35 e Build Tools 35.0.0. Licença do SDK aceita pelo proprietário em 03/10/2026.

`node sync-ui.cjs` copia e adapta a interface Windows do diretório pai; `config.json` recebe a chave TMDB já usada pelo projeto. Esta chave fica no APK de uso pessoal: não incluir credenciais administrativas ou segredos de servidor. Antes de distribuir publicamente, revisar credenciais, atribuição do TMDB e requisitos de publicação.

`node --test catalog.test.cjs` executa os testes do catálogo. `gradlew.bat assembleDebug lintDebug` compila e analisa o Android. No Windows, compilar a partir de uma cópia em pasta sem acentos; `Build-Android.ps1` faz isso e verifica a assinatura:

```powershell
.\Build-Android.ps1 -ToolRoot 'CAMINHO\android-tools' -BuildDirectory 'CAMINHO\android-build' -OutputDirectory 'CAMINHO\outputs'
```

O APK de teste usa a assinatura de depuração gerada pelo Android em `%USERPROFILE%\.android\debug.keystore`. Preservar essa chave para instalar atualizações sem desinstalar. Para publicação, criar uma assinatura de produção e trocar o tipo de build.

## Verificação realizada

Testes automatizados cobrem rankings, cache, busca, cancelamento, falhas de rede e estabilidade das fontes. A interface foi exercitada no navegador com largura de celular e TV, incluindo busca, modo com anúncios, retorno e foco por setas. Compilação e lint Android foram executados.

Sem dispositivo conectado: instalação, vídeo, áudio, rotação, segundo plano, tela cheia e controle remoto precisam de validação no aparelho antes de considerar a versão final.

Referências: https://developer.android.com/build/releases/agp-8-9-0-release-notes e https://developer.android.com/develop/ui/views/layout/webapps.

## Interface de celular 2.13.66

O APK de celular usa a interface aprovada para o navegador com adaptações próprias para toque. Filmes e séries abrem detalhes em tela inteira; temporadas, favoritos e episódios continuam usando o catálogo local. A reprodução pede tela cheia horizontal pelo mecanismo nativo do aplicativo. Voltar sai do player e restaura a página e a temporada da série. O volume usa os botões físicos do telefone.

`phone-ui.cjs` reaproveita a apresentação de `pwa/redesign.css` e `pwa/redesign.js`; `phone.css` e `phone.js` acrescentam o comportamento do celular. A interface permanece desativada em aparelhos/canal de TV. Não editar os arquivos gerados em `app/src/main/assets/index.html` diretamente: executar `node android/sync-ui.cjs` depois das alterações.

Para compilar apenas o celular, passar `-Canal celular` ao script `Build-Android.ps1`. O padrão `ambos` mantém o processo existente de compilar as duas variantes. O APK continua com o pacote `br.streamtv.app` e a chave Android de depuração já usada nas versões anteriores.

Verificação desta interface: páginas de filme e série, larguras de 320–412px, player horizontal, pause, busca de ±10s e limites do vídeo, retorno à temporada selecionada, navegação de volta ao catálogo e exclusão da TV. Reprodução e orientação física ainda exigem teste no telefone.

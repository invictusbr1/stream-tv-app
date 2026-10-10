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

`node sync-ui.cjs` copia e adapta a interface Windows do diretório pai; `config.json` recebe a chave TMDB já usada pelo projeto. Esta chave fica no APK e também deve ser revisada antes da distribuição. Credenciais de IA e administrativas nunca devem ser incluídas.

O Jarvis usa `/api/jarvis` no servidor. No build, configure `JARVIS_SERVER_URL=https://seu-servidor` (ou `jarvisServer` no `config.local.json`). O APK recebe somente esse endereço; `GROQ_API_KEY` e `GEMINI_API_KEY` pertencem ao ambiente do servidor. Sem endereço configurado, o assistente informa que precisa de configuração, e o restante do app continua funcionando.

No servidor, configure `ACESSO_CODIGO` e permita a origem do WebView em `ORIGENS_PERMITIDAS` (consulte `HOST` em `MainActivity.java`). O Android pede o código ao receber 401 e usa o token de acesso do servidor. Nunca publique o código em arquivos de descoberta. Execute `Verificar-Segredos-Apk.ps1 -ApkPath caminho.apk` antes de distribuir por qualquer meio; o publicador oficial já faz essa verificação para Android e TV.

Se uma chave já esteve em uma versão publicada, revogue-a no provedor antes de configurar a substituta. Versões antigas, downloads e histórico do Git podem guardar a chave anterior. A correção do código não revoga credenciais nem substitui os APKs existentes.

`node --test catalog.test.cjs` executa os testes do catálogo. `gradlew.bat assembleDebug lintDebug` compila e analisa o Android. No Windows, compilar a partir de uma cópia em pasta sem acentos; `Build-Android.ps1` faz isso e verifica a assinatura:

```powershell
.\Build-Android.ps1 -ToolRoot 'CAMINHO\android-tools' -BuildDirectory 'CAMINHO\android-build' -OutputDirectory 'CAMINHO\outputs'
```

O APK de teste usa a assinatura de depuração gerada pelo Android em `%USERPROFILE%\.android\debug.keystore`. Preservar essa chave para instalar atualizações sem desinstalar. Para publicação, criar uma assinatura de produção e trocar o tipo de build.

## Verificação realizada

Testes automatizados cobrem rankings, cache, busca, cancelamento, falhas de rede e estabilidade das fontes. A interface foi exercitada no navegador com largura de celular e TV, incluindo busca, modo com anúncios, retorno e foco por setas. Compilação e lint Android foram executados.

Sem dispositivo conectado: instalação, vídeo, áudio, rotação, segundo plano, tela cheia e controle remoto precisam de validação no aparelho antes de considerar a versão final.

Referências: https://developer.android.com/build/releases/agp-8-9-0-release-notes e https://developer.android.com/develop/ui/views/layout/webapps.

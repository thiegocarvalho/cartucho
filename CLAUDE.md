# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Formato do projeto

App estático servido por GitHub Pages a partir da `main` — push publica. Sem backend, sem
testes automatizados, sem CI. O site em si não tem build: o único passo de build é gerar o CSS
do Tailwind, cujo resultado é **commitado** (`assets/css/tailwind.css`).

```
index.html               markup + ordem de carregamento
tailwind.config.js       tema, usado só pela build do CSS
package.json             scripts da build do CSS (o site não depende de npm)
assets/css/
  tailwind.css           GERADO — não edite à mão (npm run css)
  tailwind.src.css       entrada das diretivas @tailwind
  main.css               glassmorphism, CRT, foco de gamepad
assets/img/og-cover.png  imagem de preview dos links compartilhados
assets/js/
  config.js              constantes: gateways, timeouts, chaves de storage, URLs
  icons.js               SVGs injetados por JS (menu lateral)
  vendor.js              carregamento sob demanda de qrcodejs/html5-qrcode
  ipfs.js                CID, escolha de gateway, fetch de manifesto
  library.js             localStorage, validação de manifesto, import/export
  rom-cache.js           cache das ROMs na Cache API, com progresso
  emulator.js            globais EJS_*, boot e navegação do player
  gamepad.js             loop de controle e foco de UI (mixin do componente)
  app.js                 componente Alpine: estado da UI e orquestração
```

## Rodando localmente

Precisa ser servido por HTTP — ES modules não carregam por `file://`:

```bash
npm run serve      # http://localhost:8000
```

**Acesse por `localhost`, nunca por `0.0.0.0` nem pelo IP da rede.** Fora de um contexto
seguro (https, `localhost` ou `127.0.0.1`) o navegador desliga Cache API, área de
transferência e câmera — o app perde o cache de ROM, o copiar link e o leitor de QR sem dizer
nada. O `serve` faz bind em `127.0.0.1` justamente para não haver a tentação. Para testar no
celular, use um túnel HTTPS (`cloudflared tunnel --url http://localhost:8000`), porque IP de
rede local também não é contexto seguro. O app avisa em faixa amarela quando está nessa
situação.

**Depois de mexer em markup ou em JS, rode a build:**

```bash
npm run build      # compila o CSS e carimba a versão nas URLs
npm run css:watch  # durante o desenvolvimento, só o CSS
```

`npm run build` faz duas coisas:

1. **CSS** — `assets/css/tailwind.css` é gerado a partir de `tailwind.src.css` (que já inclui
   `app.src.css`). Editar o arquivo gerado é perda de trabalho. Classe que "não pegou" quase
   sempre é CSS desatualizado.
2. **Versão** — `scripts/version.mjs` carimba `?v=<hash do conteúdo>` no `<script>`, no
   `<link>` e em cada import entre módulos. **Não é enfeite:** no GitHub Pages os assets vêm
   com cache de 10 minutos e sem ETag confiável; sem o carimbo, um deploy combina `index.html`
   novo com `app.js` velho em cache e o app quebra inteiro com `X is not defined` — o markup
   novo referencia propriedades que o componente antigo não tem. Já aconteceu em
   desenvolvimento. O script é idempotente: limpa o `?v=` anterior antes de recalcular.

Durante o desenvolvimento, o cache do browser também engana: se uma mudança em `assets/js`
parece não ter efeito, é cache de módulo — `Ctrl+Shift+R` ou `npm run build`.

Testes são manuais, no navegador. Ao editar um módulo, force hard reload (Ctrl+Shift+R): o browser
cacheia os arquivos `.js` de forma agressiva e você depura código velho sem perceber.

## Ordem de carregamento (não reordene sem entender)

1. `assets/css/tailwind.css` — CSS estático. O Play CDN foi removido: eram 440 KB de JS
   compilando CSS no browser a cada carga.
2. qrcodejs e html5-qrcode **não** são carregados no boot. São ~385 KB usados só no modal de
   compartilhar e no scanner; `vendor.js` injeta cada um na primeira vez que é preciso.
3. `assets/js/app.js` (`type="module"`) **antes** do CDN do Alpine: ele registra
   `Alpine.data('cartuchoApp')` no evento `alpine:init`, que o Alpine dispara ao subir. Módulos e
   scripts `defer` executam na ordem do documento, então inverter os dois quebra o app inteiro.

## Arquitetura

### Componente Alpine único, lógica nos módulos
`app.js` exporta `cartuchoApp()` — só estado de UI e orquestração; regra de negócio mora nos módulos.
`gamepad.js` é a exceção: exporta um mixin (`gamepadModule()`) espalhado no componente, porque
depende de `this` (`isPlaying`, modais, `stopGame`). O markup usa `x-data="cartuchoApp"` (sem
parênteses — é `Alpine.data`, não uma função global).

### Cartucho vs ROM: dois CIDs
Um "Cartucho" é um manifesto JSON no IPFS. O CID dele é a identidade do jogo; o manifesto aponta
para um CID **separado** com o binário da ROM. `normalizeCartucho()` em `library.js` é o ponto único
por onde passam todos os caminhos de import (URL, QR, CID manual) — campo novo de manifesto se
adiciona ali. Entradas antigas gravavam `cid` em vez de `cartucho`: **sempre** use `gameCid(game)`
para ler o identificador.

`localStorage`: `cartucho_library` e `cartucho_gateway`. Toda mutação de `this.library` precisa de um
`saveLibrary()` logo depois — não existe watcher de persistência.

### Gateways são a parte frágil do sistema
`KNOWN_GATEWAYS` é a lista **fixa**, curada empiricamente a partir da lista oficial do IPFS
Public Gateway Checker; o usuário acrescenta os dele pela tela de configurações
(`customGateways`, no localStorage), e `knownGateways` no componente é o getter que junta as
duas. Gateway novo só entra depois de passar por `probeGateway()` — fetch cross-origin de
verdade, que é como o app vai usá-lo.

A medição usa `cache: 'no-store'`: sem isso a segunda rodada lê o cache do browser e todo
gateway aparece com ~7ms, escondendo que um deles leva 5 segundos.

A lista é curada porque: a maioria dos gateways públicos famosos
(ipfs.io, dweb.link, w3s.link, nftstorage.link, cloudflare-ipfs.com, cf-ipfs.com, 4everland,
trustless-gateway, storry.tv) responde 403/redirect **sem cabeçalho CORS**, ou tem DNS morto — o
`fetch` do browser falha neles mesmo quando o conteúdo existe. Antes de adicionar um gateway, teste
com `fetch` cross-origin real a partir de uma página, não abrindo a URL no navegador.

Antes de ir à rede, `loadGame` consulta o cache local de ROMs (`rom-cache.js`, Cache API,
chaveado por CID). Como CID é hash do conteúdo, o cache é permanente e não precisa de
invalidação — a segunda vez que um jogo abre não toca a rede.

O cache **vem desligado** e o teto é escolhido pelo usuário num controle deslizante cujo
máximo é a quota que `navigator.storage.estimate()` informa (80% dela), não um número fixo:
Chrome dá até 60% do disco, Firefox 50% do livre com teto de 2 GB por site, Safari ~1 GB, e
navegadores de TV nem publicam o número. Quando o limite aperta, `putRom` descarta as ROMs
guardadas há mais tempo. Reduzir o teto apaga o que está guardado, então isso passa por
confirmação (`pendingCacheLimit`). Ligar o cache também pede `navigator.storage.persist()`,
senão o navegador limpa tudo sozinho sob pressão de disco — e o Safari apaga dados de origem
sem visita há 7 dias de qualquer forma.

Dois caminhos de rede, ambos resilientes:
- **teste de latência** — `measureGateways(gateways, onResult)`: dispara todos em paralelo e
  entrega cada medição assim que chega, para a lista ir preenchendo em vez de ficar parada
  até o último timeout.
- **manifesto** — `fetchCartuchoAnywhere()`: tenta o gateway do usuário e, se ele não responder,
  todos os outros em paralelo. `not-json` não tenta os demais (o CID foi achado e não é um Cartucho).
- **ROM** — `resolveFastestGateway()`: corre `HEAD` contra todos e usa o primeiro que responder. Se a
  corrida inteira falhar, cai no último gateway que comprovadamente funcionou (`lastWorkingGateway`).

Gateway `http:` é descartado quando a página é `https:` (mixed content). Preferência salva em
gateway da lista `DEPRECATED_GATEWAYS` é migrada no boot, senão quem já usou o app fica preso num
gateway morto.

`GATEWAY_TEST_CID` é o CID do IPFS Gateway Checker — a referência que o próprio projeto IPFS
mantém pinada para health check. **Ao trocá-lo, cuide do valor exato**: um caractere colado a
mais faz todo gateway responder 400 e a tela de saúde acusar gateway bom como quebrado. Já
aconteceu. `checarCidDeTeste()` em `ipfs.js` valida espaço e comprimento (46 para v0, 59 para
v1 base32) antes de qualquer medição, e `measureGateways` distingue 403 (dedicado/restrito) e
429 (limite de uso) de gateway realmente fora do ar.

### EmulatorJS: recarregue, não descarregue
Estado de WebAssembly/Emscripten não é desmontável de forma confiável, então trocar de jogo e sair do
jogo são **navegações de página** (`reloadWithGame` / `reloadToPage`), e `initData()` relê `?cartucho=`
e `?page=` no boot para restaurar a view.

Duas armadilhas já pagas:
- As versões atuais do loader **bootam sozinhas e nunca expõem `EJS_load`**. Ausência de `EJS_load`
  não é erro. `isEmulatorLoaded()` checa o `<script id="ejs-loader">`, não a global.
- **Nunca recarregue a página quando o boot falha**: o reload cai de volta em `?cartucho=`, que chama
  `loadGame` de novo, e vira loop infinito de reload. Falha de boot preenche `emulatorError`, que a
  UI mostra com opção de tentar de novo.

### Navegação por gamepad
**O estado de alta frequência do loop (`timer`, `ultimoInput`, `focoCache`, `focoIndex`,
`ejectInicio`) vive numa closure em `gamepadModule()`, fora do objeto reativo do Alpine.** O loop
roda a ~60 fps e escrever nessas propriedades através do proxy reativo disparava notificação de
dependências 60 vezes por segundo sem nada na UI depender delas. Só `gamepadConnected` e os dois
toasts são reativos — mantenha assim ao mexer nesse arquivo.

Loop de `requestAnimationFrame` lendo o gamepad 0: fora do jogo move o foco pela UI; dentro do jogo
só vigia o eject (Start + Cima por 3s). Os alvos são elementos com a classe `.nav-item`, restritos ao
modal aberto. A lista fica cacheada por custo de CPU e é invalidada pelos `$watch` de
`registerFocusWatchers()`. **Ao adicionar um modal novo:** registre-o no array de
`registerFocusWatchers()` (app.js), na cadeia de `updateFocusCache()` e em `goBack()` (gamepad.js) —
senão o controle continua navegando pelos elementos atrás do modal.

## Design

`DESIGN.md` é a referência visual e não é decorativo: os valores ali são os únicos
permitidos. O essencial ao mexer no markup:

- **Piso tipográfico de 12px**, e 12px só para rótulo em Silkscreen. Texto de leitura é Inter
  13–14px. **Silkscreen nunca em frase** — é fonte de grade de pixels e, com o tracking do
  estilo, some. Tamanho arbitrário novo (`text-[9px]` e afins) não entra.
- **Alvo de toque de 44×44px.** O ícone continua pequeno; o que cresce é a área clicável.
- **Quatro raios**: `rounded-xl` (controles), `rounded-2xl` (cards), `rounded-3xl` (modais),
  `rounded-full`. Nada além disso.
- **Grade de cartuchos**: 2 / `sm`:3 / `md`:4 / `lg`:5 / `xl`:6.
- Abaixo de `lg` o destaque empilha (arte em cima, texto embaixo) e a barra lateral é gaveta
  com véu clicável.
- As ações `Add_Cartucho` e `Settings` ficam **fora** do `<nav>` rolável, fixas no rodapé da
  barra — dentro dele, sumiam quando a lista de consoles crescia.
- Configurações é **página** (`activePage === 'Settings'`, com `?page=Settings`), não modal.
- **Preview de link é fixo, por decisão.** As meta tags do `index.html` trazem a arte do app
  (`assets/img/og-cover.png`, 1200×630, texto em inglês) e **não podem ficar vazias**: robô de
  rede social não executa JS, então é só isso que ele lê — deixar `og:image` vazio para
  preencher por script derruba o preview inteiro. `page-meta.js` sobrescreve título, descrição
  e imagem com os dados do jogo em runtime, o que vale para a aba, o histórico e a Web Share
  API. Preview com a capa de cada cartucho exigiria algo montando o HTML por CID (um Worker na
  frente do site): foi avaliado e descartado.
- Os textos do preview (`og:*`, `twitter:*`, `description`) são em **inglês**, como a imagem e
  o README; a interface do app segue em português.
- **Todo item de navegação trata `isPlaying`.** As telas do acervo e de configurações vivem
  atrás de `x-show="!isPlaying"`, então trocar `activePage` com o emulador aberto não mostra
  nada: o clique tem que sair do jogo com `stopGame('<destino>')`. Item novo na barra segue a
  mesma regra, senão ele "não funciona" durante o jogo.
- **Ação que exige sair do jogo leva a intenção junto.** Sair é um recarregamento, e o clique
  não sobrevive a ele: `stopGame('Home', { acao: 'importar' })` grava na URL, `initData()`
  executa e limpa o parâmetro. Sem isso o botão apenas fechava o jogo.
- **Modal cabe na tela em qualquer altura.** `max-h-[92vh]` com rolagem interna, cabeçalho e
  barra de ações `sticky`. Abaixo de 700px de altura os espaçamentos comprimem; abaixo de
  420px o decorativo sai (o QR do compartilhar vira só o link). Rótulo de botão precisa caber
  nos 512px do modal — três ações lado a lado não aceitam nomes longos.
- A latência dos gateways é **informação, não recomendação**. O que decide se um gateway
  serve é ter o arquivo, não responder rápido — a corrida já cuida da velocidade sozinha.
  Não volte a sugerir troca de gateway por tempo de resposta.
- Gateway se escolhe e se acrescenta **num lugar só**, a lista da página de configurações.
  Não recrie um campo livre para digitar o gateway preferido: a lista já mostra qual está em
  uso, mede a latência de cada um e recebe os novos.

### Performance (o que já está resolvido, não desfaça)

- **Um único CSS bloqueia render.** `assets/css/app.src.css` é compilado junto do Tailwind em
  `tailwind.css` — não volte a servir dois arquivos.
- **Fontes não bloqueiam render** (`media="print" onload`), e só com os pesos usados: Inter
  400/700, Orbitron 700/900, Silkscreen 400/700.
- **Nenhum placeholder externo.** Capa ausente usa SVG local em data URI; `placehold.co`
  custava uma requisição de rede e quebrava offline.
- CLS medido em 0 — imagens têm proporção reservada. Ao inserir imagem nova, mantenha
  `aspect-ratio` ou `width`/`height`.

Depois de qualquer mudança de markup, rode `npm run css` — as classes novas só existem no CSS
gerado.

## Convenções

- Erros ao usuário: `flashError()` (toast vermelho). **Nunca `alert()`/`confirm()`**: diálogo
  nativo congela a página e o emulador junto — confirmações são modais inline (`pendingDelete`).
- Sucesso: `flashToast(mensagem)` — a mensagem é **obrigatória**. Ela já foi um texto fixo
  reaproveitado por sete ações, e salvar um gateway anunciava "CARTUCHO_COPIED".
- Tokens do Tailwind (`cartucho-*`, `font-retro`/`orbitron`/`arcade`) em vez de hex cru.
- Textos da UI misturam inglês e português; não há camada de i18n.

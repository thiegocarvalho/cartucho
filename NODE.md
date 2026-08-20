# Cartucho Node — desenho

Documento de projeto do **Cartucho Node**: o programa que roda na máquina de quem tem os
jogos. O PWA deste repositório só lê o IPFS; o Node é quem **coloca coisa lá dentro** e
mantém no ar.

O código vai viver em repositório próprio:
**[thiegocarvalho/cartucho-node](https://github.com/thiegocarvalho/cartucho-node)**. Este
arquivo é a semente da documentação de lá e fica aqui enquanto o PWA e o Node forem
desenhados juntos — as mudanças necessárias no PWA estão na seção
[O que muda neste repositório](#o-que-muda-neste-repositório).

Nada aqui está implementado ainda.

---

## 1. O que o Node é

Um binário só, em Go, que sobe quatro coisas ao mesmo tempo:

| Papel | O que faz |
| --- | --- |
| **Nó IPFS** | Kubo embutido como biblioteca. Guarda, fixa e anuncia à rede as ROMs e os manifestos. |
| **Oficina (Studio)** | Varre a pasta `ROMS/`, identifica cada arquivo no OpenVGDB, busca capa e screenshot no libretro-thumbnails e monta o `cartucho.json`. |
| **Servidor HTTP local** | Serve o PWA, a API da oficina e um gateway `/ipfs/` — tudo na **mesma origem**. |
| **Servidor de NetPlay** | Salas do EmulatorJS, onde a sala **é o CID da ROM**: quem tem o mesmo arquivo se encontra. |

### Por que Go

Kubo é Go. Embutir o nó como biblioteca (`kubo/core`, o exemplo `kubo-as-a-library`) evita
supervisionar um processo externo, evita o usuário instalar nada e evita versão de kubo
divergindo por máquina. `modernc.org/sqlite` lê o OpenVGDB sem cgo, então o cross-compile
para Windows, macOS e Linux sai de uma máquina só. O PWA entra por `go:embed`.

O preço aparente é o servidor de NetPlay, que no EmulatorJS é Node.js (`express` +
`socket.io` + `cors`, 274 linhas). Mas ele **não precisa ser reimplementado**: o cliente de
netplay é substituível por um objeto de sete eventos, então o Node fala WebSocket puro e
nunca Socket.IO. Ver [7.2](#não-reimplemente-o-socketio).

O binário fica na casa de 100 MB por causa do kubo. É o custo aceito: o alvo é uma pessoa
publicando um acervo de dezenas de gigabytes, e um download único de 100 MB não é o
obstáculo dessa história.

### Por que uma origem só

O PWA no GitHub Pages é `https:`. Um gateway local é `http://127.0.0.1`. Chrome e Firefox
tratam loopback como origem confiável e não bloqueiam como mixed content; **o Safari
bloqueia**. Servindo o PWA a partir do próprio Node, `fetch('/ipfs/<cid>')` é mesma
origem: não há mixed content, não há CORS, não há gateway para configurar e o `Cache API`
funciona porque `http://localhost` é contexto seguro.

Quem preferir continuar no GitHub Pages continua funcionando — só perde o atalho e cai nas
regras de sempre (ver [seção 8](#8-descoberta-a-partir-do-pwa-hospedado)).

---

## 2. Layout em disco

```
~/Cartucho/                     # --data, configurável
  config.json                   # porta, região preferida, netplay, limites
  cartucho.db                   # SQLite: índice do scan, hashes, estado de cada item
  openvgdb.sqlite               # baixado no primeiro boot (9,1 MB zip → 42 MB)
  ipfs/                         # repo do kubo (blocos, chaves, config)
  media/                        # capas e screenshots baixados, cache por hash da URL
  cartuchos/                    # manifestos gerados, um .json por jogo
  ROMS/
    nes/
    snes/
    segaMD/
    psx/
      bios/                     # scph5500.bin, scph5501.bin, scph5502.bin
    segaCD/
      bios/                     # bios_CD_U.bin, bios_CD_E.bin, bios_CD_J.bin
    segaSaturn/
      bios/                     # saturn_bios.bin
    3do/
      bios/                     # panafz10.bin, …
```

`bios/` é a única subpasta com significado: tudo que estiver lá dentro é BIOS, não jogo, e
o scanner de ROMs a ignora. Ver [seção 5](#5-bios).

**As pastas dentro de `ROMS/` são nomeadas pelos cores do EmulatorJS** (`nes`, `snes`,
`segaMD`, …) — os mesmos 35 nomes de `SUPPORTED_CORES` em `assets/js/config.js`, que é o
que vai para o campo `system` do manifesto. O scanner aceita apelidos sem reclamar
(`NES`, `Nintendo - Nintendo Entertainment System`, `Famicom`, `megadrive`, `genesis`) e
normaliza para o core.

**A pasta é palpite, não lei.** Quem decide o sistema é o hash: o OpenVGDB devolve o
`systemID` junto com o título. Se o arquivo em `ROMS/nes/` casar com um `systemID` de
SNES, o item é marcado como **conflito** e aparece na oficina para a pessoa resolver — não
é movido nem publicado sozinho.

O OpenVGDB não é embutido no binário: são 42 MB que envelhecem sozinhos e podem ser
atualizados sem release nova. Baixa de
`github.com/OpenVGDB/OpenVGDB/releases/latest/download/openvgdb.zip` no primeiro boot.

---

## 3. O pipeline do scan

Cada arquivo de `ROMS/` atravessa sete etapas. O estado de cada um fica em `cartucho.db`,
então parar no meio e recomeçar não refaz trabalho.

```
 arquivo → identidade → hashes → OpenVGDB → mídia → IPFS → manifesto → publicado
```

### 3.1 Identidade local (pular o que não mudou)

Chave `(caminho, tamanho, mtime)`. Igual ao que está no banco, o arquivo é pulado antes de
qualquer leitura. Hashear um acervo inteiro a cada boot custa horas de disco à toa.

### 3.2 Hashes — e a armadilha do cabeçalho

Um passe de leitura só, calculando **MD5, SHA-1 e CRC-32 ao mesmo tempo**.

O detalhe que custa caro se for ignorado: **o OpenVGDB hasheia a ROM sem o cabeçalho do
formato.** A tabela `SYSTEMS` tem a coluna `systemHeaderSizeBytes` justamente para isso:

| Sistema | `systemHeaderSizeBytes` |
| --- | --- |
| NES | 16 (cabeçalho iNES) |
| Atari 7800 | 128 |
| Atari Lynx | 64 |

Conferido contra o banco: `Super Mario Bros. (World).nes` está lá com `romSize` 40960 e
MD5 `8E3630186E35D477231BF8FD50E54CDD`. O arquivo iNES real tem 40976 bytes (16 + 32768 +
8192). Os 16 bytes do cabeçalho **não entram**. O MD5 que o No-Intro publica para o mesmo
arquivo é outro, porque inclui o cabeçalho — usar o valor do No-Intro aqui não casa com
nada.

Portanto: para sistema com `systemHeaderSizeBytes > 0`, calcular **os dois** hashes (o
arquivo inteiro e o arquivo sem os primeiros N bytes) e consultar ambos. É um passe de
leitura só e elimina a classe inteira de "não encontrado" por cabeçalho.

Arquivo comprimido (`.zip`, `.7z`): **hasheia o conteúdo interno, publica o arquivo como
está.** O OpenVGDB indexa a ROM crua, e o EmulatorJS carrega `.zip` sem descompactar antes.
Zip com mais de uma ROM dentro fica marcado como **ambíguo**.

### 3.3 Consulta ao OpenVGDB

Em cascata, parando no primeiro acerto:

1. `romHashMD5` (40.927 dos 51.742 registros têm MD5 — 79%)
2. `romHashSHA1`
3. `romHashCRC`
4. `romFileName` normalizado (minúsculas, sem extensão, pontuação colapsada)

Sem acerto nenhum, o item fica **desconhecido**: entra na oficina com os campos vazios
para preenchimento manual. Não é erro — homebrew, romhack e tradução nunca vão estar no
OpenVGDB, e são exatamente o tipo de coisa que vale a pena publicar num acervo
descentralizado.

O que sai da consulta: `romID`, `systemID`, `romFileName`, `romExtensionlessFileName`
(é ele que resolve a mídia), e do `RELEASES`: `releaseTitleName`, `releaseDescription`,
`releaseGenre`, `releaseDeveloper`, `releasePublisher`, `releaseDate`.

**1.833 ROMs têm mais de um release** (regiões diferentes, edições diferentes). A escolha
segue a preferência de região do `config.json` (padrão `USA > Europe > Japan > World`) e a
oficina deixa trocar. Não há adivinhação silenciosa: o item guarda quais eram as opções.

O `releaseCoverFront` do OpenVGDB aponta para `gamefaqs.gamespot.com` e **não é usado**:
hotlink bloqueado, imagem instável, e nada disso sobrevive num cartucho que precisa
funcionar daqui a dez anos. A mídia vem do libretro (próxima etapa) e é **republicada no
IPFS**.

### 3.4 Mídia — libretro-thumbnails

A URL é montada por convenção, sem API:

```
https://thumbnails.libretro.com/<Playlist>/<Tipo>/<Nome do jogo>.png
```

- `<Playlist>` é o nome libretro do sistema (tabela na [seção 4](#4-a-tabela-de-mapeamento)).
- `<Tipo>` é `Named_Boxarts` (capa), `Named_Snaps` (gameplay), `Named_Titles` (tela de
  título) ou `Named_Logos` (existe, mas é esparso — pasta presente e arquivo 404 é comum).
- `<Nome do jogo>` é o `romExtensionlessFileName` do OpenVGDB, com `&*/:` `` ` `` `<>?\|"`
  trocados por `_`, que é a regra do repositório de thumbnails.

Conferido de ponta a ponta:

```
Nintendo - Nintendo Entertainment System/Named_Boxarts/Super Mario Bros. (World).png  200, 324.871 bytes
Nintendo - Nintendo Entertainment System/Named_Snaps/Super Mario Bros. (World).png    200
Nintendo - Nintendo Entertainment System/Named_Titles/Super Mario Bros. (World).png   200
Nintendo - Nintendo Entertainment System/Named_Logos/Super Mario Bros. (World).png    404
```

O `romExtensionlessFileName` do OpenVGDB casa direto com o nome do arquivo no libretro —
ambos vêm da nomenclatura No-Intro. Essa coincidência é o que torna o pipeline inteiro
viável sem uma tabela de correspondência jogo a jogo.

Cai em `Named_Snaps` quando não há boxart; `Named_Titles` quando não há snap. Sem nenhuma,
o cartucho sai sem `cover` e o PWA já mostra o SVG local de capa ausente.

### 3.5 Entrada no IPFS

Três adições por jogo, cada uma com seu CID:

| Conteúdo | Vira |
| --- | --- |
| a ROM (o arquivo como está em disco) | `rom_cid` |
| a capa (PNG do libretro) | `media.cover` |
| o screenshot | `media.screenshot` |

**A mídia é republicada, não linkada.** Gravar `https://thumbnails.libretro.com/...` no
manifesto seria mais barato e ancoraria o cartucho num servidor centralizado — exatamente
o que o projeto existe para não fazer. `normalizeCartucho()` aceita URL absoluta nesses
campos (`gatewayUrl` devolve a string quando começa com `http`), então funcionaria; é uma
decisão, não uma limitação.

Tudo entra fixado (`pin`). O tamanho do repo é responsabilidade de quem roda o Node — o
Studio mostra o total.

### 3.6 O manifesto

Escrito em `cartuchos/<slug>.json`, adicionado ao IPFS: o CID do JSON **é o cartucho**.

```json
{
  "version": "1.0",
  "name": "Super Mario Bros.",
  "system": "nes",
  "rom_cid": "bafy...rom",
  "bios_cid": null,
  "media": {
    "cover": "bafy...cover",
    "screenshot": "bafy...snap"
  },
  "description": "…",
  "Genres": "Action,Platformer",
  "MaxPlayers": 2,
  "developer": "Nintendo",
  "publisher": "Nintendo",
  "release_date": "September 1985",
  "region": "World",
  "cheats": []
}
```

Os nomes seguem o que `normalizeCartucho()` em `assets/js/library.js` já lê hoje,
maiúsculas incluídas (`Genres`, `MaxPlayers`) — o Node escreve a forma canônica; o PWA
continua tolerando as variantes antigas. Campos que o Node acrescenta e o PWA ainda ignora
(`developer`, `publisher`, `release_date`, `region`) são deliberados: o manifesto é o dado
durável, a interface alcança depois.

`bios_cid` é `null` para quase tudo e obrigatório para PSX, Sega CD, Saturn e 3DO. O PWA
ainda não lê esse campo — é a mudança bloqueante da
[seção 9](#9-o-que-muda-neste-repositório).

### 3.7 Anúncio

`pin` garante que o Node tem; **`provide` na DHT é o que faz os outros acharem**. Fixar
sem anunciar é um acervo invisível: o gateway público só serve o que consegue localizar na
rede.

O reanúncio é periódico (registro de provider na DHT expira em ~24h). Acervo grande faz
disso uma operação cara e demorada — é onde o Node vai gastar rede em regime permanente, e
precisa ser observável na interface, não silencioso.

---

## 4. A tabela de mapeamento

O eixo do projeto inteiro: **core do EmulatorJS ↔ sistema do OpenVGDB ↔ playlist do
libretro**. Levantada e verificada por HTTP contra os dois lados.

`md5s` é quantas ROMs daquele sistema têm MD5 no OpenVGDB — quanto o hash cobre.
`hdr` é o `systemHeaderSizeBytes` (seção 3.2).

| core | OpenVGDB | md5s | hdr | playlist libretro |
| --- | --- | ---: | ---: | --- |
| `nes` | NES (+FDS) | 2.651 (+171) | 16 | Nintendo - Nintendo Entertainment System |
| `snes` | SNES | 3.533 | | Nintendo - Super Nintendo Entertainment System |
| `gb` | GB **+ GBC** | 1.580 + 1.405 | | Nintendo - Game Boy **+** Game Boy Color |
| `gba` | GBA | 2.897 | | Nintendo - Game Boy Advance |
| `vb` | VB | 31 | | Nintendo - Virtual Boy |
| `nds` | NDS | 6.504 | | Nintendo - Nintendo DS |
| `n64` | N64 | 935 | | Nintendo - Nintendo 64 |
| `psx` | PSX | 7.029 | | Sony - PlayStation |
| `psp` | PSP | 3.288 | | Sony - PlayStation Portable |
| `segaMD` | MD | 1.655 | | Sega - Mega Drive - Genesis |
| `segaMS` | SMS | 513 | | Sega - Master System - Mark III |
| `segaGG` | GG | 490 | | Sega - Game Gear |
| `segaCD` | SCD | 254 | | Sega - Mega-CD - Sega CD |
| `sega32x` | 32X | 60 | | Sega - 32X |
| `segaSaturn` | Saturn | 1.328 | | Sega - Saturn |
| `atari2600` | 2600 | 1.723 | | Atari - 2600 |
| `a5200` | 5200 | 106 | | Atari - 5200 |
| `atari7800` | 7800 | 114 | 128 | Atari - 7800 |
| `lynx` | Lynx | 85 | 64 | Atari - Lynx |
| `jaguar` | Jaguar | 59 | | Atari - Jaguar |
| `pce` | PCE | 412 | | NEC - PC Engine - TurboGrafx 16 |
| `coleco` | ColecoVision | 173 | | Coleco - ColecoVision |
| `ws` | WonderSwan **+ Color** | 112 + 95 | | Bandai - WonderSwan **+** WonderSwan Color |
| `ngp` | NGP **+ NGPC** | 10 + 118 | | SNK - Neo Geo Pocket **+** Neo Geo Pocket Color |
| `mame2003` | MAME | **0** | | MAME |
| `arcade` | MAME | **0** | | FBNeo - Arcade Games |
| `3do` | 3DO | **0** | | The 3DO Company - 3DO |
| `pcfx` | PCFX | **0** | | NEC - PC-FX |
| `c64` | C64 | **0** | | Commodore - 64 |
| `c128` | — | — | | Commodore - 64 |
| `plus4` | — | — | | Commodore - Plus-4 |
| `vic20` | — | — | | Commodore - VIC-20 |
| `amiga` | — | — | | Commodore - Amiga |
| `pet` | — | — | | Commodore - PET *(sem `Named_Boxarts`)* |
| `dos` | — | — | | DOS |

**Um core do EmulatorJS pode cobrir mais de um sistema do OpenVGDB.** O core `gb` roda
Game Boy e Game Boy Color; `ws` e `ngp` idem com as versões coloridas; `nes` cobre o
Famicom Disk System. A consulta e a busca de mídia varrem o **conjunto**, e o `system` do
manifesto é o core.

**Onde o hash não serve:**

- **Arcade** (`mame2003`, `arcade`): o OpenVGDB marca MAME como `systemHashless = 1` — são
  10.815 registros e **nenhum MD5**. Arcade se identifica pelo nome do romset
  (`sf2ce.zip`), que é como o MAME sempre funcionou. Casar por nome de arquivo aqui não é
  gambiarra, é o método certo.
- **3DO, PC-FX, C64**: sistema existe na tabela, zero ROMs cadastradas.
- **c128, plus4, vic20, amiga, pet, dos**: fora do OpenVGDB. Só metadado manual, com a
  mídia ainda resolvível pelo libretro quando o nome bater.

Nesses casos a oficina não finge que sabe: cai direto no formulário.

---

## 5. BIOS

PSX, Sega CD, Saturn e 3DO não bootam sem BIOS. O EmulatorJS recebe **uma URL só**
(`EJS_biosUrl`, um arquivo), então o Node precisa **escolher qual BIOS** cada cartucho
leva — e escolher certo, porque BIOS de região errada não roda o jogo.

### 5.1 A pasta

```
ROMS/<core>/bios/
```

Tudo dentro de `bios/` é BIOS, não jogo: o scanner de ROMs ignora a pasta e um scanner
próprio a percorre. As BIOS **não viram cartucho** e não aparecem na biblioteca; entram no
IPFS como blob avulso, fixado, e o CID é reaproveitado por todos os cartuchos daquele
sistema e região. Uma BIOS de PSX na rede, dezenas de cartuchos apontando para ela.

### 5.2 Identificação — por MD5, contra tabela embutida

Diferente das ROMs, aqui não há OpenVGDB: a tabela vem da própria documentação do
EmulatorJS e fica **embutida no binário**. São poucos arquivos e eles não mudam.

**PlayStation** (`ROMS/psx/bios/`) — a escolha é por região do jogo:

| arquivo | região | MD5 |
| --- | --- | --- |
| `scph5500.bin` | JP | `8dd7d5296a650fac7319bce665a6a53c` |
| `scph5501.bin` | US | `490f666e1afb15b7362b406ed1cea246` |
| `scph5502.bin` | EU | `32736f17079d0b2b7024407c39bd3050` |

A doc lista ainda `PSXONPSP660.bin`, `scph101.bin`, `scph7001.bin` e `scph1001.bin` como
alternativas — aceitas, mas nunca escolhidas sozinhas quando existir a BIOS da região.

**Sega CD** (`ROMS/segaCD/bios/`) — também por região:

| arquivo | região | MD5 |
| --- | --- | --- |
| `bios_CD_U.bin` | US | `2efd74e3232ff260e371b99f84024f7f` |
| `bios_CD_E.bin` | EU | `e66fa1dc5820d254611fdcdba0662372` |
| `bios_CD_J.bin` | JP | `278a9397d192149e84e820ac621a8edd` |

**Saturn** (`ROMS/segaSaturn/bios/`) — uma só, sem decisão a tomar:

| arquivo | MD5 |
| --- | --- |
| `saturn_bios.bin` | `af5828fdff51384f99b3c4926be27762` |

**3DO** (`ROMS/3do/bios/`) — dez variantes de modelo, nenhuma ligada a região:

| arquivo | modelo | MD5 |
| --- | --- | --- |
| `panafz1.bin` | Panasonic FZ-1 | `f47264dd47fe30f73ab3c010015c155b` |
| `panafz10.bin` | Panasonic FZ-10 | `51f2f43ae2f3508a14d9f56597e2d3ce` |
| `panafz10-norsa.bin` | FZ-10, patch RSA | `1477bda80dc33731a65468c1f5bcbee9` |
| `panafz10e-anvil.bin` | FZ-10-E Anvil | `a48e6746bd7edec0f40cff078f0bb19f` |
| `panafz10e-anvil-norsa.bin` | FZ-10-E Anvil, patch RSA | `cf11bbb5a16d7af9875cca9de9a15e09` |
| `panafz1j.bin` | Panasonic FZ-1J | `a496cfdded3da562759be3561317b605` |
| `panafz1j-norsa.bin` | FZ-1J, patch RSA | `f6c71de7470d16abe4f71b1444883dc8` |
| `goldstar.bin` | Goldstar GDO-101M | `8639fd5e549bd6238cfee79e3e749114` |
| `sanyotry.bin` | Sanyo IMP-21J TRY | `35fa1a1ebaaeea286dc5cd15487c13ea` |
| `3do_arcade_saot.bin` | Shootout At Old Tucson | `8970fc987ab89a7f64da9f8a8c4333ff` |

Padrão do 3DO: `panafz10.bin`, que é a mais compatível. Trocável na oficina, por cartucho.

**O nome do arquivo não decide nada — o MD5 decide.** BIOS circula com nome trocado o
tempo todo; `psx_bios.bin` pode ser qualquer uma das três. O Node hasheia, identifica pela
tabela, e **renomeia para o nome canônico** ao publicar. Arquivo que não bate com nenhum
MD5 conhecido fica listado como *BIOS não reconhecida* e não é usado — BIOS errada não dá
erro claro, dá tela preta, e depurar isso do lado de quem só recebeu um link é impossível.

### 5.3 Como a região é escolhida

Para PSX e Sega CD, a região sai do próprio OpenVGDB: a tabela `ROMs` tem `regionID` e a
`RELEASES` traz `TEMPregionLocalizedName`. Jogo identificado como USA leva `scph5501.bin`;
Europe leva `scph5502.bin`; Japan leva `scph5500.bin`.

Quando a região não estiver clara (jogo desconhecido, `World`, multi-região), cai na
preferência de região do `config.json` — a mesma que resolve release ambíguo (seção 3.3) —
e o item é marcado para revisão em vez de sair publicado com um palpite silencioso.

Faltando a BIOS da região certa na pasta, o cartucho **não é publicado**: fica pendente com
a mensagem dizendo qual arquivo falta e qual MD5 ele precisa ter. Publicar um cartucho de
PSX sem BIOS é publicar um card que nunca abre, e o defeito só aparece na máquina de outra
pessoa.

### 5.4 Jogos multi-arquivo

O outro caso que quebra "um arquivo = um jogo": disco (PSX, Saturn, Sega CD, 3DO) é `.cue`
mais um ou mais `.bin`, e o Redump hasheia as trilhas, não o `.cue`.

Decisão v1: **a pasta do jogo é empacotada num único `.zip`**, que é o que o EmulatorJS
carrega, e o hash usado na consulta é o do maior `.bin`. Diretório IPFS com os arquivos
soltos — mais elegante, permitiria baixar trilha por trilha — fica para depois, porque
`EJS_gameUrl` aponta para um arquivo, não para um diretório.

---

## 6. HTTP local: uma porta, três serviços

Porta padrão **8787** (`--port`), em `127.0.0.1`. Não escuta na rede por padrão: quem
quiser servir a casa inteira liga explicitamente.

```
GET  /                          o PWA (go:embed)
GET  /ipfs/<cid>                gateway — proxy do kubo, mesma origem
GET  /routing/v1/providers/<cid>  roteamento delegado (seção 7.5) — proxy do kubo
GET  /cartucho/v1/status        versão, PeerID, kubo no ar, contadores
GET  /cartucho/v1/library       cartuchos publicados por este Node
POST /cartucho/v1/scan          dispara o scan
GET  /cartucho/v1/scan/events   progresso (SSE) — arquivo atual, fase, totais
GET  /cartucho/v1/items         itens do scan, filtráveis por estado
PATCH /cartucho/v1/items/{id}   correção manual (título, sistema, release, mídia)
POST /cartucho/v1/items/{id}/publish
GET  /cartucho/v1/netplay       estado do servidor de sinalização
POST /cartucho/v1/netplay       liga/desliga
```

O kubo escuta só no loopback, em portas efêmeras: a API dele (`/api/v0`) **não é
exposta** — quem tem acesso à API do kubo tem acesso a tudo, e servir isso a partir de uma
página é entregar a chave. O gateway é proxiado com uma lista do que pode passar.

O `/ipfs/` responde apenas `GET` e `HEAD`, com `Cache-Control: public, immutable` — CID é
hash de conteúdo, não existe invalidação.

A oficina é uma página a mais dentro do PWA (`?page=Studio`), seguindo a regra do
`DESIGN.md`: configurações e About são páginas, não modais, e página fixa nova entra em
`PAGINAS_FIXAS`. O Studio só aparece quando `/cartucho/v1/status` responde.

### Biblioteca do Node × biblioteca do navegador

O acervo do PWA vive no `localStorage`, que é **por origem**. Quem já usa o app no GitHub
Pages e instala o Node abre `localhost:8787` e vê a biblioteca vazia — o dado está na
outra origem e não há como cruzar isso pelo navegador.

Como fica: o PWA servido pelo Node **mescla** o `localStorage` com o que vem de
`/cartucho/v1/library`, tratando o Node como fonte adicional, não como substituto. Para
trazer o acervo antigo, o export/import de arquivo JSON que já existe resolve. Nada disso
é automático e o Studio precisa dizer isso em uma frase, senão parece perda de dados.

---

## 7. NetPlay

### 7.1 A sala é o CID

`EJS_gameID` passa a ser o hash numérico do **`rom_cid`**, e não do CID do manifesto como
hoje (`gameIdNumerico(game.cartucho)` em `emulator.js`).

Isso é mais do que um ajuste: **a sala passa a ser o arquivo.** O EmulatorJS lista salas
por `game_id`, então duas pessoas se encontram exatamente quando têm o mesmo binário —
independente de terem chegado nele por manifestos diferentes, capas diferentes ou títulos
em idiomas diferentes. Como CID é hash de conteúdo, a garantia é criptográfica, não
convencional: não existe "mesma sala, ROM ligeiramente diferente", que é a origem clássica
de dessincronização em netplay de emulador.

O `EJS_gameID` também separa saves e save states, então a troca zera os saves de quem já
usa o app. **Decidido que não é problema** — a quebra é única e quanto antes acontecer,
menos gente atinge.

### 7.2 O servidor

O oficial (`EmulatorJS/EmulatorJS-Netplay`) é um `server.js` de 274 linhas: `express` +
`socket.io` + `cors`, salas em memória, faxina a cada 60s. Ele atende **dois clientes
diferentes ao mesmo tempo**, e essa distinção é o eixo da próxima seção:

- `data-message`, `input`, `snapshot` — **relé**: o servidor repassa o tráfego de jogo.
- `webrtc-signal` — **sinalização**: o servidor só apresenta os pares, que depois falam
  direto por WebRTC.

Superfície a reproduzir em Go:

- `GET /list?game_id=<n>` → salas abertas daquele jogo (`room_name`, `current`, `max`,
  `player_name`, `hasPassword`)
- eventos Socket.IO: `open-room`, `join-room`, `leave-room`, `users-updated`,
  `data-message`, `input`, `snapshot`, `webrtc-signal`, `disconnect`; herança de dono
  quando o host sai (com `requestRenegotiate`)

#### Não reimplemente o Socket.IO

Era este o maior risco técnico do projeto — fidelidade ao protocolo do Socket.IO v4, que
tem handshake, upgrade de transporte, pacotes numerados e reconexão. E a
[seção 7.5](#o-gancho-no-emulatorjs--pequeno-e-existe) o dissolve: o EmulatorJS expõe
`window.EJS_emulator`, e toda a rede do netplay vive em duas propriedades sobrescrevíveis
da instância (`netplay.startSocketIO` e `netplay.getOpenRooms`), consumindo um objeto de
**sete eventos e um método**.

Então o Node **não fala Socket.IO**: fala WebSocket puro, com um protocolo próprio de uma
linha por mensagem, e o PWA entrega ao EmulatorJS um objeto com a forma que ele espera.
Menos trabalho que reimplementar o protocolo, sem risco de incompatibilidade, e — o que
decide — **é a mesma peça que a 7.5 vai precisar**: trocar o transporte de WebSocket por
libp2p depois é mexer só do lado de dentro do shim. Não é trabalho descartável, é a
primeira metade do destino.

O preço: quem apontar o PWA para um servidor de netplay de terceiro (o oficial, ou o de um
amigo) continua precisando do caminho Socket.IO. Os dois convivem — o shim escolhe pelo
endereço configurado.

### 7.3 TURN: por que não resolve o que parece resolver

**O build `stable`, que este projeto usa, não tem WebRTC.** Verificado no
`emulator.min.js` servido pelo CDN: zero ocorrências de `RTCPeerConnection` e de
`iceServers`; os eventos são `data-message`, `sync-control` e `input`. O netplay do
`stable` é **relé puro por socket.io** — todo o tráfego de jogo passa pelo servidor. Não
há conexão par a par para o TURN intermediar. O `loader.js` do `stable` nem lê
`EJS_netplayICEServers`; só o do `main` lê.

E mesmo trocando para o build com WebRTC, o TURN continua não resolvendo o problema que
temos. TURN conserta o **caminho entre os pares**. O que está atrás de NAT aqui é o
**ponto de encontro** — o servidor de sinalização, dentro do Node, na casa de alguém. Os
dois navegadores precisam alcançá-lo *antes* de existir qualquer candidato ICE para o TURN
retransmitir. TURN é complemento da sinalização, nunca substituto.

Some-se que trocar `stable` por `latest`/`main` custa caro por outro motivo: o `CLAUDE.md`
registra que foi exatamente isso que quebrou o save state aqui — `gameManager.getState()`
estourando com `EmulatorJSGetState is not a function`.

### 7.4 IP direto, porta aberta por UPnP

O caminho escolhido: **o Node abre a própria porta e é acessado pelo endereço dele**.
Nenhum intermediário no caminho do jogo, latência mínima, e o túnel volta a ser o que
deveria ter sido desde o início — o plano B de quem está atrás de CGNAT.

A montagem tem três peças, e a terceira é a que faltava:

```
1. UPnP abre a porta      IPv4 por AddPortMapping, IPv6 por AddPinhole
2. o Node descobre o IP   pelo próprio roteador, sem serviço externo
3. AutoTLS dá o HTTPS     certificado válido e hostname estável, sem cadastro
```

#### 7.4.1 Abrir a porta — e por que IPv4 e IPv6 não são o mesmo pedido

Os dois passam pelo UPnP, mas por serviços diferentes, e a diferença importa:

| | IPv4 | IPv6 |
| --- | --- | --- |
| o que existe entre você e o mundo | NAT | firewall |
| serviço UPnP | `WANIPConnection` (IGD v1) | `WANIPv6FirewallControl` (IGD v2) |
| ação | `AddPortMapping` | `AddPinhole` |
| suporte em roteador doméstico | amplo | irregular |

Em IPv4 se pede **tradução**: "encaminhe a porta externa 3000 para mim". Em IPv6 não há o
que traduzir — o endereço já é global — e o que se pede é **um furo no firewall** para
aquela porta. São chamadas SOAP distintas em serviços distintos do mesmo IGD.

A boa notícia para o IPv6: **muitas vezes não é preciso pedir nada.** Boa parte dos CPEs
não filtra entrada em IPv6, e aí basta escutar. O Node testa antes de pedir: se a porta já
responde de fora, não mexe no roteador.

O `goupnp` cobre os dois lados — `WANIPConnection{1,2}.AddPortMapping` /
`GetExternalIPAddress` / `DeletePortMapping` e `WANIPv6FirewallControl1.AddPinhole` /
`CheckPinholeWorking` / `DeletePinhole`. E há sinergia com o que já está embarcado: **o
Kubo já faz mapeamento UPnP para a porta de swarm dele** (`Swarm.DisableNatPortMap`), então
a relação com o roteador já existe no processo.

**Detecção de CGNAT, de graça.** `GetExternalIPAddress` devolve o IP que o *roteador* acha
que tem. Se esse endereço cair em `100.64.0.0/10` (ou num range privado), o assinante está
atrás de CGNAT: o mapeamento até é aceito pelo roteador, mas não serve para nada, porque a
porta pública fica com a operadora. Comparar contra essas faixas transforma um "abriu, mas
ninguém conecta" em um diagnóstico claro — e é o gatilho automático para descer ao túnel.

**Endereço IPv6: cuidado com o temporário.** Com privacidade de SLAAC (RFC 4941) a máquina
tem um endereço estável e um temporário que rotaciona a cada poucas horas. Anunciar o
temporário é publicar um link que morre sozinho. O Node escolhe o **global unicast estável**
(`2000::/3`, nunca `fe80::/10` de link-local nem `fc00::/7` de ULA).

Abrir porta em silêncio não é aceitável. É ação explícita no Studio, com prazo de locação
(`NewLeaseDuration`), e o Node remove o mapeamento e o pinhole ao sair — muitos roteadores
ignoram o prazo e deixam permanente, então a remoção explícita é o que de fato fecha.

E não esqueça do firewall **local**: abrir no roteador não abre no Windows. A primeira
escuta na porta dispara o diálogo do Defender, e o Studio precisa avisar antes, senão o
usuário nega no susto e passa a semana achando que o UPnP falhou.

#### 7.4.2 O problema do `https:` — e o AutoTLS

O buraco desse caminho sempre foi o esquema. `http://187.1.2.3:3000` é bloqueado como
mixed content por qualquer PWA servido em `https:`, e IP público **não** tem a isenção que
`localhost` tem. Certificado para IP não existe, e certificado para domínio exige domínio —
ou seja, cadastro. Era isso que empurrava para o túnel.

**O Kubo resolve isso sozinho, e sem cadastro.** O `AutoTLS` faz um nó publicamente
alcançável obter um **certificado curinga do Let's Encrypt** para
`*.{PeerID}.libp2p.direct`, via desafio ACME DNS-01 intermediado pelo `p2p-forge` — serviço
público mantido pela Interplanetary Shipyard. A própria documentação diz: *"without
requiring user to do any manual domain registration and certificate configuration"*.

E o encaixe com o UPnP é literal, escrito na doc do Kubo: *"This feature requires a
publicly reachable node. If behind NAT, manual port forwarding or UPnP
(`Swarm.DisableNatPortMap=false`) is required."* Primeiro abre a porta, depois nasce o
certificado.

O nome **carrega o IP**, com os separadores virando traço:

```
1-2-3-4.<PeerID>.libp2p.direct                → A     1.2.3.4
2804--14d-1--1.<PeerID>.libp2p.direct         → AAAA  2804::14d:1::1
```

Duas consequências ótimas:

- **IPv6 é atendido pelo mesmo mecanismo** — A e AAAA, mesma convenção, mesmo certificado.
- **IP dinâmico não invalida nada.** O certificado é curinga sobre `*.{PeerID}`, e o PeerID
  é permanente; mudou o IP, muda só o rótulo da esquerda. É a diferença exata para o plano
  livre do `localhost.run`, cujo domínio muda a cada poucas horas e leva o link junto.

Como o Node embute o Kubo, o material do certificado fica em `$IPFS_PATH/p2p-forge-certs` e
pode servir o **listener HTTPS do netplay** na mesma máquina — o curinga vale para qualquer
porta daquele hostname. Alternativa mais limpa: usar o cliente do `p2p-forge` direto, com
`certmagic`, e emitir o certificado para uso próprio em vez de tomar emprestado do Kubo.

Custos honestos: a primeira emissão leva **5–15 minutos** mais o `RegistrationDelay`, há
limite de emissão do Let's Encrypt, e o serviço é infraestrutura de terceiro — de bem
melhor procedência que um túnel gratuito, mas terceiro. E o hostname **contém o seu IP**,
que é inerente a conexão direta: quem entra na sala sabe onde você está. Isso é verdade
para qualquer par a par e precisa estar escrito na tela, não escondido.

#### 7.4.3 O que quebra no PWA hoje

Testei `parseNetplayServer()` (`emulator.js`) com as formas que este caminho produz:

| entrada | resultado hoje |
| --- | --- |
| `192.168.1.10:3000` | `https://192.168.1.10:3000/` — **força `https:`**, não conecta |
| `http://192.168.1.10:3000` | ok |
| `[2804:14d:1::1]:3000` | **`Invalid address.`** |
| `http://[2804:14d:1::1]:3000` | **`Invalid address.`** |

O IPv6 é rejeitado **em qualquer forma**, inclusive com esquema explícito, por causa de
`!url.hostname.includes('.')`: literal IPv6 não tem ponto. Enquanto isso não mudar, o
caminho IPv6 não existe para o usuário. Entra na [seção 9](#9-o-que-muda-neste-repositório).

O padrão embutido do EmulatorJS também não socorre ninguém: o bundle cai em
`this.config.netplayUrl || "https://netplay.emulatorjs.org"`, e esse servidor **responde
525** (falha de handshake TLS na borda da Cloudflare). Contar com ele seria contar com um
serviço fora do ar.

Um alívio: o `stable` normaliza a URL (`while (url.endsWith("/")) url = url.slice(0,-1)`)
antes de montar `"/list?…"`, então a barra final que o `parseNetplayServer` acrescenta não
vira `//list`.

#### 7.4.4 Quando nada disso funciona

Sobra o túnel reverso, e só aí. Sem cadastro, duas opções: **`localhost.run` por SSH**
(`ssh -R 80:localhost:3000 nokey@localhost.run` — `nokey` pula a checagem de chave; HTTPS
automático; no plano livre o domínio muda a cada poucas horas e há limite de velocidade) e
**TryCloudflare** (`cloudflared tunnel --url …`, sem conta, *"for testing and development
only"*, sem SLA, teto de 200 requisições simultâneas).

Implementação sem virar dois binários: `localhost.run` fala SSH puro, e
`golang.org/x/crypto/ssh` faz encaminhamento remoto nativo — `client.Listen("tcp", …)`
emite o `tcpip-forward`, que é o `-R`. São dezenas de linhas dentro do binário que já
existe. Detalhe que morde: a resposta do `tcpip-forward` devolve porta, não hostname; o
`localhost.run` aceita `-- --output json` para entregar a URL de forma legível por máquina.

O túnel fica **desligado por padrão** e cai junto com o netplay. E **só a porta de
sinalização o atravessa** — nunca o Studio, nunca a API do kubo, nunca o gateway.

#### 7.4.5 A ordem, e o que o Studio mostra

```
1. LAN                    mDNS/IP local — sem configuração, cobre o caso mais comum
2. IPv6 direto            testa alcance; pinhole por UPnP só se precisar
3. IPv4 + UPnP            AddPortMapping; CGNAT detectado por GetExternalIPAddress
4. AutoTLS por cima       vira https://…libp2p.direct, some o mixed content
5. Túnel reverso          plano B de CGNAT, sem cadastro
6. libp2p (seção 7.5)     o destino, sem servidor nenhum
```

Cada degrau é testado, não suposto, e o Studio diz qual pegou e o que ele custa — em vez de
prometer "netplay pela internet" e deixar a pessoa descobrir sozinha por que não conecta.

Em versões: **v1** faz 1, 2, 3 e 5, com o `?netplay=` no link de convite para o amigo não
ter que digitar endereço na mão (aceito só com confirmação — é apontar o navegador dele
para um servidor). **v2** traz o AutoTLS, que é o que libera usar o PWA do GitHub Pages
junto com Node de casa. **v3** é WebRTC com STUN/TURN, e **v4** é a seção 7.5.

### 7.5 O libp2p como lobby

O nó IPFS embutido já faz, para as ROMs, exatamente as duas coisas que um servidor de
netplay faz para as salas: **anunciar que alguém tem uma coisa** e **pôr dois pares em
contato**. Reaproveitar isso elimina o servidor de netplay inteiro — nada de socket.io,
nada de porta 3000, nada de túnel.

#### O anúncio

A sala é derivada da ROM:

```
sala_cid = CID(sha256("cartucho/netplay/1" + rom_cid))
```

Quem abre a sala dá `provide(sala_cid)` na DHT — a **mesma** chamada que já faz o cartucho
ser encontrável. Quem procura partida dá `findProviders(sala_cid)` e recebe os PeerIDs de
quem está jogando aquele binário. Não há serviço de matchmaking, não há lista central, não
há domínio para expirar: o lobby é a DHT do IPFS, que já está no ar e já é mantida por
dezenas de milhares de nós.

Vale notar o que **não** funciona: usar `findProviders(rom_cid)` direto. Isso devolve quem
*tem* o arquivo, que é outra pergunta — a maioria dos provedores é gateway e nó de
arquivamento, não gente esperando para jogar. O CID derivado separa "tenho" de "quero
jogar agora" sem custo nenhum.

**A DHT é lenta demais para ser o lobby sozinha.** Um `provide` leva de segundos a dezenas
de segundos para alcançar os ~20 pares mais próximos da chave, e o registro expira em ~24h.
Isso serve para "existe alguém jogando isto no mundo", não para "entrei na sala agora".
Então são duas camadas, ambas já dentro do nó:

- **gossipsub**, tópico `/cartucho/netplay/1/<rom_cid>` — presença ao vivo: entrar, sair,
  anunciar sala com nome e vagas. Instantâneo, e os pares do tópico se descobrem entre si.
- **DHT** — o lastro: sobrevive a quem estava online e permite achar partida em jogo
  obscuro sem ninguém do tópico por perto.

#### O contato

Confirmado na documentação do `js-libp2p`: **navegador não escuta em porta nenhuma**, então
`webrtc-direct` está fora e a conexão navegador↔navegador usa o transporte `/webrtc`, que
**troca o SDP por um circuit relay**. Fechado o par, "o relay não participa mais da troca"
— o jogo anda direto.

Isto é o ponto honesto da seção: **a exigência de alguém alcançável não desaparece, ela
muda de lugar.** Sai de "o Node de quem hospeda precisa estar acessível" e vai para
"qualquer relay da rede precisa estar acessível". A diferença é grande a favor:

- relay é infraestrutura compartilhada, não configuração por usuário — a rede pública do
  IPFS já tem relays, e o projeto pode subir o seu por muito pouco, já que ele carrega
  handshake e não jogo;
- **um Node com endereço público vira relay para os outros** de graça, e reserva de
  circuit relay v2 é curta de propósito, justamente para segurar até o hole punching
  (DCUtR) fechar a conexão direta;
- quem está na mesma LAN se acha pelo mDNS do próprio libp2p e não usa relay nenhum.

#### O gancho no EmulatorJS — pequeno, e existe

Era o risco real desta ideia, e ele é menor do que parecia. Duas descobertas no bundle do
`stable`:

**A instância é global.** O `loader.js` faz `window.EJS_emulator = new EmulatorJS(...)` —
tanto no `stable` quanto no `main`.

**A superfície de rede é minúscula e fica em propriedades da instância**, sobrescrevíveis
depois de construída:

| propriedade | o que faz |
| --- | --- |
| `EJS_emulator.netplay.startSocketIO` | monta `this.netplay.socket = io(url)` |
| `EJS_emulator.netplay.getOpenRooms` | `fetch(url + "/list?domain=…&game_id=…")` |

E o objeto `socket` inteiro que o EmulatorJS consome são **sete eventos e um método**:

- `emit("open-room", …)`, `emit("join-room", …)`, `emit("data-message", …)`
- `on("connect")`, `on("disconnect")`, `on("users-updated")`, `on("data-message")`
- `disconnect()`

Ou seja: **não é preciso forkar o EmulatorJS.** Basta entregar a ele um objeto com essa
forma, com `emit`/`on` ligados a um stream libp2p, e trocar `getOpenRooms` por uma consulta
ao lobby. O `socket.io` continua embutido no bundle e simplesmente não é usado — `io` é
interno ao bundle, não existe `window.io`, então a substituição tem que ser por essas duas
propriedades, e não interceptando o `io()`.

Topologia: o `data-message` do servidor atual é difusão para a sala
(`socket.to(sessionId).emit`), com o host como autoridade. O equivalente em libp2p é
**estrela com o host no centro** — o host recebe de cada convidado e repassa aos demais.
Manter a mesma topologia é o que garante que a semântica de sincronização do EmulatorJS
continue valendo.

#### O custo

**`js-libp2p` no navegador.** Com WebRTC, gossipsub e roteamento delegado, é da ordem de
grandeza das bibliotecas que o projeto já trata com desconfiança — o Play CDN do Tailwind
(440 KB) foi removido e o `qrcodejs`/`html5-qrcode` (385 KB) são carregados sob demanda.
Aqui a regra é a mesma e o encaixe é perfeito: **carregar só ao abrir o netplay**, pelo
`vendor.js`, do mesmo jeito que o leitor de QR.

**A DHT não é acessível do navegador.** Sem TCP, o navegador não faz consulta à DHT — usa
roteamento delegado por HTTP. E aqui a arquitetura fecha sozinha: o Kubo expõe
`/routing/v1` (spec `http-routing-v1`) na porta do gateway pelo
`Gateway.ExposeRoutingAPI`, que vem **ligado por padrão**. O PWA servido pelo Node consulta
`/routing/v1/providers/<sala_cid>` na **própria origem** — sem terceiro, sem CORS, sem
serviço externo de roteamento. É mais um argumento para o PWA vir do Node
([seção 1](#por-que-uma-origem-só)).

Quem abre o PWA no GitHub Pages sem Node fica com o caminho de sempre: servidor de netplay
configurado à mão.

#### Resumo

Sim, dá para anunciar o multiplayer com o mesmo libp2p do IPFS, e é o destino certo da
arquitetura: o lobby vira DHT + gossipsub, o servidor de netplay deixa de existir e o
alcance passa a ser problema compartilhado da rede em vez de configuração de roteador de
cada um. **Não é v1** — depende de sair do `stable`, de embarcar `js-libp2p` no navegador e
de um transporte novo escrito do zero. Mas nada disso esbarra em impedimento técnico, e os
dois ganchos de que depende foram verificados e existem.

---

## 8. Descoberta a partir do PWA hospedado

Quem abrir o PWA no GitHub Pages continua funcionando sem Node. Se quiser usar o Node de
lá, o app tenta `http://127.0.0.1:8787/cartucho/v1/status` no boot e, respondendo, oferece
o gateway local.

Duas ressalvas que precisam estar na tela, não no código:

- **Safari bloqueia** requisição `http://127.0.0.1` a partir de página `https:`. Chrome e
  Firefox não. Para Safari, o caminho é abrir `http://localhost:8787` direto.
- O gateway local precisa mandar `Access-Control-Allow-Origin` para a origem do Pages,
  e nada mais — o resto da API fica fora do CORS.

Por isso a recomendação principal é usar o PWA servido pelo próprio Node. A descoberta é
conveniência, não a arquitetura.

---

## 9. O que muda neste repositório

O Node depende de mudanças no PWA. Os três itens bloqueantes **já estão feitos**; os
demais são a jusante do Node — consomem a API dele, então não têm como existir antes.

### Feito

1. **`bios_cid` no manifesto.** `normalizeCartucho()` (`library.js`) passa a ler
   `data.bios_cid`; `configureEmulator()` (`emulator.js`) passa a setar `EJS_biosUrl` com a
   URL do gateway. Sem isso, cartucho de PSX, Sega CD, Saturn ou 3DO vira card que nunca
   abre. **Bloqueante** — e vale registrar que `EJS_biosUrl` já está em
   `applyEmulatorDefaults()` como string vazia, então é só passar a preenchê-lo.
2. **`EJS_gameID` a partir do `rom_cid`** (seção 7.1). Uma linha em `configureEmulator()`:
   `gameIdNumerico(game.rom)` no lugar de `gameIdNumerico(game.cartucho)`. Zera os saves de
   quem já usa o app — **decidido que não é problema**, quanto antes melhor.
3. **`parseNetplayServer()` aceitar IPv6 e não forçar `https:`** (`emulator.js`, seção
   7.4.3). Hoje `[2804:14d:1::1]:3000` é recusado como `Invalid address.` **mesmo com
   esquema explícito**, porque a validação é `!url.hostname.includes('.')` e literal IPv6
   não tem ponto; e endereço sem esquema vira `https://`, que não conecta em porta de LAN.
   Enquanto isso não mudar, o caminho IPv6 não existe para o usuário. **Bloqueante para o
   netplay por IP.**
Junto do item 3 apareceu um segundo defeito no mesmo lugar, corrigido na mesma passada:
`https:` como padrão **não serve para IP**. `192.168.1.10:3000` virava `https://` e não
conectava, sem explicação na tela. Agora IP literal (v4 ou v6) assume `http:` e hostname
continua assumindo `https:` — que é o que o AutoTLS (seção 7.4.2) vai precisar. IPv6
digitado sem colchetes é embrulhado automaticamente.

### Depende do Node existir

4. **Página Studio** (`?page=Studio`, entrada em `PAGINAS_FIXAS`, item no menu tratando
   `isPlaying` com `stopGame('Studio')`), visível só quando o Node responde.
5. **Fonte de acervo além do `localStorage`**: mesclar `/cartucho/v1/library` (seção 6).
6. **Campos novos do manifesto** — `developer`, `publisher`, `release_date`, `region` —
   gravados pelo Node e passíveis de exibição no card. Sem pressa.
7. **`LOCAL_GATEWAY` em `config.js`** aponta para `127.0.0.1:8080` (kubo cru). Vira
   `127.0.0.1:8787/ipfs/`, que é a porta do Node.

### Lacuna conhecida, não bloqueante

`entradaUtilizavel()` não exige `bios`, então um cartucho de PSX sem ela entra na
biblioteca e falha no boot com erro obscuro. O Node **recusa publicar** nessa condição
(seção 5.3), então o caso só surge com cartucho de terceiro. Vale uma checagem antes de
`bootEmulator()` — "this game needs a BIOS" é uma frase melhor que tela preta —, mas não
segura nada.

---

## 10. Fora do escopo da v1

- Diretório IPFS para jogo multi-trilha (v1 empacota em `.zip`).
- Publicar o acervo inteiro como uma coleção sob IPNS. Natural e desejável — o CID da
  coleção seria o "meu acervo" compartilhável —, mas o IPNS tem propagação lenta o
  bastante para virar assunto próprio.
- Sincronizar saves entre máquinas.
- Baixar cartucho de terceiro para republicar (mirror). O Node fixa o que ele mesmo
  produziu; refixar CID alheio é um botão pequeno com implicações grandes.
- Interface fora do navegador (bandeja, janela nativa).

---

## 11. Decisões que ainda não estão tomadas

- **Nome do executável e da pasta de dados.** `cartucho` e `~/Cartucho/` são o palpite;
  `~/.cartucho` é mais convencional em Unix e pior de achar para quem vai jogar ROM lá
  dentro. A pasta é para uso humano — o palpite ganha, mas não está fechado.
- **Como o Node se comporta ao fechar.** Sair mata os pins do ar. Serviço de sistema
  (systemd/launchd/Serviço do Windows) é o certo, e é trabalho por plataforma.
- **Limite de disco do repo IPFS.** O PWA já resolveu esse problema para o cache de ROMs
  com controle deslizante limitado pela quota real; o Node tem o disco inteiro e nenhuma
  quota para consultar.
- **Reanúncio na DHT** com acervo grande: quanto custa de banda por dia, e se dá para
  fazer em lotes sem virar o assunto principal do processo.
- **Dá para servir o netplay com o certificado do AutoTLS?** (seção 7.4.2) O curinga
  `*.{PeerID}.libp2p.direct` vale para qualquer porta daquele hostname, e o material fica em
  `$IPFS_PATH/p2p-forge-certs` — mas ler o certificado do repo do Kubo é depender de um
  detalhe interno dele. Usar o cliente do `p2p-forge` com `certmagic` e emitir por conta
  própria é mais limpo e é o que precisa ser testado. Também não está medido quanto do
  parque de roteadores realmente responde `AddPinhole`.
- **O `localhost.run` passa WebSocket?** (seção 7.4.4) Decide se o plano B de CGNAT serve
  para netplay: sem WebSocket o socket.io cai em long-polling e a latência fica
  indefensável. Não está na documentação deles — só teste responde.

---

## 12. Por onde começar

A ordem abaixo é escolhida para **descobrir cedo o que pode estar errado**. Cada passo
produz uma resposta que os seguintes dependem, e os dois primeiros não escrevem uma linha
de Go.

### Passo 1 — as três mudanças bloqueantes no PWA

`bios_cid`, `EJS_gameID` a partir do `rom_cid` e `parseNetplayServer()` aceitando IPv6
(itens 1 a 3 da [seção 9](#9-o-que-muda-neste-repositório)). São poucas linhas, ficam neste
repositório, e sem elas nada que o Node publique funciona. Fazer antes evita descobrir o
problema com o Node pronto e a culpa no lugar errado.

### Passo 2 — um cartucho de PSX montado à mão

O experimento de maior valor por unidade de esforço, e ele antecede o Go: pegar uma ROM,
a BIOS da região, uma capa do libretro, subir tudo num Kubo local, **escrever o
`cartucho.json` na mão** e abrir no PWA.

Se o jogo bootar, o formato do manifesto está provado ponta a ponta — incluindo BIOS,
mídia por CID e o campo novo. Se não bootar, o erro custa uma tarde em vez de custar
milhares de linhas de Go escritas em cima de uma premissa falsa. PSX porque é o caso mais
exigente: BIOS, região, multi-arquivo e `.zip`, tudo de uma vez.

### Passo 3 — o pipeline provado num script descartável

Antes do Go, ~100 linhas de Python contra a **pasta de ROMs real**, sem publicar nada:
hasheia, consulta o OpenVGDB (cheio e sem cabeçalho), tenta a mídia no libretro e imprime
um relatório — quantos casaram por MD5, quantos só por SHA-1/CRC, quantos por nome de
arquivo, quantos ficaram desconhecidos, quantos acharam capa.

Isso mede a taxa de acerto **neste acervo**, que é o número que decide se o desenho serve.
Se 70% cair em "desconhecido", o problema não é o Node — é o mapeamento, e vale corrigir
antes. O script é jogado fora depois; o que fica é o número.

### Passo 4 — o Go, em fatias que já servem sozinhas

1. `cartucho scan` como CLI pura: varre, hasheia, identifica, baixa mídia e **grava os
   `cartucho.json` em disco**. Sem IPFS, sem servidor. Já é útil.
2. Kubo embutido: `add`, `pin`, `provide`, e os CIDs entrando no manifesto. Aqui o
   cartucho passa a existir na rede.
3. Servidor HTTP: PWA embutido, gateway `/ipfs/`, `/routing/v1` e a API do Studio.
4. Studio no PWA, consumindo essa API.

### Passo 5 — netplay, por último

É a parte com mais incógnitas por resolver (AutoTLS na prática, `AddPinhole` em roteador de
verdade, WebSocket no túnel) e a menos essencial para o valor central, que é publicar e
manter um acervo no ar. Chegar nele com o resto funcionando também significa chegar com o
Node já servindo o PWA — que é justamente o que o shim da [7.2](#não-reimplemente-o-socketio)
precisa.

### O que não fazer

Não começar pelo netplay, não começar pelo empacotamento por plataforma, e não escrever o
Go antes do passo 3. As três coisas parecem progresso e são as que mais custam se a
premissa embaixo delas estiver errada.

---

## Fontes verificadas

- OpenVGDB v29.0 — `openvgdb.zip`, 9.118.645 bytes → `openvgdb.sqlite`, 42.288.128 bytes,
  arquivo de 11/2021 (**o banco está congelado desde então**: nada lançado depois disso
  vai ser encontrado por hash). 51.742 ROMs, 40.927 com MD5, 53.871 releases, 43.801 com
  capa cadastrada.
- `thumbnails.libretro.com` — listagem de diretório aberta, ~130 playlists, quatro pastas
  por sistema. URLs conferidas por `HEAD`.
- `EmulatorJS/EmulatorJS-Netplay` — `server.js` lido na íntegra (274 linhas, express +
  socket.io + cors), atendendo relé (`data-message`, `input`, `snapshot`) e sinalização
  (`webrtc-signal`) na mesma instância.
- `cdn.emulatorjs.org/stable/data/emulator.min.js` (426.343 bytes) — **nenhuma ocorrência
  de `RTCPeerConnection` nem de `iceServers`**; netplay do `stable` é relé por socket.io.
  O `loader.js` do `stable` mapeia `EJS_netplayServer` → `config.netplayUrl` e **não** lê
  `EJS_netplayICEServers`; o do `main` lê. Em `data/src/netplay.js` do `main`, sem ICE
  configurado o próprio código avisa: *"No ICE servers configured. Connections will only
  work on LAN."*
- BIOS: `emulatorjs.org/docs/systems/` para playstation, sega-cd, sega-saturn e 3do —
  nomes de arquivo e MD5 copiados de lá.
- Ganchos do netplay (seção 7.5), conferidos no bundle do `stable`:
  `window.EJS_emulator = new EmulatorJS(...)` no `loader.js`;
  `this.netplay.startSocketIO = t => { this.netplay.socket = io(this.netplay.url) … }` e
  `this.netplay.getOpenRooms = async () => … fetch(this.netplay.url + "/list?domain=…&game_id=…")`
  no `emulator.min.js`. Uso do socket: `emit` de `open-room`/`join-room`/`data-message`,
  `on` de `connect`/`disconnect`/`users-updated`/`data-message`, e `disconnect()`. Nenhum
  `window.io` — o cliente socket.io é interno ao bundle.
- `js-libp2p`, `packages/transport-webrtc` — navegador não escuta em porta, logo
  `webrtc-direct` está fora; navegador↔navegador usa circuit relay para trocar o SDP e o
  relay sai da jogada depois de estabelecida a conexão.
- Kubo, `docs/config.md` — `Gateway.ExposeRoutingAPI` expõe `/routing/v1` na porta do
  gateway em `127.0.0.1`, **default `true`**.
- `localhost.run/docs` — *"no account setup is needed for free domains"*; `nokey` como
  usuário SSH pula a checagem de chave; HTTPS gerado automaticamente para túneis HTTP; no
  plano livre *"domain names change regularly"* e *"there is a speed limit"*. A CLI aceita
  `-- --output`. **Suporte a WebSocket não está documentado** — precisa ser testado antes
  de virar caminho padrão.
- TryCloudflare — sem conta, `cloudflared tunnel --url http://localhost:8080`, subdomínio
  aleatório, *"intended for testing and development only"*, sem SLA, teto de 200
  requisições simultâneas, **sem suporte a SSE**.
- Kubo, `docs/config.md`, seção `AutoTLS` — certificado curinga do Let's Encrypt para
  `*.[PeerID].libp2p.direct` por desafio ACME DNS-01 intermediado pelo `p2p-forge`,
  *"without requiring user to do any manual domain registration and certificate
  configuration"*; *"requires a publicly reachable node. If behind NAT, manual port
  forwarding or UPnP (`Swarm.DisableNatPortMap=false`) is required"*; 5–15 min até a
  primeira emissão; certificados em `$IPFS_PATH/p2p-forge-certs`.
- `ipshipyard/p2p-forge` — o IP vai **no hostname**: `1-2-3-4.<PeerID>.libp2p.direct` → A
  `1.2.3.4`; IPv6 troca `:` por `-`, com `--` para os segmentos elididos. A e AAAA, mesma
  convenção. Como o certificado é curinga sobre `*.{PeerID}`, **IP dinâmico não invalida
  nada** — muda só o rótulo da esquerda.
- `huin/goupnp`, `dcps/internetgateway2` — `WANIPConnection{1,2}.AddPortMapping` /
  `GetExternalIPAddress` / `DeletePortMapping` (IPv4) e `WANIPv6FirewallControl1.AddPinhole`
  / `CheckPinholeWorking` / `DeletePinhole` (IPv6).
- `parseNetplayServer()` deste repositório, executado com as quatro formas de endereço da
  tabela em 7.4.3 — IPv6 recusado em todas.
- `emulator.min.js` do `stable` — o padrão embutido é
  `this.config.netplayUrl || "https://netplay.emulatorjs.org"`, e esse servidor responde
  **HTTP 525** (falha de handshake TLS). O botão de netplay também só aparece com
  `"number" == typeof this.config.gameId`, o que confirma a exigência de `EJS_gameID`
  numérico.

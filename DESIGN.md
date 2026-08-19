# Design do Cartucho

Guia de decisões visuais e de interação. A versão navegável, com amostras renderizadas,
está publicada como artifact (link no README). Este arquivo é a referência de quem escreve
código: **os valores aqui são os únicos permitidos**.

## Princípios

1. **O retrô é a moldura, nunca o obstáculo.** Scanline, glass e fonte pixelada são o clima
   da máquina. Se algum deles atrapalha ler um nome de jogo ou acertar um botão, o clima cede.
2. **A capa é a interface.** O acervo é visual: arte do jogo em primeiro plano, cromo do app
   recuando. Nenhum enfeite compete com a capa.
3. **Todo estado é visível.** Baixando, veio do cache, gateway usado, falhou: a rede é
   instável por natureza e o usuário precisa saber onde está.
4. **Três formas de operar, um só desenho.** Mouse, toque e controle percorrem os mesmos
   alvos. Nada é acessível só no hover.

## Cor

Um acento só, indigo, sobre preto quase neutro com viés azul. Cores semânticas não são
decorativas: aparecem apenas quando comunicam estado.

| Token | Hex | Papel |
|---|---|---|
| `cartucho-dark` | `#0a0a0c` | fundo da aplicação |
| `cartucho-sidebar` | `#0f0f18` | painéis, barra lateral, modais |
| `cartucho-primary` | `#4f46e5` | ação primária, foco, marca |
| `cartucho-accent` | `#7c3aed` | apoio do acento, gradientes |
| `slate-200` | `#e2e8f0` | texto principal |
| `slate-500` | `#64748b` | texto secundário |

Estado — nunca use estes tons como enfeite:

| Uso | Cor |
|---|---|
| sucesso, cache local, gateway vivo | `emerald-400` |
| atenção, gateway lento, restrito | `amber-400` |
| erro, falha de boot, destrutivo | `red-400` |

**Superfícies e bordas.** Sobre o fundo escuro, profundidade vem de transparência branca,
não de cinzas novos. Só estes quatro degraus:

- `white/[0.02]` — linha de lista dentro de painel
- `white/5` — superfície elevada (botão secundário, campo)
- `white/10` — borda padrão, hover de superfície
- `white/20` — borda em destaque

## Tipografia

Três famílias, com papéis que não se misturam:

- **Silkscreen** (`font-retro`) — rótulo de sistema. SEMPRE em caixa alta, com
  `tracking-[0.2em]`. É uma fonte pixelada: some abaixo de 11px.
- **Orbitron** (`font-orbitron`) — nomes próprios: título de tela e nome de jogo. Nunca em
  texto corrido.
- **Inter** (`font-sans`) — tudo que precisa ser lido: descrição, ajuda, mensagem de erro.

### Hierarquia de títulos

Mesma regra em todas as telas — o nível do título vem da estrutura, não do tamanho que
parece bonito no lugar:

| Nível | Onde | Tamanho | Família |
|---|---|---|---|
| `h1` | título da tela (Acervo, nome do console) | 20–24px | Silkscreen |
| `h2` | título de página ou de diálogo | 24–30px | Orbitron 900 |
| `h3` | título de seção ou card | **16px** | Silkscreen, caixa alta, `tracking-[0.2em]` |
| `h4` | título de item (nome do jogo no card) | 14px | Orbitron 700 |

Os `h3` já foram 12px em Silkscreen: no tamanho de rótulo, um título de seção não se lê
como título — some no meio do conteúdo.

### Escala

| Papel | Tamanho | Família |
|---|---|---|
| `display` | 30px | Orbitron 900 |
| `title` | 20px | Orbitron 700 |
| `subtitle` | 15–16px | Orbitron 700 / Inter |
| `body` | 14px | Inter 400 |
| `meta` | 13px | Inter — dados, ajuda, valores |
| `label` | 12px | Silkscreen, caixa alta, `tracking-[0.2em]` |

**12px é o piso, e 12px só para rótulo em Silkscreen.** A primeira versão deste guia dizia
11px; na tela real não se lê — a fonte é desenhada em grade de pixels e, com o tracking
largo que o estilo pede, 11px vira textura.

**Silkscreen nunca em frase.** Rótulo é uma expressão curta (`Cache_Local`, `Salvar`,
`Add_Cartucho`). Qualquer coisa com sujeito e verbo é Inter 13px ou 14px — texto de ajuda,
descrição, mensagem de erro, valor lido pelo usuário (URL de gateway, "4,0 MB em disco").
Foi exatamente esse o erro corrigido: frases inteiras estavam em fonte pixelada com
tracking, e ninguém conseguia lê-las.

Tamanho arbitrário novo (`text-[9px]` e afins) não entra: se não cabe na escala, o problema
é o layout.

## Forma e profundidade

Raio comunica hierarquia — quanto maior a superfície, maior o raio:

| Token | Valor | Onde |
|---|---|---|
| `rounded-xl` | 12px | botões, campos, badges |
| `rounded-2xl` | 16px | cards, itens de lista |
| `rounded-3xl` | 24px | modais, painéis, área do player |
| `rounded-full` | — | pills, botões circulares |

Elevação é sempre `glass-panel` (blur + borda `white/10`), nunca sombra dura. `shadow-neon`
só no elemento com foco de ação.

## Espera e progresso

Rede aqui é lenta e instável; esconder isso deixa o usuário sem saber se o app travou.

- **Toda ação que vai à rede mostra que está em andamento** — spinner no controle acionado e
  no item afetado, com o rótulo mudando para o gerúndio (`Testar agora` → `Testando
  gateways…`). O controle fica desabilitado enquanto isso, para não disparar duas vezes.
- **Resultado que chega em partes aparece em partes.** O teste de latência preenche cada
  gateway assim que ele responde, em vez de segurar a lista inteira até o último timeout.
- **Progresso com número quando o total é conhecido** (download de ROM), barra indeterminada
  quando não é.
- **O aviso diz o que aconteceu, na ação que aconteceu.** `flashToast()` exige a mensagem: um
  texto fixo reaproveitado por várias ações mente — salvar um gateway anunciava
  "CARTUCHO_COPIED". Diga o fato ("Link copiado", "4,0 MB liberados",
  "ipfs.filebase.io adicionado").
- **Falha de ação também avisa.** Se a cópia para a área de transferência é recusada pelo
  navegador, o usuário vê o erro — nunca só o `console`.
- Medição exibida tem que ser verdade: o teste de gateway usa `cache: 'no-store'`, senão
  mostra a latência do cache do browser e não a do gateway.

## Movimento

Transição padrão de 200 ms; 500 ms só em zoom de capa. Sempre `transform`/`opacity`.
Toda animação decorativa (scanline, flicker, pulse) para sob `prefers-reduced-motion`.

## Alvos e foco

- **44×44px é o mínimo de qualquer alvo em toque.** Em desktop com hover, 32px.
- Ícone pequeno precisa de área clicável estendida (padding ou pseudo-elemento), não de
  ícone maior.
- Todo elemento operável tem estado de foco visível — o mesmo anel serve para teclado e
  controle (`.gamepad-focus`). Nunca `outline: none` sem substituto.
- Ação destrutiva pede confirmação inline. Diálogo nativo (`alert`/`confirm`) é proibido:
  congela a página e o emulador junto.

## Responsividade

Mobile primeiro. O acervo é consultado no celular tanto quanto no desktop.

| Faixa | Largura | Grade de cartuchos | Navegação |
|---|---|---|---|
| base | < 640px | 2 colunas | gaveta sobreposta |
| `sm` | ≥ 640px | 3 colunas | gaveta sobreposta |
| `md` | ≥ 768px | 4 colunas | gaveta sobreposta |
| `lg` | ≥ 1024px | 5 colunas | barra fixa |
| `xl` | ≥ 1280px | 6 colunas | barra fixa |

Regras que não podem quebrar:

- **Destaque empilha.** Abaixo de `lg`, a arte vai para cima e o texto para baixo. A arte
  nunca fica atrás do texto — hoje o gradiente lateral invade o título no celular.
- **Nome de jogo tem duas linhas** antes de truncar. Cartucho com nome cortado em uma
  palavra não é acervo, é lista de arquivos.
- **Barra do player é fixa e sempre alcançável** — `Eject` no polegar, não no topo.
- **Ação principal não rola junto com lista** — `Add_Cartucho` e `Settings` ficam fixos no
  rodapé da barra lateral; dentro do `<nav>` rolável, sumiam quando os consoles se
  acumulavam.
- **Configuração é página, não modal** (`?page=Settings`): são quatro blocos que não cabem
  numa caixa flutuante sem rolagem interna. Em `lg` viram duas colunas.
- **Modal cabe na tela, sempre.** Rola por dentro (`max-h-[92vh] overflow-y-auto`), com
  cabeçalho e barra de ações grudados (`sticky`) — fechar e confirmar não podem depender de
  rolagem. Abaixo de 700px de altura os espaçamentos comprimem; abaixo de 420px o que é
  decorativo sai (o QR de compartilhar, por exemplo, vira só o link). Isso vale para celular
  deitado e para desktop com teclado virtual ou janela baixa.
- **Rótulo de botão cabe na largura do modal.** Três ações lado a lado em 512px não aceitam
  rótulos longos: `Inserir_e_Jogar` era cortado; virou `Jogar`.
- Nada de rolagem horizontal em nenhuma largura.

## Anti-padrões

Coisas que já estiveram no código e não voltam:

- `text-[7px]` a `text-[11px]` — ilegíveis; o app já teve 22 ocorrências abaixo de 10px.
- Frase inteira em `font-retro` (Silkscreen). Rótulo curto, só.
- Alvo de 24×24px — o app tinha 14 abaixo de 44px.
- `alert()` / `confirm()` — congelam a página e o emulador.
- Raio novo por componente (o app já teve 9 valores diferentes).
- Cor fora dos tokens para criar "mais um cinza".
- Ação que só existe no `:hover` — controle e toque não têm hover.

// Navegação da interface por controle.
//
// Fora do jogo o loop move o foco pela UI; dentro do jogo ele só vigia o atalho de
// eject, deixando todo o resto do input para o emulador.
//
// Os alvos de foco são os elementos com a classe `.nav-item`, restritos ao modal aberto
// quando há um. A lista fica cacheada (varrer o DOM a cada frame custa caro) e é
// invalidada pelos $watch registrados em app.js.

/**
 * Elemento mais próximo na direção pedida, medido pelo centro de cada um. O desalinhamento
 * no outro eixo pesa mais que a distância na direção do movimento (fator 2), senão descer
 * numa grade pula para a coluna errada só porque aquele card estava alguns pixels acima.
 * @returns {number} índice do vizinho, ou -1 quando não há nada naquela direção
 */
function vizinhoNaDirecao(elements, indexAtual, dir) {
    const centro = (el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    const origem = centro(elements[indexAtual]);
    const MARGEM = 4; // ignora diferenças de subpixel entre itens da mesma linha/coluna

    let melhor = -1;
    let melhorCusto = Infinity;
    elements.forEach((el, i) => {
        if (i === indexAtual) return;
        const c = centro(el);
        const dx = c.x - origem.x;
        const dy = c.y - origem.y;

        const naDirecao =
            (dir === 'up' && dy < -MARGEM) || (dir === 'down' && dy > MARGEM) ||
            (dir === 'left' && dx < -MARGEM) || (dir === 'right' && dx > MARGEM);
        if (!naDirecao) return;

        const vertical = dir === 'up' || dir === 'down';
        const custo = vertical
            ? Math.abs(dy) + Math.abs(dx) * 2
            : Math.abs(dx) + Math.abs(dy) * 2;
        if (custo < melhorCusto) {
            melhorCusto = custo;
            melhor = i;
        }
    });
    return melhor;
}

/** Botões padrão do Gamepad API. */
const BUTTON = { A: 0, B: 1, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const AXIS = { X: 0, Y: 1 };
const DEADZONE = 0.5;
/** Intervalo mínimo entre inputs, senão um toque no direcional anda a lista inteira. */
const INPUT_COOLDOWN = 180;
/** Quanto tempo Start + Cima precisa ficar segurado para ejetar (ms). */
const EJECT_HOLD = 3000;

/**
 * `gamepad.id` vem como "Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)".
 * Na tela só interessa a parte que a pessoa reconhece.
 */
function nomeDoControle(gp) {
    const cru = (gp?.id || '').trim();
    if (!cru) return 'Gamepad';
    const semParenteses = cru.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
    const nome = semParenteses || cru;
    return nome.length > 32 ? `${nome.slice(0, 31)}…` : nome;
}

export function gamepadModule() {
    // Estado de alta frequência fica FORA do objeto reativo do Alpine: o loop roda a
    // ~60 fps e escrever nessas propriedades pelo proxy reativo dispara notificação de
    // dependências 60 vezes por segundo sem nada na UI depender delas.
    const loop = {
        timer: null,
        toastTimer: null,
        ultimoInput: 0,
        ejectInicio: null,
        focoCache: null,
        focoIndex: -1
    };

    return {
        // Só o que a interface realmente observa mora no estado reativo.
        gamepadConnected: false,
        showGamepadToast: false,
        /** Texto do toast do controle: dizer qual chegou vale mais que "controle conectado". */
        gamepadToastTexto: '',
        gamepadToastConectou: true,
        showEjectToast: false,

        initGamepad() {
            window.addEventListener('gamepadconnected', (e) => {
                if (e.gamepad.index !== 0) return; // só o primeiro controle comanda a UI
                console.log('Gamepad conectado', e.gamepad.id);
                this.gamepadConnected = true;
                this.updateGamepadToast(nomeDoControle(e.gamepad), true);
                this.startGamepadLoop();
            });

            window.addEventListener('gamepaddisconnected', (e) => {
                if (e.gamepad.index !== 0) return;
                console.log('Gamepad desconectado', e.gamepad.id);
                this.gamepadConnected = false;
                // Cair fora sem avisar deixa a impressão de que o app travou.
                this.updateGamepadToast(nomeDoControle(e.gamepad), false);
                this.stopGamepadLoop();
            });

            // Não fica varrendo o controle com a aba em segundo plano.
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) {
                    this.stopGamepadLoop();
                } else if (this.gamepadConnected && !loop.timer) {
                    this.startGamepadLoop();
                }
            });

            const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
            if (gamepads[0]) {
                this.gamepadConnected = true;
                this.updateGamepadToast(nomeDoControle(gamepads[0]), true);
                this.startGamepadLoop();
            }
        },

        startGamepadLoop() {
            if (loop.timer) return;
            this.gamepadLoop();
        },

        stopGamepadLoop() {
            if (loop.timer) {
                cancelAnimationFrame(loop.timer);
                loop.timer = null;
            }
            const focado = document.querySelector('.gamepad-focus');
            if (focado) focado.classList.remove('gamepad-focus');
            loop.focoIndex = -1;
        },

        gamepadLoop() {
            const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
            const gp = gamepads[0];

            if (gp) {
                if (this.isPlaying) {
                    this.handleEjectShortcut(gp);
                } else {
                    this.handleGamepadInput(gp);
                }
            }

            loop.timer = requestAnimationFrame(() => this.gamepadLoop());
        },

        /** Start + Cima segurados por 3s saem do jogo e voltam para a biblioteca. */
        handleEjectShortcut(gp) {
            const stickY = gp.axes.length > AXIS.Y ? gp.axes[AXIS.Y] : 0;
            const holding = gp.buttons[BUTTON.START]?.pressed &&
                (gp.buttons[BUTTON.UP]?.pressed || stickY < -DEADZONE);

            if (!holding) {
                loop.ejectInicio = null;
                // Só escreve no estado reativo quando o valor realmente muda.
                if (this.showEjectToast) this.showEjectToast = false;
                return;
            }

            if (!loop.ejectInicio) {
                loop.ejectInicio = Date.now();
                this.showEjectToast = true;
            } else if (Date.now() - loop.ejectInicio >= EJECT_HOLD) {
                loop.ejectInicio = null;
                this.showEjectToast = false;
                this.stopGame(this.currentGame?.system);
            }
        },

        handleGamepadInput(gp) {
            const now = Date.now();
            if (now - loop.ultimoInput < INPUT_COOLDOWN) return;

            const stickX = gp.axes[AXIS.X];
            const stickY = gp.axes[AXIS.Y];
            const pressed = (button) => gp.buttons[button]?.pressed;

            if (pressed(BUTTON.UP) || stickY < -DEADZONE) {
                this.updateFocus('up');
                loop.ultimoInput = now;
            } else if (pressed(BUTTON.DOWN) || stickY > DEADZONE) {
                this.updateFocus('down');
                loop.ultimoInput = now;
            } else if (pressed(BUTTON.LEFT) || stickX < -DEADZONE) {
                this.updateFocus('left');
                loop.ultimoInput = now;
            } else if (pressed(BUTTON.RIGHT) || stickX > DEADZONE) {
                this.updateFocus('right');
                loop.ultimoInput = now;
            }

            if (pressed(BUTTON.A)) {
                this.clickFocusedElement();
                loop.ultimoInput = now;
            } else if (pressed(BUTTON.B)) {
                this.goBack();
                loop.ultimoInput = now;
            }
        },

        getFocusableElements() {
            if (!loop.focoCache || loop.focoCache.length === 0) {
                this.updateFocusCache();
            }
            // offsetParent null = elemento escondido; nunca focar nesses.
            return loop.focoCache.filter(el => el.offsetParent !== null);
        },

        /**
         * Recalcula os alvos de foco.
         * ATENÇÃO: ao adicionar um modal novo, inclua-o aqui, em `goBack()` e num $watch
         * de `registerFocusWatchers()` em app.js — senão o controle continua navegando
         * pelos elementos de trás do modal.
         */
        updateFocusCache() {
            // Ordem = profundidade na tela. O teclado vem primeiro (fica por cima de tudo) e
            // as confirmações vêm antes dos modais que as abriram.
            //
            // pendingDelete e pendingCacheLimit estavam de fora: como vivem no topo do body,
            // fora de <nav> e <main>, o ramo "sem modal" filtrava os botões deles para fora
            // da lista — o controle seguia andando pela grade ATRÁS da confirmação, e A
            // abria um jogo enquanto a pergunta "remover?" continuava na tela, sem que
            // Cancelar ou Remover pudessem ser alcançados.
            const openModal = this.tecladoAberto ? 'tecladoAberto'
                : this.pendingCacheLimit ? 'pendingCacheLimit'
                    : this.pendingDelete ? 'pendingDelete'
                        : this.showShareModal ? 'showShareModal'
                            : this.showImportModal ? 'showImportModal'
                                : null;

            const elements = openModal
                ? Array.from(document.querySelectorAll(`.fixed[x-show="${openModal}"] .nav-item`))
                // Sem modal: só a navegação lateral e o conteúdo principal.
                : Array.from(document.querySelectorAll('.nav-item'))
                    .filter(el => el.closest('nav') || el.closest('main'));

            loop.focoCache = elements;
            if (loop.focoIndex >= elements.length) loop.focoIndex = -1;
        },

        /**
         * Move o foco pela geometria da tela, não pela ordem do DOM. Antes as quatro
         * direções andavam de um em um na mesma lista: numa grade de seis colunas, descer
         * uma linha custava seis toques, e o teclado virtual seria impraticável.
         * Sem candidato na direção pedida, cai no passo linear de antes — que ainda é o
         * comportamento certo para listas de uma coluna.
         */
        /**
         * Repinta o anel de foco no índice atual, sem mover nada. Serve para quando o
         * Alpine recria os elementos focados debaixo do controle: alternar ABC/abc troca o
         * `:key` das 26 letras, o `gamepad-focus` some junto com os nós antigos e o usuário
         * fica sem âncora visível até apertar uma direção — na TV, no meio de um CID.
         */
        refocarAtual() {
            const elements = this.getFocusableElements();
            if (loop.focoIndex < 0 || !elements[loop.focoIndex]) return;
            elements.forEach((el, idx) => el.classList.toggle('gamepad-focus', idx === loop.focoIndex));
        },

        updateFocus(dir) {
            const elements = this.getFocusableElements();
            if (elements.length === 0) return;

            if (loop.focoIndex === -1 || !elements[loop.focoIndex]) {
                loop.focoIndex = 0;
            } else {
                const vizinho = vizinhoNaDirecao(elements, loop.focoIndex, dir);
                if (vizinho !== -1) {
                    loop.focoIndex = vizinho;
                } else {
                    const passo = (dir === 'down' || dir === 'right') ? 1 : -1;
                    loop.focoIndex = (loop.focoIndex + passo + elements.length) % elements.length;
                }
            }

            elements.forEach((el, idx) => {
                if (idx !== loop.focoIndex) {
                    el.classList.remove('gamepad-focus');
                    return;
                }
                el.classList.add('gamepad-focus');
                el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                if (['BUTTON', 'A', 'INPUT'].includes(el.tagName)) {
                    el.focus({ preventScroll: true }); // o scroll suave acima já cuida disso
                }
            });
        },

        clickFocusedElement() {
            const elements = this.getFocusableElements();
            const el = loop.focoIndex >= 0 ? elements[loop.focoIndex] : null;
            if (!el) return;

            // Campo de texto com o controle na mão: apertar A num <input> só o focava, e
            // aí não havia como escrever nada. Abre o teclado da tela.
            if (el.tagName === 'INPUT' && ['text', 'search', 'url'].includes(el.type)) {
                el.focus({ preventScroll: true });
                this.abrirTeclado(el);
                return;
            }
            el.click();
        },

        /** Botão B: fecha o que estiver aberto, na ordem de profundidade. */
        goBack() {
            if (this.tecladoAberto) this.fecharTeclado();
            else if (this.sidebarOpen) this.sidebarOpen = false;
            else if (this.pendingCacheLimit) this.cancelarLimiteDeCache();
            else if (this.pendingDelete) this.cancelDelete();
            else if (this.showShareModal) this.showShareModal = false;
            else if (this.showImportModal) this.resetImport();
            else if (this.isPlaying) this.stopGame();
            else this.activePage = 'Home';
        },

        updateGamepadToast(nome, conectou) {
            this.gamepadToastTexto = nome;
            this.gamepadToastConectou = conectou;
            this.showGamepadToast = true;
            clearTimeout(loop.toastTimer);
            loop.toastTimer = setTimeout(() => {
                this.showGamepadToast = false;
            }, 4000);
        }
    };
}

// Navegação da interface por controle.
//
// Fora do jogo o loop move o foco pela UI; dentro do jogo ele só vigia o atalho de
// eject, deixando todo o resto do input para o emulador.
//
// Os alvos de foco são os elementos com a classe `.nav-item`, restritos ao modal aberto
// quando há um. A lista fica cacheada (varrer o DOM a cada frame custa caro) e é
// invalidada pelos $watch registrados em app.js.

/** Botões padrão do Gamepad API. */
const BUTTON = { A: 0, B: 1, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const AXIS = { X: 0, Y: 1 };
const DEADZONE = 0.5;
/** Intervalo mínimo entre inputs, senão um toque no direcional anda a lista inteira. */
const INPUT_COOLDOWN = 180;
/** Quanto tempo Start + Cima precisa ficar segurado para ejetar (ms). */
const EJECT_HOLD = 3000;

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
        showEjectToast: false,

        initGamepad() {
            window.addEventListener('gamepadconnected', (e) => {
                if (e.gamepad.index !== 0) return; // só o primeiro controle comanda a UI
                console.log('Gamepad conectado', e.gamepad.id);
                this.gamepadConnected = true;
                this.updateGamepadToast();
                this.startGamepadLoop();
            });

            window.addEventListener('gamepaddisconnected', (e) => {
                if (e.gamepad.index !== 0) return;
                console.log('Gamepad desconectado', e.gamepad.id);
                this.gamepadConnected = false;
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
                this.updateGamepadToast();
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
            const openModal = this.showShareModal ? 'showShareModal'
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

        updateFocus(dir) {
            const elements = this.getFocusableElements();
            if (elements.length === 0) return;

            if (loop.focoIndex === -1) {
                loop.focoIndex = 0;
            } else {
                const passo = (dir === 'down' || dir === 'right') ? 1 : -1;
                loop.focoIndex = (loop.focoIndex + passo + elements.length) % elements.length;
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
            if (loop.focoIndex >= 0 && elements[loop.focoIndex]) {
                elements[loop.focoIndex].click();
            }
        },

        /** Botão B: fecha o que estiver aberto, na ordem de profundidade. */
        goBack() {
            if (this.sidebarOpen) this.sidebarOpen = false;
            else if (this.pendingCacheLimit) this.cancelarLimiteDeCache();
            else if (this.pendingDelete) this.cancelDelete();
            else if (this.showShareModal) this.showShareModal = false;
            else if (this.showImportModal) this.resetImport();
            else if (this.isPlaying) this.stopGame();
            else this.activePage = 'Home';
        },

        updateGamepadToast() {
            this.showGamepadToast = true;
            clearTimeout(loop.toastTimer);
            loop.toastTimer = setTimeout(() => {
                this.showGamepadToast = false;
            }, 4000);
        }
    };
}

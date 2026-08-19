// Integração com o EmulatorJS.
//
// Regra central: estado de WebAssembly/Emscripten não é desmontável de forma confiável,
// então TROCAR de jogo e SAIR do jogo são navegações de página, não desmontagem em memória.
// `initData()` relê ?cartucho= e ?page= no boot e é isso que restaura a view certa.
import {
    EJS_DATA_PATH, EJS_LOADER_URL, EJS_LOADER_ID, EJS_LANGUAGES, COLORS
} from './config.js';

/** Defaults do EmulatorJS. Precisam ser globais reais em `window` — o loader lê de lá. */
export function applyEmulatorDefaults() {
    window.EJS_player = '#game-container';
    window.EJS_core = 'nes';
    window.EJS_gameUrl = '';
    window.EJS_gameID = '';
    window.EJS_gameName = '';
    window.EJS_backgroundImage = '';
    window.EJS_pathtodata = EJS_DATA_PATH;
    window.EJS_language = pickLanguage();
    window.EJS_disableAutoLang = true;
    window.EJS_cheats = [];
    window.EJS_biosUrl = '';
    window.EJS_backgroundColor = COLORS.background;
    window.EJS_color = COLORS.primary;
    window.EJS_startOnLoaded = true;
    window.EJS_saveStateLocation = 'browser';
    window.EJS_defaultOptions = {
        'save-state-location': 'browser',
        'save-state-slot': 1
    };
}

/** Idioma do navegador com fallback: pt-BR -> pt -> en. */
export function pickLanguage() {
    const raw = navigator.language || 'en-US';
    const short = raw.split('-')[0];
    if (EJS_LANGUAGES.includes(raw)) return raw;
    return EJS_LANGUAGES.includes(short) ? short : 'en';
}

/**
 * true quando o EmulatorJS já foi carregado nesta página.
 * Checa o script injetado, não só `EJS_load`: as versões atuais do loader bootam
 * sozinhas ao carregar e nunca expõem `EJS_load`.
 */
export function isEmulatorLoaded() {
    return typeof window.EJS_load === 'function' || !!document.getElementById(EJS_LOADER_ID);
}

/** Aplica as globais do jogo que vai rodar. Chamar sempre antes de `bootEmulator()`. */
export function configureEmulator(game, romUrl, coverUrl) {
    window.EJS_player = '#game-container';
    window.EJS_gameUrl = romUrl;
    window.EJS_gameID = game.cartucho;
    window.EJS_gameName = game.name;
    window.EJS_backgroundImage = coverUrl;
    window.EJS_core = game.system || 'nes';
    window.EJS_language = pickLanguage();
    window.EJS_disableAutoLang = true;
    window.EJS_cheats = game.cheats || [];
    window.EJS_startOnLoaded = true;
    window.EJS_saveStateLocation = 'browser';
    window.EJS_defaultOptions = {
        'save-state-location': 'browser',
        'save-state-slot': 1
    };
}

/**
 * Injeta o loader do EmulatorJS (só na primeira vez) e dispara o boot.
 * O loader lê as globais EJS_* no momento em que carrega e inicia sozinho quando
 * `EJS_startOnLoaded` está ligado — por isso a ausência de `EJS_load` NÃO é erro.
 * @returns {Promise<void>} rejeita apenas se o próprio script do loader não carregar.
 */
export function bootEmulator() {
    return new Promise((resolve, reject) => {
        // Já carregado: só as versões que expõem EJS_load conseguem rebootar em memória.
        if (typeof window.EJS_load === 'function') {
            try {
                window.EJS_load();
                resolve();
            } catch (e) {
                reject(e);
            }
            return;
        }

        // Script já presente: o próprio loader cuida do boot, nada a fazer.
        if (document.getElementById(EJS_LOADER_ID)) {
            resolve();
            return;
        }

        const script = document.createElement('script');
        script.id = EJS_LOADER_ID;
        script.src = EJS_LOADER_URL;
        script.async = true;
        script.onload = () => {
            if (typeof window.EJS_load === 'function') window.EJS_load();
            resolve();
        };
        script.onerror = () => reject(new Error('falha ao carregar o loader do EmulatorJS'));
        document.body.appendChild(script);
    });
}

/** Reflete o jogo atual na URL, sem recarregar (para o link de compartilhamento ficar certo). */
export function syncUrlToGame(cid) {
    const url = new URL(window.location);
    url.searchParams.set('cartucho', cid);
    window.history.replaceState({}, '', url);
}

/** Troca de jogo com o emulador rodando: só uma navegação limpa resolve. */
export function reloadWithGame(cid) {
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set('cartucho', cid);
    window.location.href = url.toString();
}

/** Sai do jogo recarregando a página, preservando a aba de destino. */
/**
 * @param {string} targetPage aba de destino
 * @param {{acao?: string}} [opts] ação a executar assim que a página voltar — sair do jogo é
 *        um recarregamento, então a intenção do clique precisa atravessar a URL.
 */
export function reloadToPage(targetPage = 'Home', opts = {}) {
    const url = new URL(window.location.origin + window.location.pathname);
    if (targetPage !== 'Home') url.searchParams.set('page', targetPage);
    if (opts.acao) url.searchParams.set('acao', opts.acao);
    window.location.href = url.toString();
}

// Integração com o EmulatorJS.
//
// Regra central: estado de WebAssembly/Emscripten não é desmontável de forma confiável,
// então TROCAR de jogo e SAIR do jogo são navegações de página, não desmontagem em memória.
// `initData()` relê ?cartucho= e ?page= no boot e é isso que restaura a view certa.
import {
    EJS_DATA_PATH, EJS_LOADER_URL, EJS_LOADER_ID, EJS_LANGUAGES, COLORS
} from './config.js';

/**
 * O EmulatorJS exige `EJS_gameID` numérico: é o que separa saves, save states e cache
 * entre jogos, e o netplay não sobe sem ele. O identificador daqui é um CID (texto), então
 * vira número por hash — mesmo CID, mesmo número, sempre.
 */
export function gameIdNumerico(cid) {
    let hash = 2166136261; // FNV-1a de 32 bits
    for (let i = 0; i < (cid || '').length; i++) {
        hash ^= cid.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash | 0) || 1;
}

/** Literal IPv6 como o `URL` devolve em `hostname`: entre colchetes. */
function ehIPv6(hostname) {
    return hostname.startsWith('[') && hostname.endsWith(']');
}

/** IPv4 numérico puro — não é hostname, então não ganha `https:` por padrão. */
function ehIPv4(hostname) {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

/**
 * Arruma o endereço do servidor de NetPlay: aceita "netplay.exemplo.com", um IP com porta
 * ou a URL inteira.
 *
 * Duas armadilhas já pagas aqui:
 *
 * 1. **Literal IPv6 não tem ponto.** A validação era `hostname.includes('.')`, então
 *    `[2804:14d:1::1]:3000` era recusado como endereço inválido MESMO com esquema
 *    explícito — e o netplay por IPv6, que é o caminho sem NAT nenhum, simplesmente não
 *    existia para o usuário.
 * 2. **`https:` como padrão só serve para hostname.** Endereço sem esquema virava
 *    `https://`, e não existe certificado para IP: `192.168.1.10:3000` (LAN) e
 *    `187.1.2.3:3000` (porta aberta por UPnP) ficavam sem conectar, sem explicação. IP
 *    literal, v4 ou v6, assume `http:`; hostname continua assumindo `https:`.
 *
 * @returns {{url: string}|{error: string}}
 */
export function parseNetplayServer(texto) {
    let cru = (texto || '').trim();
    if (!cru) return { url: '' }; // vazio é uma escolha válida: netplay desligado

    const temEsquema = /^https?:\/\//i.test(cru);
    // IPv6 digitado sem colchetes ("2804:14d:1::1"): o `URL` leria o último grupo como
    // porta. Colchetes são obrigatórios para informar porta, então aqui não há porta a
    // preservar — é só embrulhar. Dois-pontos únicos ficam de fora: é "host:porta".
    if (!temEsquema && !cru.startsWith('[') && (cru.match(/:/g) || []).length > 1) {
        cru = `[${cru}]`;
    }

    let url;
    try {
        // O esquema real depende do host, que só existe depois do parse. `http:` aqui é
        // andaime: o valor final é decidido logo abaixo.
        url = new URL(temEsquema ? cru : `http://${cru}`);
    } catch (e) {
        return { error: 'Invalid address.' };
    }

    const host = url.hostname;
    const ehIP = ehIPv6(host) || ehIPv4(host);
    if (!ehIP && !host.includes('.') && host !== 'localhost') {
        return { error: 'Invalid address.' };
    }
    if (!temEsquema && !ehIP && host !== 'localhost') {
        url.protocol = 'https:';
    }

    return { url: url.href.endsWith('/') ? url.href : `${url.href}/` };
}

/**
 * Defaults do EmulatorJS. Precisam ser globais reais em `window` — o loader lê de lá.
 * @param {{netplayServer?: string}} [opts]
 */
export function applyEmulatorDefaults(opts = {}) {
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
    window.EJS_netplayServer = opts.netplayServer || '';
    // 'download' e não 'browser': o save state guardado no navegador é apagado junto com
    // os dados do site, e o usuário nunca soube que tinha algo a perder. Baixando, o
    // arquivo é dele. (`EJS_saveStateLocation`, que estava aqui, não existe na API —
    // quem manda é esta chave de `EJS_defaultOptions`, com valores 'download'|'browser'.)
    window.EJS_defaultOptions = {
        'save-state-location': 'download',
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

/**
 * Aplica as globais do jogo que vai rodar. Chamar sempre antes de `bootEmulator()`.
 * @param {{netplayServer?: string}} [opts]
 */
export function configureEmulator(game, romUrl, coverUrl, opts = {}) {
    window.EJS_player = '#game-container';
    window.EJS_gameUrl = romUrl;
    // Hash do CID da ROM, não do manifesto: o EmulatorJS lista salas de netplay por
    // gameID, e o que precisa ser idêntico entre dois jogadores é o BINÁRIO. Como CID é
    // hash de conteúdo, a sala passa a ser o arquivo — dois cartuchos com metadados
    // diferentes apontando para a mesma ROM são o mesmo jogo, e some a dessincronização
    // clássica de "mesma sala, ROM ligeiramente diferente". Vale também para os saves,
    // que o gameID separa: cai no lugar certo pelo mesmo motivo.
    window.EJS_gameID = gameIdNumerico(game.rom);
    window.EJS_gameName = game.name;
    window.EJS_backgroundImage = coverUrl;
    window.EJS_biosUrl = opts.biosUrl || '';
    window.EJS_core = game.system || 'nes';
    window.EJS_language = pickLanguage();
    window.EJS_disableAutoLang = true;
    window.EJS_cheats = game.cheats || [];
    window.EJS_startOnLoaded = true;
    window.EJS_netplayServer = opts.netplayServer || '';
    window.EJS_defaultOptions = {
        'save-state-location': 'download',
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
        script.onerror = () => {
            // Tirar a tag do DOM é o que torna a retentativa possível: o `if` acima
            // considera "script presente" como "o loader cuida do boot" e resolve sem
            // fazer nada. Com a tag morta ali, o botão Try_Again limpava a mensagem de
            // erro e deixava o usuário num player vazio, sem erro e sem saída.
            script.remove();
            reject(new Error('falha ao carregar o loader do EmulatorJS'));
        };
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

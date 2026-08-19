// Biblioteca local: persistência no localStorage, validação de manifesto e import/export.
import { SUPPORTED_CORES, STORAGE_KEYS, DEPRECATED_GATEWAYS } from './config.js';

/**
 * Identidade do jogo. Entradas antigas gravavam `cid` em vez de `cartucho`,
 * então todo acesso ao identificador passa por aqui.
 */
export function gameCid(game) {
    return game.cartucho || game.cid || null;
}

export function loadLibrary() {
    const stored = localStorage.getItem(STORAGE_KEYS.library);
    if (!stored) return [];
    try {
        const parsed = JSON.parse(stored);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        console.error('Não foi possível ler a biblioteca salva', e);
        return [];
    }
}

/**
 * Grava tolerando recusa do navegador: o Safari em janela privada lança em toda escrita e
 * qualquer navegador lança quando a quota estoura. Antes a exceção subia pelo Alpine e a
 * alteração se perdia sem nada na tela — pior no acervo, que é o único dado do usuário.
 * @returns {boolean} false quando o navegador recusou a gravação
 */
function gravar(chave, valor) {
    try {
        localStorage.setItem(chave, valor);
        return true;
    } catch (e) {
        console.error(`Não foi possível gravar ${chave} no localStorage`, e);
        return false;
    }
}

/** @returns {boolean} false quando o navegador recusou — quem chama precisa avisar. */
export function saveLibrary(library) {
    return gravar(STORAGE_KEYS.library, JSON.stringify(library));
}

/**
 * Gateway escolhido pelo usuário. Preferência gravada em gateway que hoje está fora do
 * ar (o padrão antigo era ipfs.io) é migrada para o padrão atual — senão quem já usou o
 * app fica travado num gateway morto, mesmo com a lista nova.
 */
export function loadGatewayPreference(fallback) {
    const saved = localStorage.getItem(STORAGE_KEYS.gateway);
    if (!saved) return fallback;
    if (DEPRECATED_GATEWAYS.includes(saved)) {
        console.info(`Gateway salvo (${saved}) não responde mais; migrando para ${fallback}.`);
        localStorage.setItem(STORAGE_KEYS.gateway, fallback);
        return fallback;
    }
    return saved;
}

export function saveGatewayPreference(gateway) {
    return gravar(STORAGE_KEYS.gateway, gateway);
}

/**
 * Último gateway que respondeu de verdade. Guardado à parte da preferência do usuário:
 * serve de chute inicial da corrida, sem sobrescrever a escolha dele.
 */
export function loadLastWorkingGateway() {
    return localStorage.getItem(STORAGE_KEYS.lastGateway) || null;
}

/** Gateways acrescentados pelo usuário, além da lista fixa. */
export function loadCustomGateways() {
    try {
        const salvos = JSON.parse(localStorage.getItem(STORAGE_KEYS.customGateways) || '[]');
        return Array.isArray(salvos) ? salvos.filter(g => typeof g === 'string') : [];
    } catch (e) {
        return [];
    }
}

export function saveCustomGateways(lista) {
    return gravar(STORAGE_KEYS.customGateways, JSON.stringify(lista));
}

export function saveLastWorkingGateway(gateway) {
    if (gateway) gravar(STORAGE_KEYS.lastGateway, gateway);
}

/** Servidor de NetPlay escolhido pelo usuário. Vazio = jogar em rede desligado. */
export function loadNetplayServer() {
    return localStorage.getItem(STORAGE_KEYS.netplay) || '';
}

export function saveNetplayServer(url) {
    return gravar(STORAGE_KEYS.netplay, url || '');
}

/**
 * Valida e normaliza o manifesto JSON de um Cartucho.
 * Ponto único por onde passam TODOS os caminhos de import (URL, QR, CID manual):
 * campo novo de manifesto se adiciona aqui.
 * @returns {{game: object}|{error: string}}
 */
export function normalizeCartucho(data, cartuchoCid) {
    const romCid = data.rom_cid || data.rom;
    if (!data.name || !data.system || !romCid) {
        return { error: 'Invalid Cartucho: required fields are missing (name, system, rom_cid or rom).' };
    }
    if (!SUPPORTED_CORES.includes(data.system)) {
        return { error: `Invalid Cartucho: the '${data.system}' core is not supported.` };
    }

    return {
        game: {
            cartucho: cartuchoCid, // o CID do JSON é o Cartucho
            name: data.name,
            system: data.system,
            rom: romCid,           // o CID do binário fica separado
            cover: data.media?.cover || data.cover || null,
            screenshot: data.media?.screenshot || data.screenshot || null,
            box3d: data.media?.box3d || data.box3d || null,
            description: data.description || '',
            maxPlayers: data.MaxPlayers || null,
            genres: data.Genres || null,
            version: data.version || '1.0',
            dateAdded: new Date().toISOString(),
            cheats: data.cheats || []
        }
    };
}

export function findGame(library, cid) {
    return library.find(game => gameCid(game) === cid) || null;
}

/** Mais recentes primeiro: último jogado, caindo para data de import. */
export function sortByRecent(list) {
    return [...list].sort((a, b) => {
        const timeA = new Date(a.lastPlayed || a.dateAdded).getTime();
        const timeB = new Date(b.lastPlayed || b.dateAdded).getTime();
        return timeB - timeA;
    });
}

/** Consoles presentes na biblioteca — é daqui que sai o menu lateral. */
export function systemsInLibrary(library) {
    return [...new Set(library.map(game => game.system))].filter(Boolean);
}

/** @returns {string} nome do arquivo gerado, para a mensagem de sucesso. */
export function downloadLibrary(library) {
    const nome = `cartucho-library-${new Date().toISOString().split('T')[0]}.json`;
    const blob = new Blob([JSON.stringify(library, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nome;
    link.click();
    URL.revokeObjectURL(url);
    return nome;
}

/** @returns {Promise<Array>} conteúdo do arquivo; rejeita se não for um array JSON. */
export function readLibraryFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const parsed = JSON.parse(e.target.result);
                if (!Array.isArray(parsed)) throw new Error('esperado um array');
                resolve(parsed);
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
    });
}

/**
 * Uma entrada de arquivo exportado só serve se der para abrir o jogo com ela: sem CID,
 * sem ROM ou com um core que este app não roda, o que entra na biblioteca é um card que
 * nunca abre. Antes qualquer array JSON passava direto.
 */
function entradaUtilizavel(game) {
    return !!(game && typeof game === 'object'
        && gameCid(game) && game.name && game.rom
        && SUPPORTED_CORES.includes(game.system));
}

/**
 * Separa o arquivo importado em três caixas, porque cada uma quer uma frase diferente
 * na tela: o que entra, o que já estava lá e o que não dá para usar.
 * @returns {{novos: Array, duplicados: number, invalidos: number}}
 */
export function classifyImport(current, imported) {
    const existing = new Set(current.map(gameCid).filter(Boolean));
    const novos = [];
    let duplicados = 0;
    let invalidos = 0;

    for (const game of imported) {
        if (!entradaUtilizavel(game)) { invalidos++; continue; }
        if (existing.has(gameCid(game))) { duplicados++; continue; }
        existing.add(gameCid(game)); // o próprio arquivo pode repetir o mesmo cartucho
        novos.push(game);
    }
    return { novos, duplicados, invalidos };
}

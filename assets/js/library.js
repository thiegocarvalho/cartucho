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

export function saveLibrary(library) {
    localStorage.setItem(STORAGE_KEYS.library, JSON.stringify(library));
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
    localStorage.setItem(STORAGE_KEYS.gateway, gateway);
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
    localStorage.setItem(STORAGE_KEYS.customGateways, JSON.stringify(lista));
}

export function saveLastWorkingGateway(gateway) {
    if (gateway) localStorage.setItem(STORAGE_KEYS.lastGateway, gateway);
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
        return { error: 'Cartucho inválido: faltam campos obrigatórios (name, system, rom_cid ou rom).' };
    }
    if (!SUPPORTED_CORES.includes(data.system)) {
        return { error: `Cartucho inválido: o core '${data.system}' não é suportado.` };
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

/** Dados suficientes para o card de preview do modal de import, sem normalizar tudo. */
export function previewFromManifest(data, cid) {
    if (!data.name || !data.system || !(data.rom || data.rom_cid)) return null;
    return {
        cartucho: cid,
        name: data.name,
        system: data.system,
        cover: data.media?.cover || data.cover || null,
        description: data.description || ''
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

export function downloadLibrary(library) {
    const blob = new Blob([JSON.stringify(library, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cartucho-library-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
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

/** Entradas do arquivo importado que ainda não existem na biblioteca atual. */
export function newGamesFrom(current, imported) {
    const existing = new Set(current.map(gameCid).filter(Boolean));
    return imported.filter(game => {
        const cid = gameCid(game);
        return cid && !existing.has(cid);
    });
}

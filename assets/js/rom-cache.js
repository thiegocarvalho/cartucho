// Cache local das ROMs, na Cache API.
//
// Um CID é o hash do conteúdo: o mesmo CID sempre devolve exatamente os mesmos bytes.
// Isso torna o cache permanente trivialmente correto — não existe invalidação a fazer,
// e evita rebaixar megabytes de um gateway público a cada vez que o jogo abre.
import {
    ROM_CACHE_NAME, ROM_CACHE_MAX_BYTES, STORAGE_KEYS, CACHE_LIMITE_PADRAO
} from './config.js';

/** A chave é o CID, não a URL: a mesma ROM vinda de outro gateway reaproveita o cache. */
const chave = (cid) => `/rom/${cid}`;

function cacheDisponivel() {
    // Cache API exige contexto seguro: https, localhost ou file:// não entra.
    return typeof caches !== 'undefined' && window.isSecureContext;
}

/** @returns {Promise<Blob|null>} */
export async function getCachedRom(cid) {
    if (!cacheDisponivel()) return null;
    try {
        const cache = await caches.open(ROM_CACHE_NAME);
        const hit = await cache.match(chave(cid));
        return hit ? await hit.blob() : null;
    } catch (e) {
        console.warn('Leitura do cache de ROM falhou', e);
        return null;
    }
}

/** Teto escolhido pelo usuário, em bytes. 0 = não guardar nada. */
export function loadCacheLimit() {
    const salvo = Number(localStorage.getItem(STORAGE_KEYS.cacheLimit));
    return Number.isFinite(salvo) && salvo >= 0 ? salvo : CACHE_LIMITE_PADRAO;
}

export function saveCacheLimit(bytes) {
    // Mesma tolerância das outras gravações: janela privada do Safari lança aqui.
    try {
        localStorage.setItem(STORAGE_KEYS.cacheLimit, String(bytes));
        return true;
    } catch (e) {
        console.error('Não foi possível gravar o limite de cache', e);
        return false;
    }
}

/** Entradas do cache, da mais antiga para a mais recente. */
async function entradasPorIdade(cache) {
    const chaves = await cache.keys();
    const entradas = await Promise.all(chaves.map(async (req) => {
        const resp = await cache.match(req);
        return {
            req,
            bytes: Number(resp?.headers.get('content-length')) || 0,
            quando: Date.parse(resp?.headers.get('X-Cartucho-Cached-At') || '') || 0
        };
    }));
    return entradas.sort((a, b) => a.quando - b.quando);
}

/**
 * Abre espaço para `precisa` bytes dentro do limite, descartando as ROMs guardadas há mais
 * tempo. A que está prestes a entrar é a mais recente, então nunca é a descartada.
 * @returns {Promise<boolean>} false se nem descartando tudo caberia
 */
async function abrirEspaco(cache, precisa, limite) {
    const entradas = await entradasPorIdade(cache);
    let usado = entradas.reduce((total, e) => total + e.bytes, 0);
    if (usado + precisa <= limite) return true;

    for (const entrada of entradas) {
        if (usado + precisa <= limite) break;
        await cache.delete(entrada.req);
        usado -= entrada.bytes;
    }
    return precisa <= limite;
}

async function putRom(cid, blob) {
    if (!cacheDisponivel() || blob.size > ROM_CACHE_MAX_BYTES) return;

    const limite = loadCacheLimit();
    if (limite <= 0) return; // cache desligado: a ROM roda, só não fica guardada
    if (blob.size > limite) return; // não adianta esvaziar tudo para algo que não cabe

    try {
        const cache = await caches.open(ROM_CACHE_NAME);
        if (!(await abrirEspaco(cache, blob.size, limite))) return;

        await cache.put(chave(cid), new Response(blob, {
            headers: {
                'Content-Type': 'application/octet-stream',
                'Content-Length': String(blob.size),
                'X-Cartucho-Cached-At': new Date().toISOString()
            }
        }));
    } catch (e) {
        // Cota estourada é o caso comum aqui, e não impede o jogo de rodar.
        console.warn('Não foi possível guardar a ROM no cache', e);
    }
}

/**
 * Quanto o navegador concede a esta origem e quanto já está em uso — números do próprio
 * navegador, não do nosso cache, então incluem localStorage e o resto.
 * @returns {Promise<{quota: number, uso: number}|null>}
 */
export async function storageEstimate() {
    if (!navigator.storage?.estimate) return null;
    try {
        const { quota = 0, usage = 0 } = await navigator.storage.estimate();
        return { quota, uso: usage };
    } catch (e) {
        return null;
    }
}

/**
 * Pede armazenamento persistente. Sem isso o navegador pode limpar o cache sozinho quando
 * o disco aperta. Firefox pergunta ao usuário; Chromium decide pelo histórico de uso.
 * @returns {Promise<boolean>}
 */
export async function requestPersistence() {
    if (!navigator.storage?.persist) return false;
    try {
        if (await navigator.storage.persisted()) return true;
        return await navigator.storage.persist();
    } catch (e) {
        return false;
    }
}

/**
 * Baixa a ROM relatando progresso e guarda no cache.
 * @param {string} url URL completa no gateway
 * @param {string} cid CID da ROM (chave do cache)
 * @param {(carregado: number, total: number) => void} [onProgress] total 0 = desconhecido
 * @returns {Promise<Blob>}
 */
export async function fetchRomWithProgress(url, cid, onProgress) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`gateway respondeu ${resp.status}`);

    const total = Number(resp.headers.get('content-length')) || 0;

    // Sem streaming legível, cai para o caminho simples — só perde a barra de progresso.
    if (!resp.body || !resp.body.getReader) {
        const blob = await resp.blob();
        await putRom(cid, blob);
        return blob;
    }

    const reader = resp.body.getReader();
    const pedacos = [];
    let carregado = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        pedacos.push(value);
        carregado += value.length;
        if (onProgress) onProgress(carregado, total);
    }

    const blob = new Blob(pedacos, { type: 'application/octet-stream' });
    await putRom(cid, blob);
    return blob;
}

/** @returns {Promise<{jogos: number, bytes: number}>} */
export async function romCacheStats() {
    if (!cacheDisponivel()) return { jogos: 0, bytes: 0 };
    try {
        const cache = await caches.open(ROM_CACHE_NAME);
        const chaves = await cache.keys();
        let bytes = 0;
        for (const req of chaves) {
            const resp = await cache.match(req);
            bytes += Number(resp?.headers.get('content-length')) || 0;
        }
        return { jogos: chaves.length, bytes };
    } catch (e) {
        return { jogos: 0, bytes: 0 };
    }
}

export async function clearRomCache() {
    if (!cacheDisponivel()) return;
    await caches.delete(ROM_CACHE_NAME);
}

export function formatBytes(bytes) {
    if (!bytes) return '0 MB';
    const mb = bytes / (1024 * 1024);
    // Sem casa decimal quando o número é redondo: "750 MB" lê melhor que "750.0 MB".
    const enxuto = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
    return mb >= 1024 ? `${enxuto(mb / 1024)} GB` : `${enxuto(mb)} MB`;
}

// Tudo que fala com a rede IPFS: parsing de CID, escolha de gateway e fetch de manifesto.
import {
    DEFAULT_GATEWAY, LOCAL_GATEWAY, GATEWAY_RACE_TIMEOUT,
    GATEWAY_TEST_TIMEOUT, GATEWAY_TEST_CID
} from './config.js';

/** CID v0 (Qm...) ou v1 (base32/base58/base64). */
const CID_PATTERN = 'Qm[1-9A-HJ-NP-Za-km-z]{44}|b[A-Za-z2-7]{58,}|B[A-Z2-7]{58,}|z[1-9A-HJ-NP-Za-km-z]{48,}|F[0-9A-F]{50,}';
const CID_EXACT = new RegExp(`^(${CID_PATTERN})$`);
const CID_LOOSE = new RegExp(`(${CID_PATTERN})`);

/**
 * Extrai um CID de uma string solta, validando o formato.
 * @returns {string|null} o CID, ou null se não houver um válido.
 */
export function sanitizeCID(text) {
    if (!text) return null;
    const match = text.match(CID_LOOSE);
    return match && CID_EXACT.test(match[0]) ? match[0] : null;
}

/**
 * Aceita CID cru, link de compartilhamento (?cartucho=CID) ou texto de QR code.
 * @returns {string|null}
 */
export function extractCID(text) {
    if (!text) return null;

    // Busca manual pelo parâmetro primeiro: funciona mesmo em URLs malformadas (file://).
    if (text.includes('cartucho=')) {
        const match = text.match(/[?&]cartucho=([^&?#\s"']+)/);
        if (match && match[1]) return sanitizeCID(match[1]);
    }

    try {
        const cartucho = new URL(text).searchParams.get('cartucho');
        if (cartucho) return sanitizeCID(cartucho);
    } catch (e) {
        // Não era URL; cai no parsing direto.
    }

    return sanitizeCID(text);
}

/** Monta a URL de um CID, deixando passar URLs http(s) e blob: já prontas. */
export function gatewayUrl(gateway, cidOrUrl) {
    if (!cidOrUrl) return null;
    if (cidOrUrl.startsWith('http') || cidOrUrl.startsWith('blob:')) return cidOrUrl;
    return `${gateway}${cidOrUrl}`;
}

/** Garante a barra final, sem a qual a concatenação com o CID quebra. */
export function normalizeGateway(gateway) {
    return gateway.endsWith('/') ? gateway : `${gateway}/`;
}

/**
 * Arruma o que a pessoa digitou: aceita "ipfs.exemplo.com", "https://ipfs.exemplo.com" ou
 * a URL completa com /ipfs/, e devolve sempre no formato que o app concatena com o CID.
 * @returns {{gateway: string}|{error: string}}
 */
export function parseGatewayInput(texto) {
    const cru = (texto || '').trim();
    if (!cru) return { error: 'Digite o endereço do gateway.' };

    const comEsquema = /^https?:\/\//i.test(cru) ? cru : `https://${cru}`;
    let url;
    try {
        url = new URL(comEsquema);
    } catch (e) {
        return { error: 'Endereço inválido.' };
    }
    if (!url.hostname.includes('.') && url.hostname !== 'localhost') {
        return { error: 'Endereço inválido.' };
    }

    // O caminho pode vir vazio, como /ipfs ou como /ipfs/ — tudo vira /ipfs/.
    let caminho = url.pathname.replace(/\/+$/, '');
    if (!caminho.endsWith('/ipfs')) caminho += '/ipfs';
    return { gateway: `${url.origin}${caminho}/` };
}

/**
 * Confere se um gateway responde a uma requisição cross-origin de verdade — o único
 * teste que importa, já que é assim que o app vai usá-lo.
 * @returns {Promise<{ok: true, ms: number}|{ok: false, motivo: string}>}
 */
export async function probeGateway(gateway) {
    const inicio = Date.now();
    try {
        const resp = await headWithTimeout(`${gateway}${GATEWAY_TEST_CID}`, GATEWAY_TEST_TIMEOUT);
        if (resp.ok) return { ok: true, ms: Date.now() - inicio };
        if (resp.status === 403) return { ok: true, ms: Date.now() - inicio, restrito: true };
        if (resp.status === 429) return { ok: false, motivo: 'o gateway está recusando por limite de uso' };
        return { ok: false, motivo: `o gateway respondeu ${resp.status}` };
    } catch (e) {
        return { ok: false, motivo: 'sem resposta, ou o gateway não permite acesso pelo navegador (CORS)' };
    }
}

/**
 * Busca o manifesto JSON de um Cartucho.
 * @returns {Promise<{data: object}|{error: 'unreachable'|'not-json'}>}
 */
export async function fetchCartucho(gateway, cid) {
    let response;
    try {
        response = await fetch(`${gateway}${cid}`);
    } catch (e) {
        return { error: 'unreachable' };
    }
    if (!response.ok) return { error: 'unreachable' };

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
        return { error: 'not-json' };
    }

    try {
        return { data: await response.json() };
    } catch (e) {
        return { error: 'not-json' };
    }
}

/**
 * Busca o manifesto tentando o gateway preferido e, se ele não responder, todos os
 * outros conhecidos em paralelo. Um gateway fora do ar não pode impedir o import
 * de um Cartucho que outro gateway tem.
 * @returns {Promise<{data: object, gateway: string}|{error: 'unreachable'|'not-json'}>}
 */
export async function fetchCartuchoAnywhere(preferred, gateways, cid) {
    const first = await fetchCartucho(preferred, cid);
    // 'not-json' significa que o CID foi encontrado e não é um Cartucho: nem tenta os outros.
    if (!first.error) return { ...first, gateway: preferred };
    if (first.error === 'not-json') return first;

    const others = usableGateways(gateways).filter(g => g !== preferred);
    if (others.length === 0) return first;

    console.warn(`Gateway ${preferred} não respondeu; tentando os demais.`);
    try {
        return await Promise.any(others.map(async (gateway) => {
            const result = await fetchCartucho(gateway, cid);
            if (result.error) throw new Error(result.error);
            return { ...result, gateway };
        }));
    } catch (e) {
        return { error: 'unreachable' };
    }
}

/** Remove gateways http: quando a página é https:, senão o browser bloqueia por mixed content. */
function usableGateways(gateways) {
    const isHttps = window.location.protocol === 'https:';
    return gateways.filter(g => !(isHttps && g.startsWith('http:')));
}

/**
 * `cache: 'no-store'` é essencial aqui: sem isso a segunda medição lê o cache do browser
 * e o gateway aparece com 7ms, escondendo se ele está lento ou fora do ar.
 */
async function headWithTimeout(url, timeout, signal) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    if (signal) signal.addEventListener('abort', () => controller.abort());
    try {
        return await fetch(url, { method: 'HEAD', cache: 'no-store', signal: controller.signal });
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Corre um HEAD contra os gateways e devolve o primeiro que responder.
 * @param {{preferred?: string, fallback?: string}} opts gateway do usuário (entra na corrida)
 *        e último gateway sabidamente vivo (usado se a corrida inteira falhar).
 * @returns {Promise<{gateway: string, label: string, fallback: boolean}>}
 */
export async function resolveFastestGateway(cid, gateways, opts = {}) {
    const { preferred, fallback } = opts;
    const candidates = usableGateways([...new Set([preferred, ...gateways].filter(Boolean))]);
    const raceController = new AbortController();

    const probe = async (baseUrl) => {
        const resp = await headWithTimeout(`${baseUrl}${cid}`, GATEWAY_RACE_TIMEOUT, raceController.signal);
        if (!resp.ok) throw new Error(`Gateway respondeu ${resp.status}`);
        return baseUrl;
    };

    try {
        const gateway = await Promise.any(candidates.map(probe));
        raceController.abort(); // cancela as requisições que ainda estão em voo
        return { gateway, label: new URL(gateway).hostname.toUpperCase(), fallback: false };
    } catch (e) {
        // Muito gateway público responde HEAD com 403/redirect sem CORS mesmo tendo o
        // conteúdo, então a corrida falhar não significa que a ROM é inalcançável.
        console.warn('Corrida de gateways falhou; usando o último que funcionou.', e);
        const chosen = usableGateways([fallback, DEFAULT_GATEWAY].filter(Boolean))[0] || LOCAL_GATEWAY;
        return { gateway: chosen, label: `${new URL(chosen).hostname.toUpperCase()} (FALLBACK)`, fallback: true };
    }
}

/**
 * Valida o CID fixo usado no teste de latência.
 *
 * `sanitizeCID` sozinha não basta aqui: ela extrai a maior sequência parecida com um CID
 * de dentro de um texto — comportamento certo para o que o usuário cola no import, e
 * errado para uma constante, onde sobra colada passa despercebida. Para a constante o
 * valor tem que ser exatamente o CID, com um comprimento que exista de verdade.
 * @returns {string|null} descrição do problema, ou null se estiver bom
 */
function checarCidDeTeste(cid) {
    if (!cid || typeof cid !== 'string') return 'vazio';
    if (cid !== cid.trim()) return 'tem espaço nas pontas';
    if (/\s/.test(cid)) return 'tem espaço no meio';
    if (sanitizeCID(cid) !== cid) return 'tem caractere sobrando';
    // v0 tem 46 caracteres; v1 base32 com sha2-256 (o caso normal) tem 59.
    const COMPRIMENTOS = [46, 59];
    if (!COMPRIMENTOS.includes(cid.length)) return `${cid.length} caracteres, esperado 46 ou 59`;
    return null;
}

/**
 * Mede a latência de cada gateway conhecido (tela de configurações).
 * @returns {Promise<Object<string, string>>} gateway -> "123ms" | "Timeout/Error"
 */
export async function measureGateways(gateways, onResult) {
    // Guarda: um CID de teste malformado faz todo gateway responder 400 e a tela acusar
    // gateways saudáveis como quebrados. Melhor falhar dizendo o que está errado.
    const problema = checarCidDeTeste(GATEWAY_TEST_CID);
    if (problema) {
        console.error(`GATEWAY_TEST_CID inválido (${problema}): "${GATEWAY_TEST_CID}". Confira config.js.`);
        return Object.fromEntries(gateways.map(g => [g, 'CID de teste inválido']));
    }

    // Em paralelo: sequencial custava até GATEWAY_TEST_TIMEOUT por gateway (a lista
    // inteira podia levar mais de 10s antes de mostrar qualquer resultado).
    // `onResult` entrega cada medição assim que chega: a lista vai preenchendo em vez de
    // ficar parada até o último gateway (que pode levar os 6s inteiros do timeout).
    const medidas = await Promise.all(gateways.map(async (gateway) => {
        const inicio = Date.now();
        let status;
        try {
            const resp = await headWithTimeout(`${gateway}${GATEWAY_TEST_CID}`, GATEWAY_TEST_TIMEOUT);
            const ms = Date.now() - inicio;
            if (resp.ok) status = `${ms}ms`;
            // 403 = gateway dedicado, vivo mas só serve o conteúdo da própria conta.
            else if (resp.status === 403) status = `${ms}ms (restrito)`;
            // 429 = vivo, mas recusando por limite de uso — não é gateway ruim.
            else if (resp.status === 429) status = 'limite atingido';
            else status = `HTTP ${resp.status}`;
        } catch (e) {
            status = 'sem resposta';
        }
        if (onResult) onResult(gateway, status);
        return [gateway, status];
    }));
    return Object.fromEntries(medidas);
}

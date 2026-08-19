// Constantes compartilhadas por todos os módulos.
// Não importa nada: é a folha da árvore de dependências.

/** Cores suportados pelo EmulatorJS. `system` do manifesto precisa estar aqui. */
export const SUPPORTED_CORES = [
    'nes', 'snes', 'gb', 'gba', 'vb', 'nds', 'a5200', 'mame2003', 'arcade', 'psx',
    'jaguar', 'lynx', 'segaSaturn', 'segaMD', 'segaGG', 'segaCD', 'n64', '3do',
    'atari7800', 'atari2600', 'sega32x', 'segaMS', 'c64', 'c128', 'pet', 'plus4',
    'vic20', 'amiga', 'coleco', 'pce', 'pcfx', 'ngp', 'ws', 'dos', 'psp'
];

/**
 * Lista fixa de gateways, ordenada por confiabilidade medida contra o conteúdo real do
 * projeto (manifesto + ROM), não contra um CID de teste qualquer:
 *
 *   filebase  200 em ~0,6s   |  rarible  200 em ~0,5s  |  pinata  200 em ~3,6s
 *
 * Critérios que um gateway precisa cumprir para entrar aqui:
 * 1. responder requisição cross-origin do browser — a maioria dos gateways famosos
 *    (ipfs.io, dweb.link, w3s.link, nftstorage.link, cloudflare-ipfs.com, 4everland,
 *    trustless-gateway, storry.tv) não responde, e o fetch falha mesmo com o conteúdo lá;
 * 2. efetivamente servir o conteúdo do projeto. Gateway que devolve 404 ou redirect não
 *    ajuda em nada — só gasta uma tentativa.
 *
 * ATENÇÃO ao testar: nem o navegador nem o curl provam CORS sozinhos. Vários gateways
 * mandam `Access-Control-Allow-Origin` quando TÊM o conteúdo e omitem quando não têm, então
 * o mesmo gateway "passa" com um CID e falha com outro. Teste com o CID que você quer servir.
 * (eu.orbitor.dev entrou nesta lista por um teste desses e depois dava timeout de 15s.)
 *
 * O Kubo local não entra: para quem não roda um nó, ele só gera ERR_CONNECTION_REFUSED em
 * toda operação. Quem roda acrescenta pela tela de configurações.
 */
export const KNOWN_GATEWAYS = [
    'https://ipfs.filebase.io/ipfs/',
    'https://ipfs.raribleuserdata.com/ipfs/',
    'https://gateway.pinata.cloud/ipfs/'
];

export const DEPRECATED_GATEWAYS = [
    'https://eu.orbitor.dev/ipfs/',
    'https://ipfs.io/ipfs/',
    'https://dweb.link/ipfs/',
    'https://cloudflare-ipfs.com/ipfs/',
    'https://cf-ipfs.com/ipfs/',
    'https://nftstorage.link/ipfs/',
    'https://w3s.link/ipfs/',
    'https://storry.tv/ipfs/',
    'https://4everland.io/ipfs/'
];

export const DEFAULT_GATEWAY = 'https://ipfs.filebase.io/ipfs/';
export const LOCAL_GATEWAY = 'http://127.0.0.1:8080/ipfs/';

export const STORAGE_KEYS = {
    library: 'cartucho_library',
    gateway: 'cartucho_gateway',
    lastGateway: 'cartucho_last_gateway',
    customGateways: 'cartucho_custom_gateways',
    cacheLimit: 'cartucho_cache_limit',
    netplay: 'cartucho_netplay_server'
};

/** Cache de ROMs (Cache API). Só sobe a versão se o formato do que é guardado mudar. */
export const ROM_CACHE_NAME = 'cartucho-roms-v1';
/** Acima disso a ROM vai direto do gateway para o emulador, sem passar pelo cache. */
export const ROM_CACHE_MAX_BYTES = 256 * 1024 * 1024;

const MB = 1024 * 1024;

/**
 * Cache de ROMs: o teto do controle deslizante é o que ESTE navegador concede
 * (navigator.storage.estimate), não um número escolhido por nós — desktop, celular e TV
 * dão quotas muito diferentes, e as TVs nem publicam a sua.
 */
export const CACHE_PASSO = 250 * MB;
/** Fração da quota que o controle deixa escolher; o resto fica de folga. */
export const CACHE_FRACAO_DA_QUOTA = 0.8;
/** Teto quando o navegador não sabe informar a quota. */
export const CACHE_MAX_FALLBACK = 1024 * MB;
/** Desligado por padrão: guardar megabytes no aparelho de alguém se pede, não se assume. */
export const CACHE_LIMITE_PADRAO = 0;

/** Timeout de cada HEAD na corrida de gateways (ms). */
export const GATEWAY_RACE_TIMEOUT = 6000;
/**
 * Prazo da primeira chance, dada só ao gateway escolhido pelo usuário (ms). Igual ao da
 * corrida de propósito: com um valor menor (2,5s foi tentado) o pinata, que responde em
 * ~3,6s, perdia a própria vez — quem o escolhia era sempre atendido por outro, e a
 * configuração não valia nada. Gateway fora do ar quase sempre falha na hora (DNS ou
 * conexão recusada), então o prazo cheio raramente é gasto de verdade.
 */
export const GATEWAY_PREFERIDO_TIMEOUT = GATEWAY_RACE_TIMEOUT;
/**
 * Timeout do teste manual de gateways (ms). Igual ao da corrida de propósito: com um
 * valor menor, gateway que o app usaria sem problema aparecia como "Timeout/Error".
 */
export const GATEWAY_TEST_TIMEOUT = GATEWAY_RACE_TIMEOUT;
/**
 * CID do "IPFS Gateway Checker" — o mesmo conteúdo que o projeto IPFS mantém pinado para
 * testar gateways (ipfs.github.io/public-gateway-checker). É a referência do ecossistema
 * para health check, então tem mais chance de estar disponível em qualquer gateway.
 *
 * CIDv1 base32 tem exatamente 59 caracteres. Um caractere a mais ou a menos faz o gateway
 * responder 400/404 e a tela de saúde acusar gateway bom como quebrado — por isso o valor
 * é validado em ipfs.js antes de qualquer medição.
 */
export const GATEWAY_TEST_CID = 'bafybeifx7yeb55armcsxwwitkymga5xf53dxiarykms3ygqic223w5sk3m';

/**
 * Quanto tempo a busca do manifesto pode ficar só com o spinner antes de o modal
 * explicar a demora. Menor que o timeout de um gateway de propósito: a espera longa
 * acontece justamente quando o preferido não responde e a corrida vai para os outros.
 */
export const IMPORT_AVISO_DEMORA = 3500;

/** Quanto tempo o status da câmera fica em "não é um Cartucho" antes de voltar a procurar. */
export const SCAN_AVISO_DURACAO = 2500;

/** Bibliotecas carregadas sob demanda — ver vendor.js. */
export const QRCODE_JS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
export const HTML5_QRCODE_URL = 'https://unpkg.com/html5-qrcode';

/**
 * `stable`, não `latest`: a documentação do EmulatorJS avisa que latest "occasionally be
 * broken" porque junta código novo com cores estáveis. Foi exatamente o que quebrou o save
 * state aqui — `gameManager.getState()` estourava com
 * "this.Module.EmulatorJSGetState is not a function", porque o loader chamava uma função
 * que o core servido não expõe.
 */
export const EJS_DATA_PATH = 'https://cdn.emulatorjs.org/stable/data/';
export const EJS_LOADER_URL = `${EJS_DATA_PATH}loader.js`;
export const EJS_LOADER_ID = 'ejs-loader';
/** Idiomas que o CDN do EmulatorJS realmente serve. */
export const EJS_LANGUAGES = ['en', 'pt', 'es', 'fr', 'de', 'it', 'zh', 'ja', 'ko'];

export const COLORS = {
    background: '#0a0a0c',
    primary: '#4f46e5'
};

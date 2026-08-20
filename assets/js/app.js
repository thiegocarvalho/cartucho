// Componente Alpine: só estado da UI e orquestração.
// A lógica de verdade mora nos módulos importados abaixo.
import {
    KNOWN_GATEWAYS, DEFAULT_GATEWAY, IMPORT_AVISO_DEMORA, SCAN_AVISO_DURACAO,
    CACHE_PASSO, CACHE_FRACAO_DA_QUOTA, CACHE_MAX_FALLBACK
} from './config.js';
import { ICONS } from './icons.js';
import {
    extractCID, gatewayUrl, normalizeGateway, fetchCartuchoAnywhere,
    resolveFastestGateway, measureGateways, parseGatewayInput, probeGateway
} from './ipfs.js';
import {
    loadLibrary, saveLibrary, loadGatewayPreference, saveGatewayPreference,
    normalizeCartucho, findGame, gameCid, sortByRecent,
    systemsInLibrary, downloadLibrary, readLibraryFile, classifyImport,
    loadLastWorkingGateway, saveLastWorkingGateway,
    loadCustomGateways, saveCustomGateways,
    loadNetplayServer, saveNetplayServer
} from './library.js';
import {
    getCachedRom, fetchRomWithProgress, romCacheStats, clearRomCache, formatBytes,
    loadCacheLimit, saveCacheLimit, storageEstimate, requestPersistence
} from './rom-cache.js';
import {
    applyEmulatorDefaults, configureEmulator, bootEmulator, isEmulatorLoaded,
    syncUrlToGame, reloadWithGame, reloadToPage, parseNetplayServer
} from './emulator.js';
import { gamepadModule } from './gamepad.js';
import { loadQrGenerator, loadQrScanner } from './vendor.js';
import { aplicarMetaDoJogo } from './page-meta.js';

/** Só o host, para dizer de onde o cartucho veio sem despejar a URL inteira. */
function hostOf(url) {
    try {
        return new URL(url).hostname;
    } catch (e) {
        return '';
    }
}

export function cartuchoApp() {
    return {
        ...gamepadModule(),

        // ---- Estado global ----
        library: [],
        activePage: 'Home',
        activeGatewayName: '',
        sidebarOpen: false,
        isPlaying: false,
        isEmulatorLoading: false,
        currentGame: null,
        emulatorError: '',
        errorMessage: '',
        /**
         * Recursos que só existem em contexto seguro (https, localhost ou 127.0.0.1).
         * Servir por 0.0.0.0 ou por IP da rede desliga cache de ROM, área de transferência
         * e câmera — sem aviso nenhum do navegador.
         */
        get contextoInseguro() {
            return !window.isSecureContext && window.location.protocol !== 'file:';
        },

        /** Progresso do download da ROM: 0-100, ou -1 quando o tamanho é desconhecido. */
        romProgress: 0,
        romFromCache: false,
        cacheStats: { jogos: 0, bytes: 0 },
        /** Limite escolhido, em bytes. 0 = desligado. */
        cacheLimitBytes: 0,
        /** Teto do controle: o que este navegador concede, com folga. */
        cacheMaxBytes: CACHE_MAX_FALLBACK,
        /**
         * null enquanto o navegador não respondeu. Booleano cru fazia a tela de
         * configurações piscar o aviso "o navegador pode limpar" para quem já tem
         * armazenamento persistente, porque `activePage` muda na hora e a resposta é async.
         */
        cachePersistente: null,
        /** Mudança de limite esperando confirmação, quando ela apaga o que está guardado. */
        pendingCacheLimit: null,
        searchQuery: '',
        ipfsGateway: loadGatewayPreference(DEFAULT_GATEWAY),
        /** Último gateway que respondeu de fato — melhor palpite que um padrão fixo. */
        lastWorkingGateway: loadLastWorkingGateway(),
        /** Gateways acrescentados pelo usuário, somados à lista fixa. */
        customGateways: loadCustomGateways(),
        gatewayStatus: {},
        /** Estado do teste de latência: '' | 'testando'. */
        testingGateways: false,
        /** Formulário de gateway novo. */
        showAddGateway: false,
        newGateway: '',
        addingGateway: false,
        addGatewayError: '',
        /** Servidor de NetPlay (EmulatorJS). Vazio = jogar em rede desligado. */
        netplayServer: loadNetplayServer(),
        netplayCampo: loadNetplayServer(),
        netplayErro: '',
        /**
         * Teclado na tela: com o controle na mão não existe onde digitar um CID — em TV e
         * no sofá não há teclado físico, e o teclado do sistema não abre para um <input>
         * comum. Só entra em cena quando há controle conectado.
         */
        tecladoAberto: false,
        tecladoMaiusculas: false,
        showImportModal: false,
        showShareModal: false,

        // ---- Estado do import ----
        importMode: 'manual', // 'manual' | 'scan'
        /**
         * Busca do manifesto: '' | 'checando' | 'ok' | 'erro'.
         * Antes só existia `scanPending`, e a falha era silenciosa: o spinner sumia e nada
         * aparecia, então CID errado, gateway fora do ar e conteúdo que não é Cartucho
         * eram todos a mesma tela parada.
         */
        importStatus: '',
        /** Motivo legível da falha, mostrado no lugar do card. */
        importErro: '',
        /** A busca passou do tempo confortável — avisa em vez de deixar o spinner mudo. */
        importDemorado: false,
        /** Cartucho já normalizado pelo preview; o import reaproveita em vez de rebuscar. */
        previewGame: null,
        /** CID a que o preview pertence, para não misturar resposta de outro CID. */
        previewCid: '',
        /** Host do gateway que respondeu — de onde o cartucho veio. */
        previewGateway: '',
        /** Validação do campo manual: '' | 'valido' | 'invalido'. */
        cidStatus: '',
        /** Import em andamento: '' | 'guardar' | 'jogar'. */
        importando: '',
        /** Câmera: '' | 'carregando' | 'ativa' | 'erro'. */
        cameraStatus: '',
        cameraErro: '',
        /**
         * O que a câmera está enxergando: '' | 'procurando' | 'invalido' | 'achou'.
         * Substitui o enquadramento desenhado por cima do vídeo (um quadrado de 250px
         * fixo sobre um vídeo responsivo, sempre torto) por uma linha de status: o
         * problema real era não haver sinal nenhum ao ler um QR que não é Cartucho.
         */
        scanStatus: '',
        html5QrCode: null,
        newCID: '',
        copyFeedback: false,
        toastMessage: '',
        shareGame: null,
        /** Jogo aguardando confirmação de exclusão. */
        pendingDelete: null,

        // ---------------------------------------------------------------- boot

        initData() {
            this.library = loadLibrary();
            this.ipfsGateway = normalizeGateway(this.ipfsGateway);
            applyEmulatorDefaults({ netplayServer: this.netplayServer });
            this.registerFocusWatchers();

            const params = new URLSearchParams(window.location.search);

            // ?page= é como stopGame() devolve o usuário para a aba certa após o reload.
            const page = params.get('page');
            if (page && (page === 'Settings' || this.menuItems.some(item => item.name === page))) {
                this.activePage = page;
                if (page === 'Settings') this.refreshCacheStats();
            }

            // Ação pedida antes de sair do jogo (o clique não sobrevive ao recarregamento).
            if (params.get('acao') === 'importar') {
                this.showImportModal = true;
                const limpa = new URL(window.location);
                limpa.searchParams.delete('acao');
                window.history.replaceState({}, '', limpa);
            }

            const initialCid = params.get('cartucho');
            if (initialCid) this.loadFromQuery(initialCid);

            this.initGamepad();
        },

        /** O cache de foco do controle precisa morrer sempre que a UI visível muda. */
        registerFocusWatchers() {
            const invalidate = () => this.$nextTick(() => this.updateFocusCache());
            // importStatus/importMode/cameraStatus entram aqui porque cada estado do modal
            // de import troca os botões da tela — sem invalidar, o controle continua
            // navegando por botões que não existem mais.
            ['showImportModal', 'showShareModal', 'importStatus', 'importMode', 'cameraStatus',
                'tecladoAberto', 'pendingDelete', 'pendingCacheLimit',
                'activePage', 'library', 'searchQuery'].forEach(prop => this.$watch(prop, invalidate));

            // Trocar maiúsculas recria as teclas: além de refazer o cache, é preciso
            // repintar o anel de foco, senão ele some até a próxima direção apertada.
            this.$watch('tecladoMaiusculas', () => this.$nextTick(() => {
                this.updateFocusCache();
                this.refocarAtual();
            }));
        },

        // ------------------------------------------------------------ derivados

        /** Lista fixa + os que o usuário acrescentou. */
        get knownGateways() {
            return [...KNOWN_GATEWAYS, ...this.customGateways];
        },

        isCustomGateway(gateway) {
            return this.customGateways.includes(gateway);
        },

        getMediaUrl(cidOrUrl) {
            return gatewayUrl(this.ipfsGateway, cidOrUrl);
        },

        get shareLink() {
            const cid = this.shareGame && gameCid(this.shareGame);
            if (!cid) return '';
            // origin é "null" quando aberto por file://
            const origin = window.location.origin === 'null' ? '' : window.location.origin;
            return `${origin}${window.location.pathname}?cartucho=${cid}`;
        },

        /** Quantos consoles distintos o acervo tem. */
        get totalDeConsoles() {
            return systemsInLibrary(this.library).length;
        },

        /** Menu lateral derivado da biblioteca: um console só aparece quando tem jogo dele. */
        get menuItems() {
            return [
                { name: 'Home', system: 'all', icon: ICONS.home },
                ...systemsInLibrary(this.library).map(system => ({
                    name: system, system, icon: ICONS.cartridge
                }))
            ];
        },

        get filteredLibrary() {
            const activeSystem = this.menuItems.find(item => item.name === this.activePage)?.system;
            const query = this.searchQuery.toLowerCase();

            return sortByRecent(this.library.filter(game => {
                if (activeSystem && activeSystem !== 'all' && game.system !== activeSystem) return false;
                if (query && !game.name.toLowerCase().includes(query)) return false;
                return true;
            }));
        },

        /** Destaque da home: o último jogado do contexto atual, senão o mais recente. */
        get featuredGame() {
            const list = this.filteredLibrary;
            if (list.length === 0) return null;
            return list.find(game => game.lastPlayed) || list[0];
        },

        // -------------------------------------------------------------- jogar

        async loadFromQuery(cid) {
            this.isEmulatorLoading = true;
            try {
                let game = findGame(this.library, cid);

                if (!game) {
                    const { data, error, gateway } = await fetchCartuchoAnywhere(this.ipfsGateway, this.knownGateways, cid);
                    if (gateway) this.rememberGateway(gateway);
                    if (error) {
                        this.flashError(this.mensagemDeFalha(error));
                        return;
                    }

                    const result = normalizeCartucho(data, cid);
                    if (result.error) {
                        this.flashError(result.error);
                        return;
                    }

                    game = result.game;
                    this.library.unshift(game);
                    this.salvarAcervo();
                }

                // await de verdade: sem isso o finally abaixo apagava a tela de boot
                // enquanto a ROM ainda estava baixando.
                await this.loadGame(game);
            } catch (e) {
                console.error('Falha ao carregar o jogo da URL', e);
                this.flashError('Could not load the Cartucho from the URL.');
                this.isEmulatorLoading = false;
            }
        },

        async loadGame(game) {
            const cid = gameCid(game);

            // Com o emulador já rodando, trocar de jogo em memória não é confiável:
            // recarrega a página com o CID novo e deixa initData() cuidar do resto.
            if (isEmulatorLoaded() && this.isPlaying && gameCid(this.currentGame || {}) !== cid) {
                reloadWithGame(cid);
                return;
            }

            this.isPlaying = true;
            this.isEmulatorLoading = true;
            this.currentGame = game;

            const index = this.library.findIndex(item => gameCid(item) === cid);
            if (index !== -1) {
                this.library[index].lastPlayed = new Date().toISOString();
                this.salvarAcervo();
            }

            // A resolução da ROM entra no try junto do boot: ela vem ANTES da tela de
            // boot existir na cabeça de quem lê, mas `isPlaying` já é true aqui, então o
            // overlay está visível — uma exceção fora do try o deixaria na tela para
            // sempre, sem mensagem e sem saída.
            try {
                const romUrl = await this.resolveRomUrl(game);

                syncUrlToGame(cid);
                aplicarMetaDoJogo(game, this.getMediaUrl(game.cover || game.screenshot));
                configureEmulator(game, romUrl, this.getMediaUrl(game.cover), {
                    netplayServer: this.netplayServer
                });

                // Deixa o Alpine pintar o #game-container antes do emulador procurar por ele.
                await this.$nextTick();
                await bootEmulator();
                this.emulatorError = '';
            } catch (e) {
                // NUNCA recarregar a página aqui: o reload cai de volta em ?cartucho=,
                // que chama loadGame de novo — se a falha persistir, vira loop infinito.
                console.error('Falha ao iniciar o EmulatorJS', e);
                this.emulatorError = 'Could not start the emulator. Check your connection and try again.';
            } finally {
                this.isEmulatorLoading = false;
            }
        },

        /**
         * URL que o emulador vai consumir. Ordem: cache local -> download com progresso
         * (que já popula o cache) -> URL crua do gateway, deixando o EmulatorJS baixar.
         */
        async resolveRomUrl(game) {
            this.romProgress = 0;
            this.romFromCache = false;

            const cached = await getCachedRom(game.rom);
            if (cached) {
                this.romFromCache = true;
                this.activeGatewayName = 'CACHE_LOCAL';
                this.romProgress = 100;
                return this.toBlobUrl(cached);
            }

            const { gateway, label } = await resolveFastestGateway(game.rom, this.knownGateways, {
                preferred: this.ipfsGateway,
                fallback: this.lastWorkingGateway
            });
            this.activeGatewayName = label;
            const direta = `${gateway}${game.rom}`;

            try {
                const blob = await fetchRomWithProgress(direta, game.rom, (carregado, total) => {
                    const pct = total ? Math.round((carregado / total) * 100) : -1;
                    if (pct !== this.romProgress) this.romProgress = pct;
                });
                this.rememberGateway(gateway);
                this.romProgress = 100;
                return this.toBlobUrl(blob);
            } catch (e) {
                // Baixar por conta própria é otimização; se falhar, o emulador tenta sozinho.
                console.warn('Download com progresso falhou; entregando a URL do gateway.', e);
                this.romProgress = -1;
                return direta;
            }
        },

        toBlobUrl(blob) {
            if (this._romBlobUrl) URL.revokeObjectURL(this._romBlobUrl);
            this._romBlobUrl = URL.createObjectURL(blob);
            return this._romBlobUrl;
        },
        _romBlobUrl: null,

        rememberGateway(gateway) {
            this.lastWorkingGateway = gateway;
            // Sem `confirmarGravacao` de propósito: isto roda a cada download, sem o
            // usuário ter pedido nada, e é só um palpite para a próxima corrida. Falhar
            // aqui não muda nada que ele veja — avisar seria ruído.
            saveLastWorkingGateway(gateway);
        },

        cachePasso: CACHE_PASSO,

        /** Rótulo do valor atual. */
        get cacheLimiteRotulo() {
            return this.cacheLimitBytes > 0 ? formatBytes(this.cacheLimitBytes) : 'Off';
        },

        async refreshCacheStats() {
            this.cacheStats = await romCacheStats();
            this.cacheLimitBytes = loadCacheLimit();

            // O teto do controle vem do navegador; sem essa informação, um padrão conservador.
            const estimativa = await storageEstimate();
            const teto = estimativa?.quota
                ? Math.floor(estimativa.quota * CACHE_FRACAO_DA_QUOTA / CACHE_PASSO) * CACHE_PASSO
                : CACHE_MAX_FALLBACK;
            this.cacheMaxBytes = Math.max(CACHE_PASSO, teto);

            this.cachePersistente = navigator.storage?.persisted ? await navigator.storage.persisted() : false;
        },

        /**
         * Ponto de entrada do controle deslizante. Reduzir o teto descarta ROMs já baixadas,
         * então isso não acontece sem confirmação — é minuto de download alheio.
         */
        pedirLimiteDeCache(bytes) {
            const limite = Math.max(0, Math.min(Number(bytes) || 0, this.cacheMaxBytes));
            if (this.cacheStats.bytes > limite) {
                this.pendingCacheLimit = { bytes: limite, liberar: this.cacheStats.bytes, jogos: this.cacheStats.jogos };
                return;
            }
            this.aplicarLimiteDeCache(limite);
        },

        confirmarLimiteDeCache() {
            const pendente = this.pendingCacheLimit;
            this.pendingCacheLimit = null;
            if (pendente) this.aplicarLimiteDeCache(pendente.bytes);
        },

        /** Cancelar devolve o controle ao valor que está valendo. */
        cancelarLimiteDeCache() {
            this.pendingCacheLimit = null;
            this.cacheLimitBytes = loadCacheLimit();
        },

        async aplicarLimiteDeCache(bytes) {
            const limite = Math.max(0, Math.min(Number(bytes) || 0, this.cacheMaxBytes));
            this.cacheLimitBytes = limite;
            // Sem gravar, o limite volta ao valor antigo no reload e o cache passa a
            // guardar (ou descartar) por um teto diferente do que a tela mostra.
            if (!this.confirmarGravacao(saveCacheLimit(limite))) return;

            // Ligar o cache é o momento de pedir armazenamento persistente: sem isso o
            // navegador pode limpar tudo sozinho quando o disco aperta.
            if (limite > 0 && !this.cachePersistente) {
                this.cachePersistente = await requestPersistence();
            }

            // Diminuir o teto precisa valer para o que já está guardado.
            if (this.cacheStats.bytes > limite) await clearRomCache();
            await this.refreshCacheStats();
            this.flashToast(limite === 0 ? 'Cache off' : `Storing up to ${formatBytes(limite)}`);
        },

        async clearCache() {
            const antes = this.cacheStats.bytes;
            await clearRomCache();
            await this.refreshCacheStats();
            this.flashToast(`${formatBytes(antes)} freed`);
        },

        formatBytes,

        stopGame(targetPage = 'Home', opts = {}) {
            reloadToPage(targetPage, opts);
        },

        // ------------------------------------------------- teclado na tela

        /** Teclas do teclado virtual, na ordem em que aparecem. */
        get tecladoTeclas() {
            const letras = 'abcdefghijklmnopqrstuvwxyz'.split('');
            return [
                ...'0123456789'.split(''),
                ...(this.tecladoMaiusculas ? letras.map(l => l.toUpperCase()) : letras)
            ];
        },

        abrirTeclado(input) {
            this._tecladoAlvo = input;
            this.tecladoAberto = true;
        },

        fecharTeclado() {
            this.tecladoAberto = false;
            this._tecladoAlvo = null;
        },
        _tecladoAlvo: null,

        /**
         * Escreve direto no elemento e avisa o Alpine: o `x-model` do campo escuta `input`,
         * e sem disparar o evento o valor aparecia na tela sem nunca chegar ao componente.
         */
        escreverNoAlvo(valor) {
            const el = this._tecladoAlvo;
            if (!el) return;
            el.value = valor;
            el.dispatchEvent(new Event('input', { bubbles: true }));
        },

        digitar(caractere) {
            if (this._tecladoAlvo) this.escreverNoAlvo(this._tecladoAlvo.value + caractere);
        },

        apagarUltimo() {
            if (this._tecladoAlvo) this.escreverNoAlvo(this._tecladoAlvo.value.slice(0, -1));
        },

        limparCampo() {
            this.escreverNoAlvo('');
        },

        /** Digitar 46 caracteres no controle é castigo; colar resolve quando o sistema deixa. */
        async colarNoCampo() {
            try {
                const texto = await navigator.clipboard.readText();
                if (texto) this.escreverNoAlvo(texto.trim());
            } catch (e) {
                this.flashError('This browser did not allow reading the clipboard.');
            }
        },

        // ------------------------------------------------------------- import

        /** CID válido dentro do campo — aceita o CID puro, o link ou o texto do QR. */
        get cidAtual() {
            return extractCID(this.newCID);
        },

        /** O cartucho do campo já está guardado? Muda o que os botões oferecem. */
        get jogoJaNaBiblioteca() {
            const cid = this.cidAtual;
            return cid ? findGame(this.library, cid) : null;
        },

        /** Erro de rede em linguagem de gente, igual nos três caminhos de import. */
        mensagemDeFalha(error) {
            return error === 'not-json'
                ? 'This CID exists, but it is not a Cartucho: the content is not JSON.'
                : 'No gateway answered for this CID. It may not be propagated on the public network yet.';
        },

        async startScanner() {
            this.importMode = 'scan';
            // Já rodando: clicar de novo na aba Camera chamaria `start()` com o leitor em
            // SCANNING, que lança de forma síncrona — fora do `.catch()` encadeado — e
            // deixaria o overlay preso em "Opening_Camera" sobre uma câmera viva.
            if (this.cameraStatus === 'ativa' || this.cameraStatus === 'carregando') return;
            this.scanStatus = '';
            this.cameraErro = '';
            this.cameraStatus = 'carregando';
            try {
                await loadQrScanner();
            } catch (e) {
                this.cameraStatus = 'erro';
                this.cameraErro = 'Could not load the QR reader. Check your connection.';
                return;
            }
            this.$nextTick(() => {
                if (!this.html5QrCode) this.html5QrCode = new Html5Qrcode('reader');
                // Sem `qrbox`: ele desenha um enquadramento de tamanho fixo sobre um vídeo
                // que é responsivo, e o desenho só coincide com o vídeo por acidente. Sem
                // ele a leitura vale o quadro inteiro, que é mais fácil de acertar.
                const config = { fps: 10 };
                this.html5QrCode
                    .start({ facingMode: 'environment' }, config, (text) => this.onScanSuccess(text))
                    .then(() => {
                        this.cameraStatus = 'ativa';
                        this.scanStatus = 'procurando';
                    })
                    .catch(err => {
                        // Cair calado no modo manual escondia o motivo. Cada motivo tem
                        // uma saída diferente, então o motivo tem que aparecer.
                        console.error('Erro ao iniciar o scanner', err);
                        this.cameraStatus = 'erro';
                        if (this.contextoInseguro) {
                            this.cameraErro = 'The camera only works on https or localhost.';
                        } else if (err && (err.name === 'NotAllowedError' || /permission/i.test(String(err)))) {
                            this.cameraErro = 'Camera permission denied. Allow access in your browser settings.';
                        } else if (err && err.name === 'NotFoundError') {
                            this.cameraErro = 'No camera found on this device.';
                        } else {
                            this.cameraErro = 'Could not open the camera. Another app may be using it.';
                        }
                    });
            });
        },

        async stopScanner() {
            this.cameraStatus = '';
            this.scanStatus = '';
            clearTimeout(this._scanTimer);
            if (this.html5QrCode && this.html5QrCode.isScanning) {
                await this.html5QrCode.stop();
            }
        },

        /** Saída do modo câmera oferecida junto de cada erro dela. */
        usarModoManual() {
            this.importMode = 'manual';
            this.scanStatus = '';
            this.stopScanner().catch(e => console.warn('Falha ao parar o scanner', e));
        },

        resetImport() {
            this.stopScanner().catch(e => console.warn('Falha ao parar o scanner', e));
            this.newCID = '';
            this.cidStatus = '';
            this.importando = '';
            this.cameraErro = '';
            this.scanStatus = '';
            // Sem fechar o teclado, ele fica flutuando sobre a biblioteca, prendendo o foco
            // do controle e escrevendo num campo que já não está na tela.
            this.fecharTeclado();
            this.limparPreview();
            this.showImportModal = false;
        },

        limparPreview() {
            // Invalida a busca em voo: sem isto, um preview de 12s (gateway preferido
            // mudo + corrida) resolvia DEPOIS do modal fechado, repunha importStatus='ok'
            // com o cartucho antigo, e a próxima abertura mostrava um preview fantasma sem
            // CID no campo — com Guardar e Jogar desligados e sem como voltar às abas.
            this._previewToken++;
            clearTimeout(this._demoraTimer);
            this.importStatus = '';
            this.importErro = '';
            this.importDemorado = false;
            this.previewGame = null;
            this.previewCid = '';
            this.previewGateway = '';
        },
        _demoraTimer: null,
        _scanTimer: null,
        /** Sequência das buscas: resposta atrasada de um CID antigo não troca o card atual. */
        _previewToken: 0,

        onScanSuccess(text) {
            const cid = extractCID(text);
            if (!cid) {
                // Antes um QR qualquer não produzia nada: nem erro, nem sinal de que a
                // câmera tinha enxergado. Acusa a leitura e volta a procurar sozinho.
                this.scanStatus = 'invalido';
                clearTimeout(this._scanTimer);
                this._scanTimer = setTimeout(() => {
                    if (this.scanStatus === 'invalido') this.scanStatus = 'procurando';
                }, SCAN_AVISO_DURACAO);
                return;
            }
            // A ordem importa: `stopScanner` limpa scanStatus/cameraStatus de forma
            // síncrona, então marcar 'achou' antes dele deixava o estado verde inalcançável
            // e o overlay caía no spinner "Opening_Camera" durante a busca do manifesto,
            // como se a câmera estivesse reabrindo.
            this.stopScanner().catch(e => console.warn('Falha ao parar o scanner', e));
            this.scanStatus = 'achou';
            this.newCID = cid;
            this.cidStatus = 'valido';
            this.fetchPreview(cid);
        },

        onManualInput() {
            const cru = this.newCID.trim();
            if (!cru) {
                this.cidStatus = '';
                this.limparPreview();
                return;
            }

            const cid = extractCID(cru);
            if (!cid) {
                // O pior silêncio do fluxo: o campo aceitava qualquer coisa e o erro só
                // aparecia depois do clique em Jogar.
                this.cidStatus = 'invalido';
                this.limparPreview();
                return;
            }

            this.cidStatus = 'valido';
            this.newCID = cid; // link colado vira o CID em si, para o usuário ver o que entrou
            if (cid !== this.previewCid) this.fetchPreview(cid);
        },

        /** Repete a busca do preview sem obrigar o usuário a recolar o CID. */
        tentarDeNovo() {
            const cid = this.previewCid || this.cidAtual;
            if (cid) this.fetchPreview(cid);
        },

        /**
         * Busca e valida o manifesto antes de confirmar o import. Toda saída — inclusive
         * as falhas — vira estado visível: a busca pode levar segundos por causa dos
         * timeouts de gateway, e demora e erro são indistinguíveis sem isso.
         */
        async fetchPreview(input) {
            const cid = extractCID(input);
            if (!cid) return;

            const token = ++this._previewToken;
            this.limparPreview();
            this.importStatus = 'checando';
            this.previewCid = cid;
            this._demoraTimer = setTimeout(() => {
                if (token === this._previewToken) this.importDemorado = true;
            }, IMPORT_AVISO_DEMORA);

            const { data, error, gateway } = await fetchCartuchoAnywhere(this.ipfsGateway, this.knownGateways, cid);
            if (token !== this._previewToken) return; // outro CID entrou no campo nesse meio-tempo

            clearTimeout(this._demoraTimer);
            this.importDemorado = false;
            if (gateway) this.rememberGateway(gateway);

            if (error) {
                this.importStatus = 'erro';
                this.importErro = this.mensagemDeFalha(error);
                return;
            }

            // normalizeCartucho e não um preview solto: assim o core não suportado aparece
            // agora, e não depois do clique em Jogar.
            const { game, error: invalido } = normalizeCartucho(data, cid);
            if (invalido) {
                this.importStatus = 'erro';
                this.importErro = invalido;
                return;
            }

            this.previewGame = game;
            this.previewGateway = hostOf(gateway);
            this.importStatus = 'ok';
        },

        /** @param {{play?: boolean}} [opts] play:false apenas guarda na biblioteca. */
        async importCartucho(opts = {}) {
            const jogar = opts.play !== false;
            const cid = this.cidAtual;
            if (!cid) {
                this.cidStatus = 'invalido';
                this.flashError('Invalid CID. Check the format.');
                return;
            }
            if (this.importando) return;

            const existing = findGame(this.library, cid);
            if (existing) {
                this.resetImport();
                if (jogar) this.loadGame(existing);
                else this.flashToast(`${existing.name} is already in your library`);
                return;
            }

            // Estado no próprio botão: a tela de boot do emulador aparecia até para
            // "Guardar", que não abre jogo nenhum.
            this.importando = jogar ? 'jogar' : 'guardar';
            try {
                // O preview já baixou e validou este manifesto — repetir a busca só fazia
                // o botão ficar parado mais alguns segundos.
                let game = this.previewCid === cid ? this.previewGame : null;

                if (!game) {
                    const { data, error, gateway } = await fetchCartuchoAnywhere(this.ipfsGateway, this.knownGateways, cid);
                    if (gateway) this.rememberGateway(gateway);
                    this.previewCid = cid;
                    if (error) {
                        this.importStatus = 'erro';
                        this.importErro = this.mensagemDeFalha(error);
                        return;
                    }

                    const result = normalizeCartucho(data, cid);
                    if (result.error) {
                        this.importStatus = 'erro';
                        this.importErro = result.error;
                        return;
                    }
                    game = result.game;
                }

                this.library.unshift(game);
                this.salvarAcervo();
                this.flashToast(`${game.name} added to your library`);
                this.resetImport();

                if (jogar) this.loadGame(game);
            } finally {
                this.importando = '';
            }
        },
        /**
         * Exclusão pede confirmação — o CID some junto e o usuário pode não tê-lo salvo.
         * Confirmação é inline, não window.confirm: diálogo nativo congela a página e o
         * emulador junto.
         */
        confirmDelete(game) {
            if (!gameCid(game)) return;
            this.pendingDelete = game;
        },

        cancelDelete() {
            this.pendingDelete = null;
        },

        commitDelete() {
            const cid = gameCid(this.pendingDelete || {});
            this.pendingDelete = null;
            if (cid) this.deleteGame(cid);
        },

        deleteGame(cid) {
            this.library = this.library.filter(game => gameCid(game) !== cid);
            this.salvarAcervo();
        },

        /**
         * Único ponto de gravação do acervo. Antes cada caminho chamava `saveLibrary` e
         * ninguém olhava o resultado: com o localStorage recusando (janela privada, quota
         * cheia) o cartucho sumia no recarregamento sem nunca ter aparecido um aviso.
         * @returns {boolean}
         */
        salvarAcervo() {
            if (!saveLibrary(this.library)) {
                this.flashError('The browser refused to save your library. In a private window, or with storage full, the collection will not survive closing this tab.');
                return false;
            }
            this.garantirPersistencia();
            return true;
        },

        /**
         * Aviso único para as gravações que não são o acervo (gateway, cache, netplay).
         * Sem isto o toast anunciava "Using filebase.io" mesmo quando o navegador tinha
         * recusado a escrita, e a escolha voltava ao valor antigo no recarregamento.
         * @returns {boolean} repassa o resultado, para quem chama poder parar antes do toast
         */
        confirmarGravacao(ok) {
            if (!ok) {
                this.flashError('The browser refused to save this setting. In a private window, or with storage full, it will not survive a reload.');
            }
            return ok;
        },

        /**
         * Pede armazenamento persistente assim que existe acervo a perder. Isso só
         * acontecia ao ligar o cache de ROMs, mas a biblioteca corre o mesmo risco: o
         * Safari apaga dados de origem sem visita há sete dias, e leva o acervo junto.
         */
        async garantirPersistencia() {
            if (this._persistenciaPedida || this.library.length === 0) return;
            this._persistenciaPedida = true;
            this.cachePersistente = await requestPersistence();
        },
        _persistenciaPedida: false,

        // ---------------------------------------------------- backup / gateway

        exportLibrary() {
            // Exportar acervo vazio gera um arquivo `[]` que não serve para nada e não
            // dava sinal nenhum na tela — o clique parecia não ter funcionado.
            if (this.library.length === 0) {
                this.flashError('There are no cartridges to export.');
                return;
            }
            const nome = downloadLibrary(this.library);
            const quantos = this.library.length === 1 ? '1 cartridge' : `${this.library.length} cartridges`;
            this.flashToast(`${quantos} in ${nome}`);
        },

        async importLibrary(event) {
            const input = event.target;
            const file = input.files[0];
            if (!file) return;

            try {
                const imported = await readLibraryFile(file);
                const { novos, duplicados, invalidos } = classifyImport(this.library, imported);

                if (novos.length > 0) {
                    this.library = [...novos, ...this.library];
                    this.salvarAcervo();
                    this.flashToast(this.resumoDoImport(novos.length, duplicados, invalidos));
                } else if (duplicados > 0) {
                    // Não é erro: o arquivo estava certo, o acervo é que já tinha tudo.
                    this.flashToast(duplicados === 1
                        ? 'That cartridge was already in your library'
                        : `All ${duplicados} cartridges in the file were already in your library`);
                } else {
                    this.flashError('No usable cartridge in this file.');
                }
            } catch (e) {
                this.flashError('Invalid JSON file.');
            } finally {
                // Sem isso, escolher o mesmo arquivo de novo não dispara `change` e o
                // botão parece morto — acontece direto depois de corrigir o arquivo.
                input.value = '';
            }
        },

        /** "3 cartuchos importados (2 já no acervo, 1 discarded)" — cada número conta uma coisa. */
        resumoDoImport(novos, duplicados, invalidos) {
            const principal = novos === 1 ? '1 cartridge imported' : `${novos} cartridges imported`;
            const notas = [];
            if (duplicados > 0) notas.push(`${duplicados} already in the library`);
            if (invalidos > 0) notas.push(invalidos === 1 ? '1 discarded' : `${invalidos} discarded`);
            return notas.length ? `${principal} (${notas.join(', ')})` : principal;
        },

        /**
         * Guarda o servidor de NetPlay. Campo vazio é uma escolha, não um erro: desliga.
         * A troca só vale no próximo jogo — as globais EJS_* são lidas no boot do emulador.
         */
        salvarNetplay() {
            const { url, error } = parseNetplayServer(this.netplayCampo);
            if (error) {
                this.netplayErro = error;
                return;
            }
            this.netplayErro = '';
            this.netplayServer = url;
            this.netplayCampo = url;
            if (!this.confirmarGravacao(saveNetplayServer(url))) return;
            this.flashToast(url ? `NetPlay on ${new URL(url).hostname}` : 'NetPlay off');
        },

        /** Volta ao gateway padrão do app (o botão RESET das configurações). */
        resetGateway() {
            this.ipfsGateway = DEFAULT_GATEWAY;
            this.saveGateway();
        },

        saveGateway() {
            this.ipfsGateway = normalizeGateway(this.ipfsGateway);
            if (!this.confirmarGravacao(saveGatewayPreference(this.ipfsGateway))) return;
            this.flashToast(`Using ${new URL(this.ipfsGateway).hostname}`);
        },

        async testGateways() {
            if (this.testingGateways) return;
            this.testingGateways = true;
            // Marca todos como "testando" para a lista mostrar o que está em andamento,
            // e cada um é substituído pelo resultado assim que responde.
            this.gatewayStatus = Object.fromEntries(this.knownGateways.map(g => [g, 'testando']));
            try {
                await measureGateways(this.knownGateways, (gateway, status) => {
                    this.gatewayStatus = { ...this.gatewayStatus, [gateway]: status };
                });
            } finally {
                this.testingGateways = false;
            }
        },

        /** Testa antes de guardar: gateway que o navegador não alcança não serve para nada. */
        async addCustomGateway() {
            const analise = parseGatewayInput(this.newGateway);
            if (analise.error) {
                this.addGatewayError = analise.error;
                return;
            }
            const gateway = analise.gateway;
            if (this.knownGateways.includes(gateway)) {
                this.addGatewayError = 'That gateway is already on the list.';
                return;
            }

            this.addGatewayError = '';
            this.addingGateway = true;
            try {
                const resultado = await probeGateway(gateway);
                if (!resultado.ok) {
                    this.addGatewayError = `Could not use it: ${resultado.motivo}.`;
                    return;
                }
                this.customGateways = [...this.customGateways, gateway];
                if (!this.confirmarGravacao(saveCustomGateways(this.customGateways))) return;
                this.gatewayStatus = {
                    ...this.gatewayStatus,
                    [gateway]: resultado.restrito ? `${resultado.ms}ms (restricted)` : `${resultado.ms}ms`
                };
                this.newGateway = '';
                this.showAddGateway = false;
                this.flashToast(`${new URL(gateway).hostname} added`);
            } finally {
                this.addingGateway = false;
            }
        },

        removeCustomGateway(gateway) {
            this.customGateways = this.customGateways.filter(g => g !== gateway);
            this.confirmarGravacao(saveCustomGateways(this.customGateways));
            const { [gateway]: _removido, ...resto } = this.gatewayStatus;
            this.gatewayStatus = resto;
            // Se era o gateway em uso, volta para o padrão.
            if (this.ipfsGateway === gateway) this.resetGateway();
        },

        cancelAddGateway() {
            this.showAddGateway = false;
            this.newGateway = '';
            this.addGatewayError = '';
        },

        // ----------------------------------------------------- compartilhamento

        async shareCartucho(game) {
            this.shareGame = game;
            this.showShareModal = true;
            await this.generateQRCode();
        },

        async generateQRCode() {
            try {
                await loadQrGenerator();
            } catch (e) {
                this.flashError('Could not load the QR generator.');
                return;
            }
            await this.$nextTick();

            const container = document.getElementById('qrcode-container');
            if (!container) return;
            container.innerHTML = '';
            new QRCode(container, {
                text: this.shareLink,
                width: 200,
                height: 200,
                colorDark: '#4f46e5',
                colorLight: 'transparent',
                correctLevel: QRCode.CorrectLevel.H
            });
        },

        async copyShareLink() {
            try {
                await navigator.clipboard.writeText(this.shareLink);
                this.flashToast('Link copied');
            } catch (err) {
                // A área de transferência exige foco e contexto seguro; quando o navegador
                // recusa, o usuário precisa saber — antes isso só aparecia no console.
                console.error('Falha ao copiar', err);
                this.flashError('Could not copy. Select the link and copy it by hand.');
            }
        },

        /** Toast de erro. Substitui alert(), que congela a página inteira. */
        flashError(message, duration = 6000) {
            console.warn(message);
            this.errorMessage = message;
            clearTimeout(this._errorTimer);
            this._errorTimer = setTimeout(() => { this.errorMessage = ''; }, duration);
        },
        _errorTimer: null,

        /**
         * Toast de sucesso. A mensagem é obrigatória: antes era um texto fixo
         * ("CARTUCHO_COPIED") reaproveitado por sete ações diferentes, então salvar um
         * gateway anunciava que um cartucho tinha sido copiado.
         */
        flashToast(mensagem, duration = 3000) {
            this.toastMessage = mensagem;
            this.copyFeedback = true;
            clearTimeout(this._toastTimer);
            this._toastTimer = setTimeout(() => { this.copyFeedback = false; }, duration);
        },
        _toastTimer: null
    };
}

// Registrado antes do Alpine subir — por isso este módulo vem ANTES do CDN do Alpine no HTML.
document.addEventListener('alpine:init', () => {
    window.Alpine.data('cartuchoApp', cartuchoApp);
});

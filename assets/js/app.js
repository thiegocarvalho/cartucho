// Componente Alpine: só estado da UI e orquestração.
// A lógica de verdade mora nos módulos importados abaixo.
import {
    KNOWN_GATEWAYS, DEFAULT_GATEWAY,
    CACHE_PASSO, CACHE_FRACAO_DA_QUOTA, CACHE_MAX_FALLBACK
} from './config.js';
import { ICONS } from './icons.js';
import {
    extractCID, gatewayUrl, normalizeGateway, fetchCartuchoAnywhere,
    resolveFastestGateway, measureGateways, parseGatewayInput, probeGateway
} from './ipfs.js';
import {
    loadLibrary, saveLibrary, loadGatewayPreference, saveGatewayPreference,
    normalizeCartucho, previewFromManifest, findGame, gameCid, sortByRecent,
    systemsInLibrary, downloadLibrary, readLibraryFile, newGamesFrom,
    loadLastWorkingGateway, saveLastWorkingGateway,
    loadCustomGateways, saveCustomGateways
} from './library.js';
import {
    getCachedRom, fetchRomWithProgress, romCacheStats, clearRomCache, formatBytes,
    loadCacheLimit, saveCacheLimit, storageEstimate, requestPersistence
} from './rom-cache.js';
import {
    applyEmulatorDefaults, configureEmulator, bootEmulator, isEmulatorLoaded,
    syncUrlToGame, reloadWithGame, reloadToPage
} from './emulator.js';
import { gamepadModule } from './gamepad.js';
import { loadQrGenerator, loadQrScanner } from './vendor.js';
import { aplicarMetaDoJogo } from './page-meta.js';

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
        cachePersistente: false,
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
        showImportModal: false,
        showShareModal: false,

        // ---- Estado do import ----
        importMode: 'manual', // 'manual' | 'scan'
        scanPending: false,
        previewGame: null,
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
            applyEmulatorDefaults();
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
            ['showImportModal', 'showShareModal',
                'activePage', 'library', 'searchQuery'].forEach(prop => this.$watch(prop, invalidate));
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
                    if (error === 'unreachable') {
                        this.flashError('Nenhum gateway respondeu por esse CID. O conteúdo pode não estar propagado na rede pública.');
                        return;
                    }
                    if (error === 'not-json') {
                        this.flashError('Esse CID não é um Cartucho: o conteúdo não é JSON.');
                        return;
                    }

                    const result = normalizeCartucho(data, cid);
                    if (result.error) {
                        this.flashError(result.error);
                        return;
                    }

                    game = result.game;
                    this.library.unshift(game);
                    saveLibrary(this.library);
                }

                // await de verdade: sem isso o finally abaixo apagava a tela de boot
                // enquanto a ROM ainda estava baixando.
                await this.loadGame(game);
            } catch (e) {
                console.error('Falha ao carregar o jogo da URL', e);
                this.flashError('Falha ao carregar o Cartucho da URL.');
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
                saveLibrary(this.library);
            }

            const romUrl = await this.resolveRomUrl(game);

            syncUrlToGame(cid);
            aplicarMetaDoJogo(game, this.getMediaUrl(game.cover || game.screenshot));
            configureEmulator(game, romUrl, this.getMediaUrl(game.cover));

            // Deixa o Alpine pintar o #game-container antes do emulador procurar por ele.
            await this.$nextTick();
            try {
                await bootEmulator();
                this.emulatorError = '';
            } catch (e) {
                // NUNCA recarregar a página aqui: o reload cai de volta em ?cartucho=,
                // que chama loadGame de novo — se a falha persistir, vira loop infinito.
                console.error('Falha ao iniciar o EmulatorJS', e);
                this.emulatorError = 'Não foi possível iniciar o emulador. Verifique a conexão e tente de novo.';
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
            saveLastWorkingGateway(gateway);
        },

        cachePasso: CACHE_PASSO,

        /** Rótulo do valor atual. */
        get cacheLimiteRotulo() {
            return this.cacheLimitBytes > 0 ? formatBytes(this.cacheLimitBytes) : 'Desligado';
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
            saveCacheLimit(limite);

            // Ligar o cache é o momento de pedir armazenamento persistente: sem isso o
            // navegador pode limpar tudo sozinho quando o disco aperta.
            if (limite > 0 && !this.cachePersistente) {
                this.cachePersistente = await requestPersistence();
            }

            // Diminuir o teto precisa valer para o que já está guardado.
            if (this.cacheStats.bytes > limite) await clearRomCache();
            await this.refreshCacheStats();
            this.flashToast(limite === 0 ? 'Cache desligado' : `Guardando até ${formatBytes(limite)}`);
        },

        async clearCache() {
            const antes = this.cacheStats.bytes;
            await clearRomCache();
            await this.refreshCacheStats();
            this.flashToast(`${formatBytes(antes)} liberados`);
        },

        formatBytes,

        stopGame(targetPage = 'Home', opts = {}) {
            reloadToPage(targetPage, opts);
        },

        // ------------------------------------------------------------- import

        async startScanner() {
            this.importMode = 'scan';
            try {
                await loadQrScanner();
            } catch (e) {
                this.flashError('Não foi possível carregar o leitor de QR.');
                this.importMode = 'manual';
                return;
            }
            this.$nextTick(() => {
                if (!this.html5QrCode) this.html5QrCode = new Html5Qrcode('reader');
                const config = { fps: 10, qrbox: { width: 250, height: 250 } };
                this.html5QrCode
                    .start({ facingMode: 'environment' }, config, (text) => this.onScanSuccess(text))
                    .catch(err => {
                        console.error('Erro ao iniciar o scanner', err);
                        this.flashError('Erro ao acessar a câmera. Verifique as permissões.');
                        this.importMode = 'manual';
                    });
            });
        },

        async stopScanner() {
            if (this.html5QrCode && this.html5QrCode.isScanning) {
                await this.html5QrCode.stop();
            }
        },

        resetImport() {
            this.stopScanner().catch(e => console.warn('Falha ao parar o scanner', e));
            this.newCID = '';
            this.previewGame = null;
            this.scanPending = false;
            this.showImportModal = false;
        },

        onScanSuccess(text) {
            const cid = extractCID(text);
            if (!cid) return;
            this.stopScanner().catch(e => console.warn('Falha ao parar o scanner', e));
            this.newCID = cid;
            this.fetchPreview(cid);
        },

        onManualInput() {
            const cid = extractCID(this.newCID);
            if (!cid) return;
            this.newCID = cid;
            this.fetchPreview(cid);
        },

        /** Card de preview antes de confirmar o import. Falha em silêncio: é só preview. */
        async fetchPreview(input) {
            const cid = extractCID(input);
            if (!cid) return;

            this.scanPending = true;
            this.previewGame = null;
            try {
                const { data, error } = await fetchCartuchoAnywhere(this.ipfsGateway, this.knownGateways, cid);
                if (!error) this.previewGame = previewFromManifest(data, cid);
            } finally {
                this.scanPending = false;
            }
        },

        /** @param {{play?: boolean}} [opts] play:false apenas guarda na biblioteca. */
        async importCartucho(opts = {}) {
            const jogar = opts.play !== false;
            const cid = extractCID(this.newCID.trim());
            if (!cid) {
                this.flashError('CID inválido. Confira o formato.');
                return;
            }

            const existing = findGame(this.library, cid);
            if (existing) {
                this.resetImport();
                if (jogar) this.loadGame(existing);
                else this.flashToast(`${existing.name} já está na biblioteca`);
                return;
            }

            this.isEmulatorLoading = true;
            try {
                const { data, error, gateway } = await fetchCartuchoAnywhere(this.ipfsGateway, this.knownGateways, cid);
                if (gateway) this.rememberGateway(gateway);
                if (error) {
                    this.flashError(error === 'not-json'
                        ? 'Esse CID não é um Cartucho: o conteúdo não é JSON.'
                        : 'Nenhum gateway respondeu por esse CID. Verifique se o conteúdo está propagado.');
                    return;
                }

                const result = normalizeCartucho(data, cid);
                if (result.error) {
                    this.flashError(result.error);
                    return;
                }

                this.library.unshift(result.game);
                saveLibrary(this.library);
                this.flashToast(`${result.game.name} adicionado`);
                this.resetImport();

                if (jogar) this.loadGame(result.game);
            } finally {
                this.isEmulatorLoading = false;
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
            saveLibrary(this.library);
        },

        // ---------------------------------------------------- backup / gateway

        exportLibrary() {
            downloadLibrary(this.library);
        },

        async importLibrary(event) {
            const file = event.target.files[0];
            if (!file) return;

            try {
                const imported = await readLibraryFile(file);
                const novos = newGamesFrom(this.library, imported);
                this.library = [...novos, ...this.library];
                saveLibrary(this.library);
                this.flashToast(novos.length === 1 ? '1 jogo importado' : `${novos.length} jogos importados`);
            } catch (e) {
                this.flashError('Arquivo JSON inválido.');
            }
        },

        /** Volta ao gateway padrão do app (o botão RESET das configurações). */
        resetGateway() {
            this.ipfsGateway = DEFAULT_GATEWAY;
            this.saveGateway();
        },

        saveGateway() {
            this.ipfsGateway = normalizeGateway(this.ipfsGateway);
            saveGatewayPreference(this.ipfsGateway);
            this.flashToast(`Usando ${new URL(this.ipfsGateway).hostname}`);
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
                this.addGatewayError = 'Esse gateway já está na lista.';
                return;
            }

            this.addGatewayError = '';
            this.addingGateway = true;
            try {
                const resultado = await probeGateway(gateway);
                if (!resultado.ok) {
                    this.addGatewayError = `Não deu para usar: ${resultado.motivo}.`;
                    return;
                }
                this.customGateways = [...this.customGateways, gateway];
                saveCustomGateways(this.customGateways);
                this.gatewayStatus = {
                    ...this.gatewayStatus,
                    [gateway]: resultado.restrito ? `${resultado.ms}ms (restrito)` : `${resultado.ms}ms`
                };
                this.newGateway = '';
                this.showAddGateway = false;
                this.flashToast(`${new URL(gateway).hostname} adicionado`);
            } finally {
                this.addingGateway = false;
            }
        },

        removeCustomGateway(gateway) {
            this.customGateways = this.customGateways.filter(g => g !== gateway);
            saveCustomGateways(this.customGateways);
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
                this.flashError('Não foi possível carregar o gerador de QR.');
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
                this.flashToast('Link copiado');
            } catch (err) {
                // A área de transferência exige foco e contexto seguro; quando o navegador
                // recusa, o usuário precisa saber — antes isso só aparecia no console.
                console.error('Falha ao copiar', err);
                this.flashError('Não foi possível copiar. Selecione o link e copie manualmente.');
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

// Título da aba e meta tags de compartilhamento, acompanhando o jogo aberto.
//
// LIMITE IMPORTANTE: o app é estático e os robôs de WhatsApp, Twitter, Discord e afins
// não executam JavaScript — eles leem o HTML servido. Então o preview do link continua
// sendo o das meta tags estáticas do index.html. O que muda aqui vale para a aba do
// navegador, para o histórico, para a Web Share API e para quem lê a página com JS ativo.
// Preview por jogo exigiria alguém montando o HTML por CID (um Worker na frente do site,
// ou uma página pré-gerada por cartucho).

const TITULO_BASE = 'Cartucho//IPFS';

function definirMeta(seletor, valor) {
    const tag = document.head.querySelector(seletor);
    if (tag && valor) tag.setAttribute('content', valor);
}

/**
 * @param {{name: string, system: string}|null} jogo
 * @param {string|null} capaUrl URL da capa já resolvida no gateway
 */
export function aplicarMetaDoJogo(jogo, capaUrl) {
    if (!jogo) {
        document.title = `${TITULO_BASE} — Emulador retro descentralizado`;
        return;
    }

    const titulo = `${TITULO_BASE} - ${jogo.name}${jogo.system ? ` - ${jogo.system}` : ''}`;
    document.title = titulo;

    definirMeta('meta[property="og:title"]', titulo);
    definirMeta('meta[name="twitter:title"]', titulo);

    const descricao = `Jogue ${jogo.name}${jogo.system ? ` (${jogo.system})` : ''} direto do IPFS, sem instalar nada.`;
    definirMeta('meta[property="og:description"]', descricao);
    definirMeta('meta[name="twitter:description"]', descricao);
    definirMeta('meta[name="description"]', descricao);

    // A arte do próprio cartucho, servida pelo gateway — sem imagem de marca no meio.
    if (capaUrl) {
        definirMeta('meta[property="og:image"]', capaUrl);
        definirMeta('meta[name="twitter:image"]', capaUrl);
    }

    definirMeta('meta[property="og:url"]', window.location.href);
    definirMeta('meta[property="og:image:alt"]', `Capa de ${jogo.name}`);
}

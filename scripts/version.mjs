// Versiona os assets para o navegador não misturar HTML novo com JS velho.
//
// Por quê: no GitHub Pages os assets vêm com cache de 10 minutos e sem ETag confiável.
// Depois de um deploy o navegador pode combinar o index.html novo com um assets/js/*.js
// antigo em cache, e o app quebra com "X is not defined" — o markup novo referencia
// propriedades que o componente velho não tem.
//
// Como: um <script type="importmap"> no index.html aponta cada módulo para a URL com
// ?v=<hash do conteúdo>. Os arquivos em assets/js ficam INTOCADOS, com imports limpos
// (`from './config.js'`) — carimbar o `?v=` dentro do fonte quebrava buscas literais e
// já custou um import perdido silenciosamente.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR_JS = join(raiz, 'assets/js');
const CSS_REL = 'assets/css/tailwind.css';
const HTML = join(raiz, 'index.html');

const MARCA_INI = '<!-- importmap gerado por scripts/version.mjs -->';
const MARCA_FIM = '<!-- /importmap -->';

const modulos = readdirSync(DIR_JS).filter(n => n.endsWith('.js')).sort();
const hash = createHash('sha1');
for (const nome of modulos) hash.update(readFileSync(join(DIR_JS, nome)));
hash.update(readFileSync(join(raiz, CSS_REL)));
const versao = hash.digest('hex').slice(0, 8);

// Chaves relativas ao documento, não absolutas: o site é servido de /cartucho/ no GitHub
// Pages, e "/assets/js/x.js" apontaria para a raiz do domínio. O import map resolve tanto a
// chave quanto o import relativo do módulo contra a mesma base, então os dois batem.
const imports = Object.fromEntries(
    modulos.map(nome => [`./assets/js/${nome}`, `./assets/js/${nome}?v=${versao}`])
);
const bloco = [
    MARCA_INI,
    '    <script type="importmap">',
    `        ${JSON.stringify({ imports }, null, 8).split('\n').join('\n        ')}`,
    '    </script>',
    `    ${MARCA_FIM}`
].join('\n    ').replace(/^/, '    ');

let html = readFileSync(HTML, 'utf8');

// Limpa carimbos antigos: do bloco e de qualquer ?v= que tenha sobrado em src/href.
html = html.replace(
    new RegExp(`\\s*${MARCA_INI}[\\s\\S]*?${MARCA_FIM}`),
    ''
).replace(/(\.(?:js|css))\?v=[a-f0-9]+/g, '$1');

// CSS continua com a versão na própria URL (não passa pelo import map).
html = html.replace(/(href="assets\/css\/[\w.-]+\.css)"/g, `$1?v=${versao}"`);

// O import map precisa vir antes de qualquer <script type="module">.
const ancora = html.indexOf('    <script type="module"');
if (ancora === -1) throw new Error('não achei o <script type="module"> do app no index.html');
html = html.slice(0, ancora) + bloco.trimStart() + '\n' + html.slice(ancora);

writeFileSync(HTML, html);

// Guarda: import usado mas não declarado passa batido por `node --check`.
let problemas = 0;
for (const nome of modulos) {
    const texto = readFileSync(join(DIR_JS, nome), 'utf8');
    const importados = new Set(
        [...texto.matchAll(/import\s*\{([^}]*)\}\s*from/g)]
            .flatMap(m => m[1].split(',').map(x => x.trim().split(/\s+as\s+/).pop()))
            .filter(Boolean)
    );
    const corpo = texto.replace(/import[\s\S]*?from\s*['"][^'"]+['"];?/g, '');
    for (const usado of new Set(corpo.match(/\b[a-zA-Z_$][\w$]*(?=\()/g) || [])) {
        const declaradoNoArquivo = new RegExp(
            `(function|const|let|var|class)\\s+${usado}\\b|\\b${usado}\\s*[:(]`
        ).test(corpo);
        if (!declaradoNoArquivo && !importados.has(usado) && !(usado in globalThis)) {
            console.warn(`  aviso: ${nome} chama ${usado}() sem importar nem declarar`);
            problemas++;
        }
    }
}

console.log(`versão ${versao} — ${modulos.length} módulos no import map${problemas ? `, ${problemas} aviso(s)` : ''}`);

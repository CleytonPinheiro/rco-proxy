/**
 * Minifica os portais públicos:
 *   frontend/alunos/alunos.js         → frontend/alunos/alunos.min.js
 *   frontend/pedagogico-portal/pedagogico-portal.js → frontend/pedagogico-portal/pedagogico-portal.min.js
 *
 * Uso:
 *   node backend/scripts/build-portal.js           # builds all portals
 *   node backend/scripts/build-portal.js alunos    # builds only alunos.min.js
 */
import { minify }  from 'terser';
import { readFile, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '../../');

const portais = [
    { nome: 'alunos.min.js',              src: 'frontend/alunos/alunos.js',                                    dest: 'frontend/alunos/alunos.min.js' },
    { nome: 'pedagogico-portal.min.js',   src: 'frontend/pedagogico-portal/pedagogico-portal.js',              dest: 'frontend/pedagogico-portal/pedagogico-portal.min.js' },
];

const filtro = process.argv[2];
const alvo   = filtro ? portais.filter(p => p.nome.startsWith(filtro)) : portais;

if (alvo.length === 0) {
    console.error(`✖ Nenhum portal encontrado para o filtro "${filtro}". Opções: ${portais.map(p => p.nome).join(', ')}`);
    process.exit(1);
}

for (const p of alvo) {
    try {
        const code = await readFile(path.join(ROOT, p.src), 'utf8');

        const result = await minify(code, {
            compress: {
                drop_console: false,
                passes:       2,
            },
            mangle:  true,
            format:  { comments: false },
            sourceMap: false,
        });

        await writeFile(path.join(ROOT, p.dest), result.code, 'utf8');

        const srcKB  = (code.length        / 1024).toFixed(1);
        const destKB = (result.code.length / 1024).toFixed(1);
        console.log(`✔ ${p.nome}: ${srcKB} KB → ${destKB} KB`);
    } catch (e) {
        console.error(`✖ ${p.nome}: ${e.message}`);
    }
}

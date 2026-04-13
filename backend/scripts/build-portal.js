/**
 * Minifica frontend/alunos/alunos.js → frontend/alunos/alunos.min.js
 * Uso: node backend/scripts/build-portal.js
 */
import { minify }  from 'terser';
import { readFile, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '../../');

const src  = path.join(ROOT, 'frontend/alunos/alunos.js');
const dest = path.join(ROOT, 'frontend/alunos/alunos.min.js');

const code = await readFile(src, 'utf8');

const result = await minify(code, {
    compress: {
        drop_console: false,
        passes:       2,
    },
    mangle:  true,
    format:  { comments: false },
    sourceMap: false,
});

await writeFile(dest, result.code, 'utf8');

const srcKB  = (code.length          / 1024).toFixed(1);
const destKB = (result.code.length   / 1024).toFixed(1);
console.log(`✔ alunos.min.js gerado: ${srcKB} KB → ${destKB} KB`);

/**
 * Watcher de desenvolvimento para os portais públicos.
 * Observa alunos.js e pedagogico-portal.js e roda o build apenas do arquivo
 * alterado, sem reiniciar o servidor.
 *
 * Uso:
 *   node backend/scripts/watch-portal.js          (a partir da raiz)
 *   node scripts/watch-portal.js                  (a partir de backend/)
 */
import chokidar from 'chokidar';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '../../');

const TARGETS = [
    {
        src:    path.join(ROOT, 'frontend/alunos/alunos.js'),
        filtro: 'alunos',
        label:  'alunos.min.js',
    },
    {
        src:    path.join(ROOT, 'frontend/pedagogico-portal/pedagogico-portal.js'),
        filtro: 'pedagogico',
        label:  'pedagogico-portal.min.js',
    },
];

const BUILD_SCRIPT = path.join(__dirname, 'build-portal.js');

function rebuild(filtro, label) {
    console.log(`[watch-portal] Mudança detectada → reconstruindo ${label}…`);
    const child = spawn(
        process.execPath,
        [BUILD_SCRIPT, filtro],
        { stdio: 'inherit', cwd: ROOT },
    );
    child.on('close', code => {
        if (code !== 0) {
            console.error(`[watch-portal] ✖ Build de ${label} falhou (exit ${code})`);
        }
    });
}

const paths = TARGETS.map(t => t.src);

chokidar.watch(paths, { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 150 } })
    .on('change', changed => {
        const target = TARGETS.find(t => t.src === changed);
        if (target) rebuild(target.filtro, target.label);
    })
    .on('ready', () => {
        console.log('[watch-portal] Monitorando portais:');
        TARGETS.forEach(t => console.log(`  • ${path.relative(ROOT, t.src)}`));
        console.log('[watch-portal] Aguardando alterações…');
    });

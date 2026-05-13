/**
 * Configuração de perfis e permissões do EduSync.
 * Cada perfil define quais módulos o usuário pode acessar.
 * O perfil 'admin' tem acesso total (*).
 *
 * As permissões definidas aqui são DEFAULTS. O admin pode sobrepô-las
 * em runtime via tela "Permissões" (gravadas em edusync_perfis_overrides).
 * Ver setOverrides() / getModulosEfetivos().
 */

export const PERFIS = {
    admin: {
        nome: 'Administrador',
        modulos: ['*'],   /* inclui portal-aluno */
    },
    professor: {
        nome: 'Professor',
        modulos: ['dashboard', 'frequencias', 'atividades', 'classroom', 'comportamento', 'grupos', 'mapa-sala', 'pedagogico', 'retorno-pedagogico', 'provas', 'analise-cola', 'qrcode', 'suporte', 'passeios'],
    },
    pedagogo: {
        nome: 'Pedagogo',
        modulos: ['dashboard', 'comportamento', 'pedagogico', 'retorno-pedagogico', 'frequencias', 'comunicados', 'mapa-sala', 'qrcode', 'suporte', 'passeios'],
    },
    secretaria: {
        nome: 'Secretaria',
        modulos: ['dashboard', 'crachas', 'emprestimos', 'materiais', 'comunicados', 'circulacao', 'qrcode', 'suporte', 'passeios'],
    },
    aux_turno: {
        nome: 'Aux. de Turno',
        modulos: ['circulacao', 'presenca', 'qrcode', 'suporte'],
    },
    cozinha: {
        nome: 'Cozinha',
        modulos: ['cozinha', 'qrcode', 'suporte'],
    },
};

/** Lista de TODOS os módulos disponíveis no sistema (catálogo para a UI). */
export const MODULOS_DISPONIVEIS = [
    { id: 'dashboard',          nome: 'Turmas / Dashboard' },
    { id: 'frequencias',        nome: 'Frequências' },
    { id: 'atividades',         nome: 'Atividades' },
    { id: 'classroom',          nome: 'Google Classroom' },
    { id: 'comportamento',      nome: 'Comportamento' },
    { id: 'grupos',             nome: 'Grupos' },
    { id: 'mapa-sala',          nome: 'Mapa de Sala' },
    { id: 'pedagogico',         nome: 'Painel Pedagógico' },
    { id: 'retorno-pedagogico', nome: 'Retorno Pedagógico' },
    { id: 'provas',             nome: 'Gabarito & Correção' },
    { id: 'analise-cola',       nome: 'Analise de gabarito' },
    { id: 'comunicados',        nome: 'Comunicados' },
    { id: 'crachas',            nome: 'Crachás' },
    { id: 'emprestimos',        nome: 'Empréstimos' },
    { id: 'materiais',          nome: 'Materiais' },
    { id: 'circulacao',         nome: 'Circulação' },
    { id: 'presenca',           nome: 'Presença Diária' },
    { id: 'cozinha',            nome: 'Cozinha' },
    { id: 'qrcode',             nome: 'Gerador de QR Code' },
    { id: 'suporte',            nome: 'Suporte' },
    { id: 'portal-aluno',       nome: 'Portal do Aluno (admin)' },
    { id: 'solicitacoes',       nome: 'Solicitações (Classroom)' },
    { id: 'portal-log',         nome: 'Log Portal Aluno' },
    { id: 'planos',             nome: 'Planos' },
    { id: 'passeios',           nome: 'Passeios e Eventos' },
];

/**
 * Dependência pai → filho entre módulos.
 * Para um perfil acessar um módulo "filho", precisa ter o módulo "pai" também.
 * Usado pelo backend (podeAcessar) e pela UI do admin para auto-habilitar
 * o pai quando o admin marca o filho.
 */
export const MODULO_PAI = {
    'portal-aluno':  'classroom',
    'solicitacoes':  'classroom',
    'portal-log':    'classroom',
};

/* ── Módulos em desenvolvimento (gerenciado pelo admin) ── */
let _modulosEmDesenvolvimento = new Set(['pedagogico', 'comunicados', 'retorno-pedagogico']);

export function setModulosEmDesenvolvimento(lista) {
    if (Array.isArray(lista)) _modulosEmDesenvolvimento = new Set(lista);
}
export function getModulosEmDesenvolvimento() {
    return [..._modulosEmDesenvolvimento];
}

/* ── Overrides em memória, populados a partir da tabela edusync_perfis_overrides ── */
const _overrides = new Map(); // perfil -> string[]

/** Substitui os overrides em memória (chamar após carregar do DB). */
export function setOverrides(map) {
    _overrides.clear();
    for (const [perfil, modulos] of Object.entries(map || {})) {
        if (Array.isArray(modulos)) _overrides.set(perfil, modulos);
    }
}

/** Define o override para UM perfil (em memória). */
export function setOverride(perfil, modulos) {
    if (Array.isArray(modulos)) _overrides.set(perfil, modulos);
}

/** Remove o override de um perfil (volta ao default do código). */
export function clearOverride(perfil) {
    _overrides.delete(perfil);
}

/** Retorna os módulos efetivos do perfil (override > default). */
export function getModulosEfetivos(perfil) {
    if (perfil === 'admin') return ['*'];
    if (_overrides.has(perfil)) return _overrides.get(perfil);
    return PERFIS[perfil]?.modulos || [];
}

/** Mapa { perfil: modulos[] } com TODOS os perfis. */
export function getMapaPermissoesEfetivas() {
    const out = {};
    for (const id of Object.keys(PERFIS)) {
        out[id] = getModulosEfetivos(id);
    }
    return out;
}

/**
 * Verifica se um perfil tem acesso a um módulo (respeita overrides).
 * @param {string} perfil
 * @param {string} modulo
 * @returns {boolean}
 */
export function podeAcessar(perfil, modulo) {
    if (!perfil) return false;
    if (perfil === 'admin') return true;
    const lista = getModulosEfetivos(perfil);
    if (!lista || lista.length === 0) return false;
    if (lista.includes('*')) return true;
    if (!lista.includes(modulo)) return false;
    /* Dependência: para acessar um filho, precisa ter o pai também. */
    const pai = MODULO_PAI[modulo];
    if (pai && !lista.includes(pai)) return false;
    return true;
}

export const LISTA_PERFIS = Object.entries(PERFIS).map(([id, cfg]) => ({
    id,
    nome: cfg.nome,
    modulos: cfg.modulos,
}));

/**
 * Configuração de perfis e permissões do EduSync.
 * Cada perfil define quais módulos o usuário pode acessar.
 * O perfil 'admin' tem acesso total (*).
 */

export const PERFIS = {
    admin: {
        nome: 'Administrador',
        modulos: ['*'],
    },
    professor: {
        nome: 'Professor',
        modulos: ['dashboard', 'frequencias', 'atividades', 'classroom', 'comportamento', 'grupos', 'mapa-sala', 'pedagogico'],
    },
    pedagogo: {
        nome: 'Pedagogo',
        modulos: ['dashboard', 'comportamento', 'pedagogico', 'frequencias', 'comunicados'],
    },
    secretaria: {
        nome: 'Secretaria',
        modulos: ['dashboard', 'crachas', 'emprestimos', 'materiais', 'comunicados', 'circulacao'],
    },
    aux_turno: {
        nome: 'Aux. de Turno',
        modulos: ['circulacao', 'presenca'],
    },
    cozinha: {
        nome: 'Cozinha',
        modulos: ['cozinha'],
    },
};

/**
 * Verifica se um perfil tem acesso a um módulo.
 * @param {string} perfil
 * @param {string} modulo
 * @returns {boolean}
 */
export function podeAcessar(perfil, modulo) {
    const config = PERFIS[perfil];
    if (!config) return false;
    if (config.modulos.includes('*')) return true;
    return config.modulos.includes(modulo);
}

export const LISTA_PERFIS = Object.entries(PERFIS).map(([id, cfg]) => ({
    id,
    nome: cfg.nome,
    modulos: cfg.modulos,
}));

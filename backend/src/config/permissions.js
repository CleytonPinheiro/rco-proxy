/**
 * Configuração de perfis e permissões do EduSync.
 * Cada perfil define quais módulos o usuário pode acessar.
 * O perfil 'admin' tem acesso total (*).
 */

export const PERFIS = {
    admin: {
        nome: 'Administrador',
        modulos: ['*'],   /* inclui portal-aluno */
    },
    professor: {
        nome: 'Professor',
        modulos: ['dashboard', 'frequencias', 'atividades', 'classroom', 'comportamento', 'grupos', 'mapa-sala', 'pedagogico', 'retorno-pedagogico', 'provas', 'suporte'],
    },
    pedagogo: {
        nome: 'Pedagogo',
        /* Pedagogo NÃO tem acesso a Provas (módulo restrito a professor/admin) */
        modulos: ['dashboard', 'comportamento', 'pedagogico', 'retorno-pedagogico', 'frequencias', 'comunicados', 'mapa-sala', 'suporte'],
    },
    secretaria: {
        nome: 'Secretaria',
        modulos: ['dashboard', 'crachas', 'emprestimos', 'materiais', 'comunicados', 'circulacao', 'suporte'],
    },
    aux_turno: {
        nome: 'Aux. de Turno',
        modulos: ['circulacao', 'presenca', 'suporte'],
    },
    cozinha: {
        nome: 'Cozinha',
        modulos: ['cozinha', 'suporte'],
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

export const PLANOS_USUARIO = {
    trial: {
        nome: 'Trial',
        icone: '⏳',
        duracaoDias: 30,
        funcionalidades: ['classroom-leitura', 'atividades-leitura', 'dashboard'],
        descricao: 'Acesso de avaliação por 30 dias — somente visualização de atividades e notas.',
    },
    basico: {
        nome: 'Básico',
        icone: '📘',
        duracaoDias: null,
        funcionalidades: ['classroom-leitura', 'classroom-escrita', 'atividades-leitura', 'atividades-escrita', 'dashboard', 'grupos'],
        descricao: 'Classroom completo: corrigir, fechar notas, sincronizar.',
    },
    completo: {
        nome: 'Completo',
        icone: '🚀',
        duracaoDias: null,
        funcionalidades: ['*'],
        descricao: 'Acesso total a todos os módulos e funcionalidades.',
    },
    'classroom-individual': {
        nome: 'Individual',
        icone: '👨‍🏫',
        duracaoDias: null,
        funcionalidades: ['classroom-leitura', 'classroom-escrita', 'atividades-leitura', 'atividades-escrita', 'dashboard', 'grupos'],
        descricao: 'Plano individual legado.',
    },
};

export const PLANOS_ESCOLA = {
    inicial: {
        nome: 'Inicial',
        icone: '🌱',
        funcionalidades: ['classroom-leitura', 'atividades-leitura', 'dashboard'],
        descricao: 'Somente visualização para todos os professores da escola.',
    },
    profissional: {
        nome: 'Profissional',
        icone: '🚀',
        funcionalidades: ['classroom-leitura', 'classroom-escrita', 'atividades-leitura', 'atividades-escrita', 'dashboard', 'grupos', 'frequencias'],
        descricao: 'Classroom completo + frequências para toda a escola.',
    },
    rede: {
        nome: 'Rede',
        icone: '🏫',
        funcionalidades: ['*'],
        descricao: 'Acesso total para toda a rede escolar.',
    },
};

export const FUNCIONALIDADE_LABELS = {
    'classroom-leitura':   'Visualizar atividades e notas',
    'classroom-escrita':   'Corrigir, fechar notas, sincronizar Classroom',
    'atividades-leitura':  'Visualizar atividades no RCO',
    'atividades-escrita':  'Lançar notas no RCO',
    'dashboard':           'Dashboard e resumos',
    'grupos':              'Gerenciar grupos de atividades',
    'frequencias':         'Lançar frequências',
    '*':                   'Acesso total',
};

export function podeFuncionalidade(funcionalidades, func) {
    if (!funcionalidades || !funcionalidades.length) return false;
    if (funcionalidades.includes('*')) return true;
    return funcionalidades.includes(func);
}

export function planoExpirado(planoInicio, duracaoDias) {
    if (!duracaoDias || !planoInicio) return false;
    const inicio = new Date(planoInicio);
    const expira = new Date(inicio.getTime() + duracaoDias * 24 * 60 * 60 * 1000);
    return new Date() > expira;
}

export function diasRestantes(planoInicio, duracaoDias) {
    if (!duracaoDias || !planoInicio) return null;
    const inicio = new Date(planoInicio);
    const expira = new Date(inicio.getTime() + duracaoDias * 24 * 60 * 60 * 1000);
    const diff = expira.getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
}

export function resolverPlano(usuario, escola) {
    const planoUser = usuario?.plano;
    const planoEscola = escola?.plano;

    if (planoUser && PLANOS_USUARIO[planoUser]) {
        const config = PLANOS_USUARIO[planoUser];
        const expirou = planoExpirado(usuario.plano_inicio, config.duracaoDias);
        return {
            plano: planoUser,
            fonte: 'usuario',
            funcionalidades: expirou ? [] : config.funcionalidades,
            expirado: expirou,
            diasRestantes: diasRestantes(usuario.plano_inicio, config.duracaoDias),
            config,
        };
    }

    if (planoEscola && PLANOS_ESCOLA[planoEscola]) {
        const config = PLANOS_ESCOLA[planoEscola];
        return {
            plano: planoEscola,
            fonte: 'escola',
            funcionalidades: config.funcionalidades,
            expirado: false,
            diasRestantes: null,
            config,
        };
    }

    return {
        plano: null,
        fonte: null,
        funcionalidades: [],
        expirado: false,
        diasRestantes: null,
        config: null,
    };
}

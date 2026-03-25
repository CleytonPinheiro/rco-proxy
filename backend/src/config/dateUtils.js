/**
 * Utilitários de data com fuso horário de Brasília (UTC-3).
 * O servidor roda em UTC. O RCO Digital usa horário de Brasília.
 * Sempre usar estas funções para datas relativas ao Brasil.
 */

const OFFSET_BRT = -3 * 60 * 60 * 1000; // UTC-3 em ms

/**
 * Retorna a data atual no fuso de Brasília no formato YYYY-MM-DD.
 */
export function dataBrasilia() {
    const agora = new Date();
    const brt   = new Date(agora.getTime() + OFFSET_BRT);
    return brt.toISOString().split('T')[0];
}

/**
 * Retorna o objeto Date atual ajustado para o fuso de Brasília.
 */
export function agoraBrasilia() {
    const agora = new Date();
    return new Date(agora.getTime() + OFFSET_BRT);
}

/**
 * Formata um Date ou string ISO para data BRT (YYYY-MM-DD).
 * @param {Date|string} d
 */
export function paraDataBrasilia(d) {
    const dt = typeof d === 'string' ? new Date(d) : d;
    const brt = new Date(dt.getTime() + OFFSET_BRT);
    return brt.toISOString().split('T')[0];
}

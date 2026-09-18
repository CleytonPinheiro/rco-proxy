export async function filtrarAtasPendentes(registros, dbPool) {
    const ids = [...new Set(registros.flatMap(r => r.matriculasEquivalentes || [r.aluno?.codmatrizaluno])
        .map(Number).filter(Number.isFinite))];
    if (ids.length === 0) return registros;

    const { rows } = await dbPool.query(
        `SELECT cod_matriz_aluno, ocorrencia_id
         FROM ata_impressa
         WHERE cod_matriz_aluno = ANY($1)`,
        [ids]
    );
    const impressasPorMatricula = new Map();
    for (const row of rows) {
        const cod = Number(row.cod_matriz_aluno);
        if (!impressasPorMatricula.has(cod)) impressasPorMatricula.set(cod, new Set());
        impressasPorMatricula.get(cod).add(String(row.ocorrencia_id));
    }

    return registros.map(registro => {
        const impressas = new Set();
        for (const cod of (registro.matriculasEquivalentes || [registro.aluno?.codmatrizaluno])) {
            for (const ocorrenciaId of (impressasPorMatricula.get(Number(cod)) || [])) {
                impressas.add(ocorrenciaId);
            }
        }
        return {
            ...registro,
            combinadas: registro.combinadas.filter(o => !impressas.has(String(o.id))),
        };
    });
}
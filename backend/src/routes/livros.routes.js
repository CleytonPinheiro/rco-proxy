/**
 * Rotas de Livros Didáticos — cadastro do acervo e gestão de empréstimos anuais.
 */
import { Router } from 'express';
import pg          from 'pg';
import { requireAuth } from '../middleware/auth.middleware.js';

const { Pool } = pg;

export function createLivrosRouter() {
    const pool   = new Pool({ connectionString: process.env.DATABASE_URL });
    const router = Router();

    router.use(requireAuth);

    /* ════════════════════════════════
       ACERVO DE LIVROS
    ════════════════════════════════ */

    router.get('/livros', async (_req, res) => {
        try {
            const { rows } = await pool.query(`
                SELECT l.*,
                       (SELECT COUNT(*) FROM livros_emprestimos e
                        WHERE e.livro_id = l.id AND e.status = 'emprestado') AS emprestados
                FROM livros_didaticos l
                WHERE l.ativo = true
                ORDER BY l.titulo
            `);
            res.json(rows);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    router.post('/livros', async (req, res) => {
        const { titulo, autor, editora, ano_publicacao, disciplina, serie, isbn, quantidade } = req.body;
        if (!titulo) return res.status(400).json({ erro: 'Título é obrigatório.' });
        try {
            const { rows } = await pool.query(
                `INSERT INTO livros_didaticos (titulo, autor, editora, ano_publicacao, disciplina, serie, isbn, quantidade)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                 RETURNING *`,
                [titulo.trim(), autor||null, editora||null, ano_publicacao||null,
                 disciplina||null, serie||null, isbn||null, quantidade||1],
            );
            res.status(201).json(rows[0]);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    router.put('/livros/:id', async (req, res) => {
        const id = parseInt(req.params.id, 10);
        const { titulo, autor, editora, ano_publicacao, disciplina, serie, isbn, quantidade, ativo } = req.body;
        try {
            const sets = []; const params = [];
            const add = (v, col) => { if (v !== undefined) { params.push(v); sets.push(`${col} = $${params.length}`); } };
            add(titulo?.trim(),   'titulo');
            add(autor,            'autor');
            add(editora,          'editora');
            add(ano_publicacao,   'ano_publicacao');
            add(disciplina,       'disciplina');
            add(serie,            'serie');
            add(isbn,             'isbn');
            add(quantidade,       'quantidade');
            add(ativo,            'ativo');
            if (!sets.length) return res.status(400).json({ erro: 'Nada para atualizar.' });
            params.push(id);
            const { rows } = await pool.query(
                `UPDATE livros_didaticos SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
                params,
            );
            if (!rows.length) return res.status(404).json({ erro: 'Livro não encontrado.' });
            res.json(rows[0]);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    router.delete('/livros/:id', async (req, res) => {
        const id = parseInt(req.params.id, 10);
        try {
            const { rows } = await pool.query(
                `UPDATE livros_didaticos SET ativo = false WHERE id = $1 RETURNING id, titulo`,
                [id],
            );
            if (!rows.length) return res.status(404).json({ erro: 'Livro não encontrado.' });
            res.json({ sucesso: true });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    /* ════════════════════════════════
       EMPRÉSTIMOS
    ════════════════════════════════ */

    /* Lista empréstimos — pode filtrar por status, turma, livro_id, ano_letivo */
    router.get('/livros-emprestimos', async (req, res) => {
        const { status, turma, livro_id, ano_letivo } = req.query;
        try {
            const conds  = [];
            const params = [];
            if (status)    { params.push(status);             conds.push(`e.status = $${params.length}`); }
            if (turma)     { params.push(`%${turma}%`);       conds.push(`e.turma ILIKE $${params.length}`); }
            if (livro_id)  { params.push(parseInt(livro_id)); conds.push(`e.livro_id = $${params.length}`); }
            if (ano_letivo){ params.push(parseInt(ano_letivo));conds.push(`e.ano_letivo = $${params.length}`); }

            const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
            const { rows } = await pool.query(`
                SELECT e.*,
                       l.titulo        AS livro_titulo,
                       l.disciplina    AS livro_disciplina,
                       l.editora       AS livro_editora,
                       l.autor         AS livro_autor,
                       l.serie         AS livro_serie
                FROM livros_emprestimos e
                JOIN livros_didaticos   l ON l.id = e.livro_id
                ${where}
                ORDER BY e.turma, e.num_chamada, e.nome_aluno
            `, params);
            res.json(rows);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    /* Registrar empréstimo */
    router.post('/livros-emprestimos', async (req, res) => {
        const { livro_id, cod_matriz_aluno, nome_aluno, turma, num_chamada, ano_letivo, obs } = req.body;
        if (!livro_id || !cod_matriz_aluno || !nome_aluno) {
            return res.status(400).json({ erro: 'livro_id, cod_matriz_aluno e nome_aluno são obrigatórios.' });
        }
        try {
            /* Verificar disponibilidade */
            const { rows: livro } = await pool.query(
                `SELECT l.quantidade,
                        (SELECT COUNT(*) FROM livros_emprestimos e WHERE e.livro_id = l.id AND e.status = 'emprestado') AS emprestados
                 FROM livros_didaticos l WHERE l.id = $1 AND l.ativo = true`,
                [livro_id],
            );
            if (!livro.length) return res.status(404).json({ erro: 'Livro não encontrado.' });
            if (parseInt(livro[0].emprestados) >= livro[0].quantidade) {
                return res.status(409).json({ erro: 'Todas as cópias deste livro já estão emprestadas.' });
            }

            /* Verificar se aluno já tem este livro */
            const { rows: dup } = await pool.query(
                `SELECT id FROM livros_emprestimos WHERE livro_id=$1 AND cod_matriz_aluno=$2 AND status='emprestado'`,
                [livro_id, cod_matriz_aluno],
            );
            if (dup.length) return res.status(409).json({ erro: 'Este aluno já possui um exemplar deste livro.' });

            const { rows } = await pool.query(
                `INSERT INTO livros_emprestimos (livro_id, cod_matriz_aluno, nome_aluno, turma, num_chamada, ano_letivo, obs)
                 VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
                [livro_id, cod_matriz_aluno, nome_aluno, turma||null, num_chamada||null,
                 ano_letivo || new Date().getFullYear(), obs||null],
            );
            res.status(201).json(rows[0]);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    /* Registrar devolução */
    router.put('/livros-emprestimos/:id/devolver', async (req, res) => {
        const id  = parseInt(req.params.id, 10);
        const obs = req.body.obs || null;
        try {
            const { rows } = await pool.query(
                `UPDATE livros_emprestimos
                 SET status = 'devolvido', data_devolucao = NOW(), obs = COALESCE($2, obs)
                 WHERE id = $1 AND status = 'emprestado'
                 RETURNING *`,
                [id, obs],
            );
            if (!rows.length) return res.status(404).json({ erro: 'Empréstimo não encontrado ou já devolvido.' });
            res.json(rows[0]);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    /* Marcar como perdido */
    router.put('/livros-emprestimos/:id/perdido', async (req, res) => {
        const id  = parseInt(req.params.id, 10);
        const obs = req.body.obs || null;
        try {
            const { rows } = await pool.query(
                `UPDATE livros_emprestimos
                 SET status = 'perdido', obs = COALESCE($2, obs)
                 WHERE id = $1 AND status = 'emprestado'
                 RETURNING *`,
                [id, obs],
            );
            if (!rows.length) return res.status(404).json({ erro: 'Empréstimo não encontrado.' });
            res.json(rows[0]);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    /* Empréstimos de um aluno específico */
    router.get('/livros-emprestimos/aluno/:cod', async (req, res) => {
        try {
            const { rows } = await pool.query(`
                SELECT e.*, l.titulo AS livro_titulo, l.disciplina AS livro_disciplina
                FROM livros_emprestimos e
                JOIN livros_didaticos   l ON l.id = e.livro_id
                WHERE e.cod_matriz_aluno = $1
                ORDER BY e.data_emprestimo DESC
            `, [req.params.cod]);
            res.json(rows);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    return router;
}

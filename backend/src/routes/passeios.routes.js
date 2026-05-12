/**
 * Passeios e Eventos Externos — rotas protegidas + públicas
 */
import { Router }      from 'express';
import crypto          from 'crypto';
import QRCode          from 'qrcode';
import pkg             from 'pg';
import multer          from 'multer';
import path            from 'path';
import { fileURLToPath } from 'url';
import { getBrowser }  from '../../auth-puppeteer.js';
import { requireModulo } from '../middleware/auth.middleware.js';

import { mkdirSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ── Garantir que o diretório de uploads exista ─────────────────── */
const _uploadsDir = path.resolve(__dirname, '../../../uploads/comprovantes');
mkdirSync(_uploadsDir, { recursive: true });

/* ── Multer: upload de comprovantes ─────────────────────────────── */
const _uploadStorage = multer.diskStorage({
    destination: path.resolve(__dirname, '../../../uploads/comprovantes'),
    filename: (req, file, cb) => {
        const ext  = path.extname(file.originalname) || '.jpg';
        const name = `comp_${req.params.inscId || 'x'}_${Date.now()}${ext}`;
        cb(null, name);
    },
});
const _upload = multer({
    storage: _uploadStorage,
    limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
    fileFilter: (_req, file, cb) => {
        const allowed = ['image/jpeg','image/png','image/webp','application/pdf'];
        cb(null, allowed.includes(file.mimetype));
    },
});

const { Pool } = pkg;
const pool     = new Pool({ connectionString: process.env.DATABASE_URL });

/* ── PIX EMV QR Code generator ──────────────────────────────────────── */
function crc16(str) {
    let crc = 0xFFFF;
    for (let i = 0; i < str.length; i++) {
        crc ^= str.charCodeAt(i) << 8;
        for (let j = 0; j < 8; j++) {
            if (crc & 0x8000) crc = (crc << 1) ^ 0x1021;
            else crc <<= 1;
            crc &= 0xFFFF;
        }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
}

function gerarPixPayload({ chave, nome, cidade, valor = 0, txid, descricao = '' }) {
    const tlv = (id, val) => `${id}${String(val.length).padStart(2, '0')}${val}`;
    const norm = (s, max) => s.slice(0, max).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9 ]/g, '').trim().toUpperCase();

    const desc = descricao ? tlv('02', descricao.slice(0, 72)) : '';
    const keyInfo = tlv('00', 'BR.GOV.BCB.PIX') + tlv('01', chave) + desc;
    const merchantInfo = tlv('26', keyInfo);
    const txidClean = (txid || 'EDUSYNC').replace(/\s/g, '').slice(0, 25);
    const addDataField = tlv('62', tlv('05', txidClean));

    let payload = '000201' +
        '010212' +
        merchantInfo +
        '52040000' +
        '5303986' +
        (valor > 0 ? tlv('54', valor.toFixed(2)) : '') +
        '5802BR' +
        tlv('59', norm(nome, 25)) +
        tlv('60', norm(cidade || 'CURITIBA', 15)) +
        addDataField +
        '6304';
    return payload + crc16(payload);
}

/* ── Helpers ─────────────────────────────────────────────────────────── */
function gerarToken() {
    return crypto.randomBytes(32).toString('hex');
}

function gerarTxid(eventoId, inscricaoId) {
    return `ES${eventoId}A${inscricaoId}`.slice(0, 25);
}

async function getConfig(chave) {
    try {
        const { rows } = await pool.query(
            `SELECT valor FROM edusync_config WHERE chave = $1 LIMIT 1`,
            [chave]
        );
        return rows[0]?.valor || null;
    } catch { return null; }
}

/* ── Router factory ──────────────────────────────────────────────────── */
export function createPasseiosRouter({ supabase }) {
    const router = Router();

    /* ══════════════════════════════════════════════════════════════
     * PUBLIC routes (no requireAuth) — mounted separately
     * ══════════════════════════════════════════════════════════════ */
    const publicRouter = Router();

    /* GET /api/public/passeios/:eventoId/:alunoToken */
    publicRouter.get('/public/passeios/:eventoId/:alunoToken', async (req, res) => {
        const { eventoId, alunoToken } = req.params;
        try {
            const { rows: insc } = await pool.query(`
                SELECT ei.*, e.nome AS evento_nome, e.destino, e.data_evento,
                       eo.numero AS onibus_numero, eo.nome AS onibus_nome,
                       eo.cor AS onibus_cor, eo.monitor_nome, eo.monitor_telefone
                FROM evento_inscricoes ei
                JOIN eventos e ON e.id = ei.evento_id
                LEFT JOIN evento_onibus eo ON eo.id = ei.onibus_id
                WHERE ei.evento_id = $1 AND ei.aluno_token = $2
            `, [eventoId, alunoToken]);

            if (!insc.length) return res.status(404).json({ erro: 'Aluno não encontrado neste evento.' });
            const i = insc[0];
            res.json({
                aluno: {
                    nome:              i.nome_aluno,
                    turma:             i.turma,
                    foto_url:          i.foto_url || null,
                    restricoes:        i.restricoes_medicas || null,
                    contato_responsavel: i.contato_responsavel,
                    nome_responsavel:  i.nome_responsavel,
                },
                evento: {
                    nome:       i.evento_nome,
                    destino:    i.destino,
                    data:       i.data_evento,
                },
                onibus: i.onibus_id ? {
                    numero:   i.onibus_numero,
                    nome:     i.onibus_nome || `Ônibus ${i.onibus_numero}`,
                    cor:      i.onibus_cor,
                    monitor:  i.monitor_nome,
                    telefone: i.monitor_telefone,
                } : null,
                status_pagamento: i.status_pagamento,
                embarcou:         i.embarcou,
                embarcou_em:      i.embarcou_em,
                desembarcou:      i.desembarcou,
                desembarcou_em:   i.desembarcou_em,
            });
        } catch (e) {
            console.error('[PASSEIOS-PUBLIC]', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ══════════════════════════════════════════════════════════════
     * SCANNER route (auth required, accessible by any logged-in role)
     * ══════════════════════════════════════════════════════════════ */

    /* POST /api/passeios/scan — scan student token (board/disembark)
     * requireAuth only: any logged-in role (professor, aux_turno, motorista etc.) can scan
     * guardPasseios is NOT applied here so monitors/drivers without the passeios module can operate */
    router.post('/passeios/scan', async (req, res) => {
        const { token, acao = 'embarque' } = req.body; // acao: embarque | desembarque
        if (!token) return res.status(400).json({ erro: 'token obrigatório' });
        try {
            const { rows } = await pool.query(`
                SELECT ei.*, e.nome AS evento_nome, e.data_evento,
                       eo.numero AS onibus_numero, eo.nome AS onibus_nome
                FROM evento_inscricoes ei
                JOIN eventos e ON e.id = ei.evento_id
                LEFT JOIN evento_onibus eo ON eo.id = ei.onibus_id
                WHERE ei.aluno_token = $1
            `, [token]);

            if (!rows.length) return res.status(404).json({ erro: 'Aluno não encontrado.' });
            const i = rows[0];

            if (acao === 'desembarque') {
                if (!i.embarcou) return res.status(409).json({ erro: 'Aluno não embarcou ainda.', aluno: i.nome_aluno });
                await pool.query(
                    `UPDATE evento_inscricoes SET desembarcou=true, desembarcou_em=NOW() WHERE aluno_token=$1`,
                    [token]
                );
                return res.json({ ok: true, acao: 'desembarque', aluno: i.nome_aluno, turma: i.turma,
                    onibus: i.onibus_nome || `Ônibus ${i.onibus_numero}`, evento: i.evento_nome });
            } else {
                if (i.embarcou) return res.status(409).json({
                    ok: true, repetido: true,
                    acao: 'embarque', aluno: i.nome_aluno, turma: i.turma,
                    onibus: i.onibus_nome || `Ônibus ${i.onibus_numero}`, evento: i.evento_nome,
                });
                await pool.query(
                    `UPDATE evento_inscricoes SET embarcou=true, embarcou_em=NOW() WHERE aluno_token=$1`,
                    [token]
                );
                return res.json({ ok: true, acao: 'embarque', aluno: i.nome_aluno, turma: i.turma,
                    onibus: i.onibus_nome || `Ônibus ${i.onibus_numero}`, evento: i.evento_nome });
            }
        } catch (e) {
            console.error('[PASSEIOS-SCAN]', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* ══════════════════════════════════════════════════════════════
     * CRUD de eventos — requer módulo 'passeios'
     * ══════════════════════════════════════════════════════════════ */
    const guardPasseios = requireModulo('passeios');

    /* GET /api/passeios — listar eventos */
    router.get('/passeios', guardPasseios, async (req, res) => {
        try {
            const { rows } = await pool.query(`
                SELECT e.*,
                    (SELECT COUNT(*) FROM evento_inscricoes WHERE evento_id = e.id) AS total_inscritos,
                    (SELECT COUNT(*) FROM evento_inscricoes WHERE evento_id = e.id AND status_pagamento IN ('pago','confirmado')) AS total_pagos,
                    (SELECT COUNT(*) FROM evento_onibus WHERE evento_id = e.id) AS total_onibus
                FROM eventos e
                ORDER BY e.data_evento DESC, e.criado_em DESC
            `);
            res.json(rows);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    /* POST /api/passeios — criar evento */
    router.post('/passeios', guardPasseios, async (req, res) => {
        const {
            nome, destino, data_evento, valor_aluno = 0, prazo_pagamento,
            descricao, turmas = [], pix_chave, pix_nome, pix_cidade,
            onibus = [], // array of { nome, capacidade, monitor_nome, monitor_telefone, cor }
        } = req.body;

        if (!nome?.trim()) return res.status(400).json({ erro: 'Nome é obrigatório' });
        if (!destino?.trim()) return res.status(400).json({ erro: 'Destino é obrigatório' });
        if (!data_evento) return res.status(400).json({ erro: 'Data é obrigatória' });

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { rows: [ev] } = await client.query(`
                INSERT INTO eventos (nome, destino, data_evento, valor_aluno, prazo_pagamento,
                    descricao, turmas, pix_chave, pix_nome, pix_cidade, criado_por)
                VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)
                RETURNING *
            `, [nome.trim(), destino.trim(), data_evento,
                parseFloat(valor_aluno) || 0,
                prazo_pagamento || null, descricao || null,
                JSON.stringify(turmas), pix_chave || null,
                pix_nome || null, pix_cidade || null,
                req.userSession?.id || null]);

            /* Criar ônibus */
            for (let i = 0; i < onibus.length; i++) {
                const ob = onibus[i];
                await client.query(`
                    INSERT INTO evento_onibus (evento_id, numero, nome, capacidade, monitor_nome, monitor_telefone, cor)
                    VALUES ($1,$2,$3,$4,$5,$6,$7)
                `, [ev.id, i + 1, ob.nome || null, parseInt(ob.capacidade) || 40,
                    ob.monitor_nome || null, ob.monitor_telefone || null,
                    ob.cor || '#3b82f6']);
            }

            await client.query('COMMIT');
            res.status(201).json(ev);
        } catch (e) {
            await client.query('ROLLBACK');
            res.status(500).json({ erro: e.message });
        } finally { client.release(); }
    });

    /* GET /api/passeios/:id — detalhe do evento */
    router.get('/passeios/:id', guardPasseios, async (req, res) => {
        const id = parseInt(req.params.id);
        try {
            const { rows: [ev] } = await pool.query(`SELECT * FROM eventos WHERE id=$1`, [id]);
            if (!ev) return res.status(404).json({ erro: 'Evento não encontrado' });

            const { rows: onibus } = await pool.query(
                `SELECT * FROM evento_onibus WHERE evento_id=$1 ORDER BY numero`, [id]);
            const { rows: inscricoes } = await pool.query(`
                SELECT ei.*, eo.numero AS onibus_numero, eo.nome AS onibus_nome, eo.cor AS onibus_cor
                FROM evento_inscricoes ei
                LEFT JOIN evento_onibus eo ON eo.id = ei.onibus_id
                WHERE ei.evento_id=$1
                ORDER BY ei.turma, ei.nome_aluno
            `, [id]);

            res.json({ ...ev, onibus, inscricoes });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    /* PUT /api/passeios/:id — atualizar evento (inclui config de ônibus) */
    router.put('/passeios/:id', guardPasseios, async (req, res) => {
        const id = parseInt(req.params.id);
        const {
            nome, destino, data_evento, valor_aluno, prazo_pagamento,
            descricao, turmas, pix_chave, pix_nome, pix_cidade, status,
            onibus = null, // array de { id?, nome, capacidade, monitor_nome, monitor_telefone, cor }
        } = req.body;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { rows: [ev] } = await client.query(`
                UPDATE eventos SET
                    nome            = COALESCE($1, nome),
                    destino         = COALESCE($2, destino),
                    data_evento     = COALESCE($3, data_evento),
                    valor_aluno     = COALESCE($4, valor_aluno),
                    prazo_pagamento = $5,
                    descricao       = $6,
                    turmas          = COALESCE($7::jsonb, turmas),
                    pix_chave       = COALESCE($8, pix_chave),
                    pix_nome        = COALESCE($9, pix_nome),
                    pix_cidade      = COALESCE($10, pix_cidade),
                    status          = COALESCE($11, status)
                WHERE id=$12 RETURNING *
            `, [nome || null, destino || null, data_evento || null,
                valor_aluno != null ? parseFloat(valor_aluno) : null,
                prazo_pagamento || null, descricao ?? null,
                turmas ? JSON.stringify(turmas) : null,
                pix_chave ?? null, pix_nome ?? null, pix_cidade ?? null,
                status || null, id]);

            if (!ev) {
                await client.query('ROLLBACK');
                return res.status(404).json({ erro: 'Evento não encontrado' });
            }

            /* Sincronizar ônibus quando payload enviado */
            if (Array.isArray(onibus)) {
                /* IDs existentes no payload (com id) */
                const enviados   = onibus.filter(o => o.id).map(o => parseInt(o.id));
                /* Remover ônibus que não estão mais na lista */
                const { rows: existentes } = await client.query(
                    `SELECT id FROM evento_onibus WHERE evento_id=$1`, [id]);
                for (const ex of existentes) {
                    if (!enviados.includes(ex.id)) {
                        await client.query(`UPDATE evento_inscricoes SET onibus_id=NULL WHERE onibus_id=$1`, [ex.id]);
                        await client.query(`DELETE FROM evento_onibus WHERE id=$1`, [ex.id]);
                    }
                }
                /* Upsert ônibus */
                for (let i = 0; i < onibus.length; i++) {
                    const ob = onibus[i];
                    if (ob.id) {
                        await client.query(`
                            UPDATE evento_onibus SET
                                nome=$1, capacidade=$2, monitor_nome=$3, monitor_telefone=$4, cor=$5, numero=$6
                            WHERE id=$7 AND evento_id=$8
                        `, [ob.nome || null, parseInt(ob.capacidade) || 40,
                            ob.monitor_nome || null, ob.monitor_telefone || null,
                            ob.cor || '#3b82f6', i + 1, parseInt(ob.id), id]);
                    } else {
                        await client.query(`
                            INSERT INTO evento_onibus (evento_id, numero, nome, capacidade, monitor_nome, monitor_telefone, cor)
                            VALUES ($1,$2,$3,$4,$5,$6,$7)
                        `, [id, i + 1, ob.nome || null, parseInt(ob.capacidade) || 40,
                            ob.monitor_nome || null, ob.monitor_telefone || null, ob.cor || '#3b82f6']);
                    }
                }
            }

            await client.query('COMMIT');
            res.json(ev);
        } catch (e) {
            await client.query('ROLLBACK');
            res.status(500).json({ erro: e.message });
        } finally { client.release(); }
    });

    /* DELETE /api/passeios/:id — remover evento */
    router.delete('/passeios/:id', guardPasseios, async (req, res) => {
        const id = parseInt(req.params.id);
        try {
            await pool.query('DELETE FROM eventos WHERE id=$1', [id]);
            res.json({ ok: true });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    /* ══════════════════════════════════════════════════════════════
     * Ônibus CRUD
     * ══════════════════════════════════════════════════════════════ */

    /* POST /api/passeios/:id/onibus — adicionar ônibus */
    router.post('/passeios/:id/onibus', guardPasseios, async (req, res) => {
        const id = parseInt(req.params.id);
        const { nome, capacidade = 40, monitor_nome, monitor_telefone, cor = '#3b82f6' } = req.body;
        try {
            const { rows: [last] } = await pool.query(
                `SELECT COALESCE(MAX(numero),0) AS mx FROM evento_onibus WHERE evento_id=$1`, [id]);
            const numero = (last.mx || 0) + 1;
            const { rows: [ob] } = await pool.query(`
                INSERT INTO evento_onibus (evento_id, numero, nome, capacidade, monitor_nome, monitor_telefone, cor)
                VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
            `, [id, numero, nome || null, parseInt(capacidade) || 40,
                monitor_nome || null, monitor_telefone || null, cor]);
            res.status(201).json(ob);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    /* PUT /api/passeios/:id/onibus/:obId — editar ônibus */
    router.put('/passeios/:id/onibus/:obId', guardPasseios, async (req, res) => {
        const obId = parseInt(req.params.obId);
        const { nome, capacidade, monitor_nome, monitor_telefone, cor } = req.body;
        try {
            const { rows: [ob] } = await pool.query(`
                UPDATE evento_onibus SET
                    nome             = COALESCE($1, nome),
                    capacidade       = COALESCE($2, capacidade),
                    monitor_nome     = COALESCE($3, monitor_nome),
                    monitor_telefone = COALESCE($4, monitor_telefone),
                    cor              = COALESCE($5, cor)
                WHERE id=$6 RETURNING *
            `, [nome ?? null, capacidade ? parseInt(capacidade) : null,
                monitor_nome ?? null, monitor_telefone ?? null,
                cor ?? null, obId]);
            if (!ob) return res.status(404).json({ erro: 'Ônibus não encontrado' });
            res.json(ob);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    /* DELETE /api/passeios/:id/onibus/:obId — remover ônibus */
    router.delete('/passeios/:id/onibus/:obId', guardPasseios, async (req, res) => {
        const obId = parseInt(req.params.obId);
        try {
            await pool.query(`UPDATE evento_inscricoes SET onibus_id=NULL WHERE onibus_id=$1`, [obId]);
            await pool.query(`DELETE FROM evento_onibus WHERE id=$1`, [obId]);
            res.json({ ok: true });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    /* ══════════════════════════════════════════════════════════════
     * Inscrições
     * ══════════════════════════════════════════════════════════════ */

    /* POST /api/passeios/:id/inscrever — matricular alunos de turmas */
    router.post('/passeios/:id/inscrever', guardPasseios, async (req, res) => {
        const eventoId = parseInt(req.params.id);
        const { codturmas = [] } = req.body; // array of codturma ints

        if (!codturmas.length) return res.status(400).json({ erro: 'codturmas é obrigatório' });

        try {
            /* Busca dados do evento para o txid */
            const { rows: [ev] } = await pool.query(`SELECT * FROM eventos WHERE id=$1`, [eventoId]);
            if (!ev) return res.status(404).json({ erro: 'Evento não encontrado' });

            /* Busca alunos do Supabase (inclui foto se existir) */
            let todosAlunos = [];
            for (const ct of codturmas) {
                const { data, error } = await supabase
                    .from('alunos')
                    .select('codmatrizaluno,nome,turma,codturma,foto')
                    .eq('codturma', ct)
                    .order('nome');
                if (!error && data) todosAlunos.push(...data);
            }

            /* Busca inscrições já existentes neste evento */
            const { rows: jaInscritos } = await pool.query(
                `SELECT codmatrizaluno FROM evento_inscricoes WHERE evento_id=$1`, [eventoId]);
            const jaSet = new Set(jaInscritos.map(r => r.codmatrizaluno));

            let inseridos = 0;
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                for (const a of todosAlunos) {
                    if (jaSet.has(a.codmatrizaluno)) continue;
                    const token = gerarToken();
                    await client.query(`
                        INSERT INTO evento_inscricoes
                            (evento_id, codmatrizaluno, nome_aluno, turma, codturma, aluno_token, foto_url)
                        VALUES ($1,$2,$3,$4,$5,$6,$7)
                        ON CONFLICT (evento_id, codmatrizaluno) DO NOTHING
                    `, [eventoId, a.codmatrizaluno, a.nome, a.turma || '', a.codturma || null, token,
                        a.foto || null]);
                    inseridos++;
                }

                /* Gerar txid para cada inscrição sem um */
                const { rows: semTxid } = await client.query(
                    `SELECT id FROM evento_inscricoes WHERE evento_id=$1 AND txid IS NULL`, [eventoId]);
                for (const r of semTxid) {
                    const txid = gerarTxid(eventoId, r.id);
                    await client.query(`UPDATE evento_inscricoes SET txid=$1 WHERE id=$2`, [txid, r.id]);
                }

                await client.query('COMMIT');
            } catch (e) {
                await client.query('ROLLBACK');
                throw e;
            } finally { client.release(); }

            res.json({ ok: true, inseridos, total: todosAlunos.length });
        } catch (e) {
            console.error('[PASSEIOS-INSCREVER]', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* POST /api/passeios/:id/inscrever-avulso — inscrever aluno avulso por registro */
    router.post('/passeios/:id/inscrever-avulso', guardPasseios, async (req, res) => {
        const eventoId = parseInt(req.params.id);
        const { codmatrizaluno, nome_aluno, turma, codturma } = req.body;
        if (!codmatrizaluno || !nome_aluno) return res.status(400).json({ erro: 'codmatrizaluno e nome_aluno são obrigatórios' });
        try {
            const token = gerarToken();
            const { rows: [insc] } = await pool.query(`
                INSERT INTO evento_inscricoes (evento_id, codmatrizaluno, nome_aluno, turma, codturma, aluno_token)
                VALUES ($1,$2,$3,$4,$5,$6)
                ON CONFLICT (evento_id, codmatrizaluno) DO NOTHING RETURNING *
            `, [eventoId, parseInt(codmatrizaluno), nome_aluno, turma || '', codturma || null, token]);
            if (!insc) return res.status(409).json({ erro: 'Aluno já inscrito' });
            /* Gerar txid */
            const txid = gerarTxid(eventoId, insc.id);
            await pool.query(`UPDATE evento_inscricoes SET txid=$1 WHERE id=$2`, [txid, insc.id]);
            insc.txid = txid;
            res.status(201).json(insc);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    /* DELETE /api/passeios/:id/inscricoes/:inscId — remover inscrição */
    router.delete('/passeios/:id/inscricoes/:inscId', guardPasseios, async (req, res) => {
        const inscId = parseInt(req.params.inscId);
        try {
            await pool.query(`DELETE FROM evento_inscricoes WHERE id=$1`, [inscId]);
            res.json({ ok: true });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    /* PUT /api/passeios/:id/inscricoes/:inscId — editar dados da inscrição */
    router.put('/passeios/:id/inscricoes/:inscId', guardPasseios, async (req, res) => {
        const inscId = parseInt(req.params.inscId);
        const { restricoes_medicas, contato_responsavel, nome_responsavel } = req.body;
        try {
            const { rows: [insc] } = await pool.query(`
                UPDATE evento_inscricoes SET
                    restricoes_medicas  = $1,
                    contato_responsavel = $2,
                    nome_responsavel    = $3
                WHERE id=$4 RETURNING *
            `, [restricoes_medicas ?? null, contato_responsavel ?? null, nome_responsavel ?? null, inscId]);
            if (!insc) return res.status(404).json({ erro: 'Inscrição não encontrada' });
            res.json(insc);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    /* POST /api/passeios/:id/inscricoes/:inscId/pagar — confirmar pagamento */
    router.post('/passeios/:id/inscricoes/:inscId/pagar', guardPasseios, async (req, res) => {
        const inscId = parseInt(req.params.inscId);
        const { obs } = req.body;
        const quem = req.userSession?.nome || 'sistema';
        try {
            const { rows: [insc] } = await pool.query(`
                UPDATE evento_inscricoes SET
                    status_pagamento = 'pago',
                    pago_em          = NOW(),
                    pago_por         = $1,
                    comprovante_obs  = $2
                WHERE id=$3 RETURNING *
            `, [quem, obs || null, inscId]);
            if (!insc) return res.status(404).json({ erro: 'Inscrição não encontrada' });
            res.json(insc);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    /* POST /api/passeios/:id/inscricoes/:inscId/reverter — reverter pagamento */
    router.post('/passeios/:id/inscricoes/:inscId/reverter', guardPasseios, async (req, res) => {
        const inscId = parseInt(req.params.inscId);
        try {
            const { rows: [insc] } = await pool.query(`
                UPDATE evento_inscricoes SET
                    status_pagamento = 'pendente',
                    pago_em          = NULL,
                    pago_por         = NULL,
                    comprovante_obs  = NULL
                WHERE id=$1 RETURNING *
            `, [inscId]);
            if (!insc) return res.status(404).json({ erro: 'Inscrição não encontrada' });
            res.json(insc);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    /* POST /api/passeios/:id/inscricoes/:inscId/confirmar — elevar de pago → confirmado */
    router.post('/passeios/:id/inscricoes/:inscId/confirmar', guardPasseios, async (req, res) => {
        const inscId = parseInt(req.params.inscId);
        const { comprovante_obs } = req.body;
        const quem = req.userSession?.nome || 'sistema';
        try {
            const { rows: [insc] } = await pool.query(`
                UPDATE evento_inscricoes SET
                    status_pagamento = 'confirmado',
                    comprovante_obs  = COALESCE($1, comprovante_obs),
                    pago_por         = COALESCE(pago_por, $2)
                WHERE id=$3 AND status_pagamento IN ('pago','confirmado') RETURNING *
            `, [comprovante_obs || null, quem, inscId]);
            if (!insc) return res.status(404).json({ erro: 'Inscrição não encontrada ou status inválido para confirmação' });
            res.json(insc);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    /* POST /api/passeios/:id/inscricoes/:inscId/comprovante — upload de comprovante de pagamento */
    router.post('/passeios/:id/inscricoes/:inscId/comprovante', guardPasseios,
        _upload.single('comprovante'),
        async (req, res) => {
            const inscId = parseInt(req.params.inscId);
            if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado ou tipo não permitido (jpg/png/webp/pdf, máx 8MB)' });
            const arquivoUrl = `/api/passeios/comprovante/${req.file.filename}`;
            try {
                const { rows: [insc] } = await pool.query(`
                    UPDATE evento_inscricoes SET
                        comprovante_arquivo_url = $1,
                        status_pagamento = CASE WHEN status_pagamento='pendente' THEN 'pago' ELSE status_pagamento END,
                        pago_em = CASE WHEN pago_em IS NULL THEN NOW() ELSE pago_em END,
                        pago_por = COALESCE(pago_por, $2)
                    WHERE id=$3 RETURNING *
                `, [arquivoUrl, req.userSession?.nome || 'sistema', inscId]);
                if (!insc) return res.status(404).json({ erro: 'Inscrição não encontrada' });
                res.json({ ok: true, arquivoUrl, insc });
            } catch (e) {
                res.status(500).json({ erro: e.message });
            }
        }
    );

    /* GET /api/passeios/:id/pix/:inscId — gerar PIX QR do aluno */
    router.get('/passeios/:id/pix/:inscId', guardPasseios, async (req, res) => {
        const eventoId = parseInt(req.params.id);
        const inscId   = parseInt(req.params.inscId);
        try {
            const { rows: [ev] } = await pool.query(`SELECT * FROM eventos WHERE id=$1`, [eventoId]);
            if (!ev) return res.status(404).json({ erro: 'Evento não encontrado' });
            if (!ev.pix_chave) return res.status(400).json({ erro: 'Chave PIX não configurada no evento' });

            const { rows: [insc] } = await pool.query(
                `SELECT * FROM evento_inscricoes WHERE id=$1 AND evento_id=$2`, [inscId, eventoId]);
            if (!insc) return res.status(404).json({ erro: 'Inscrição não encontrada' });

            const payload = gerarPixPayload({
                chave:    ev.pix_chave,
                nome:     ev.pix_nome || 'ESCOLA',
                cidade:   ev.pix_cidade || 'CURITIBA',
                valor:    parseFloat(ev.valor_aluno) || 0,
                txid:     insc.txid || gerarTxid(eventoId, inscId),
                descricao: `Passeio ${ev.nome}`.slice(0, 72),
            });

            const qrDataUrl = await QRCode.toDataURL(payload, {
                width: 300, errorCorrectionLevel: 'M', margin: 2,
            });

            res.json({ payload, qrDataUrl, txid: insc.txid, valor: ev.valor_aluno });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    /* POST /api/passeios/:id/lembrete — WhatsApp para pendentes */
    router.post('/passeios/:id/lembrete', guardPasseios, async (req, res) => {
        const eventoId = parseInt(req.params.id);
        const { mensagem_extra } = req.body;
        try {
            const { rows: [ev] } = await pool.query(`SELECT * FROM eventos WHERE id=$1`, [eventoId]);
            if (!ev) return res.status(404).json({ erro: 'Evento não encontrado' });

            const { rows: pendentes } = await pool.query(`
                SELECT * FROM evento_inscricoes
                WHERE evento_id=$1 AND status_pagamento='pendente' AND contato_responsavel IS NOT NULL
            `, [eventoId]);

            const webhookUrl = await getConfig('n8n_webhook_url');
            const token      = await getConfig('comunicados_token');
            const baseUrl    = process.env.REPLIT_DEV_DOMAIN
                ? `https://${process.env.REPLIT_DEV_DOMAIN}`
                : 'http://localhost:5000';

            const dataStr = new Date(ev.data_evento + 'T12:00').toLocaleDateString('pt-BR');
            const resultados = [];

            for (const insc of pendentes) {
                const pagLink = `${baseUrl}/p/${eventoId}/${insc.aluno_token}`;
                const pix = ev.pix_chave ? gerarPixPayload({
                    chave: ev.pix_chave, nome: ev.pix_nome || 'ESCOLA',
                    cidade: ev.pix_cidade || 'CURITIBA',
                    valor: parseFloat(ev.valor_aluno) || 0,
                    txid: insc.txid, descricao: `Passeio ${ev.nome}`.slice(0, 72),
                }) : null;

                const mensagem = [
                    `Olá ${insc.nome_responsavel || 'Responsável'}! 👋`,
                    `O pagamento do passeio *${ev.nome}* (${dataStr}) para ${insc.nome_aluno} está *pendente*.`,
                    ev.valor_aluno > 0 ? `💰 Valor: R$ ${parseFloat(ev.valor_aluno).toFixed(2).replace('.', ',')}` : null,
                    ev.prazo_pagamento ? `📅 Prazo: ${new Date(ev.prazo_pagamento + 'T12:00').toLocaleDateString('pt-BR')}` : null,
                    pix ? `\n*PIX (copia e cola):*\n${pix}` : null,
                    mensagem_extra || null,
                    `\n📎 Detalhes: ${pagLink}`,
                ].filter(Boolean).join('\n');

                if (webhookUrl) {
                    try {
                        await fetch(webhookUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                telefone:  insc.contato_responsavel,
                                mensagem,
                                token,
                                aluno:     insc.nome_aluno,
                                evento:    ev.nome,
                            }),
                        });
                        resultados.push({ id: insc.id, ok: true });
                    } catch (err) {
                        resultados.push({ id: insc.id, ok: false, erro: err.message });
                    }
                } else {
                    console.log(`[PASSEIOS-LEMBRETE] Sem N8n. Para ${insc.contato_responsavel}: ${mensagem.slice(0, 80)}...`);
                    resultados.push({ id: insc.id, ok: true, simulado: true });
                }
            }

            res.json({ ok: true, enviados: resultados.length, sem_n8n: !webhookUrl, resultados });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    /* POST /api/passeios/:id/distribuir — distribuir alunos nos ônibus */
    router.post('/passeios/:id/distribuir', guardPasseios, async (req, res) => {
        const eventoId = parseInt(req.params.id);
        try {
            const { rows: onibus } = await pool.query(
                `SELECT * FROM evento_onibus WHERE evento_id=$1 ORDER BY numero`, [eventoId]);
            if (!onibus.length) return res.status(400).json({ erro: 'Nenhum ônibus cadastrado' });

            /* Pegar alunos pagos ou confirmados (ambos participam do passeio) */
            const { rows: inscritos } = await pool.query(`
                SELECT * FROM evento_inscricoes
                WHERE evento_id=$1 AND status_pagamento IN ('pago','confirmado')
                ORDER BY turma, nome_aluno
            `, [eventoId]);

            if (!inscritos.length) return res.status(400).json({ erro: 'Nenhum aluno com pagamento confirmado' });

            /* Limpa distribuição atual dos inscritos selecionados */
            await pool.query(
                `UPDATE evento_inscricoes SET onibus_id=NULL WHERE evento_id=$1 AND status_pagamento IN ('pago','confirmado')`,
                [eventoId]);

            /* Distribui round-robin respeitando capacidade */
            let obIdx = 0;
            const contadores = {};
            onibus.forEach(o => { contadores[o.id] = 0; });

            for (const a of inscritos) {
                /* Avança para próximo ônibus com espaço */
                let tentativas = 0;
                while (tentativas < onibus.length) {
                    const ob = onibus[obIdx % onibus.length];
                    if (contadores[ob.id] < ob.capacidade) {
                        await pool.query(
                            `UPDATE evento_inscricoes SET onibus_id=$1 WHERE id=$2`,
                            [ob.id, a.id]);
                        contadores[ob.id]++;
                        obIdx++;
                        break;
                    }
                    obIdx++;
                    tentativas++;
                }
            }

            /* Contar apenas quem foi efetivamente atribuído a um ônibus */
            const { rows: atribuidos } = await pool.query(
                `SELECT COUNT(*) AS n FROM evento_inscricoes WHERE evento_id=$1 AND onibus_id IS NOT NULL AND status_pagamento IN ('pago','confirmado')`,
                [eventoId]);
            const totalAtribuidos  = parseInt(atribuidos[0].n) || 0;
            const naoAtribuidos    = inscritos.length - totalAtribuidos;
            const capacidadeTotal  = onibus.reduce((s, o) => s + (o.capacidade || 0), 0);

            res.json({
                ok:           naoAtribuidos === 0,
                distribuidos: totalAtribuidos,
                nao_atribuidos: naoAtribuidos,
                capacidade_total: capacidadeTotal,
                aviso: naoAtribuidos > 0
                    ? `${naoAtribuidos} aluno(s) não atribuídos — capacidade total insuficiente (${capacidadeTotal} vagas para ${inscritos.length} alunos)`
                    : null,
            });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    /* PUT /api/passeios/:id/inscricoes/:inscId/onibus — mover aluno de ônibus */
    router.put('/passeios/:id/inscricoes/:inscId/onibus', guardPasseios, async (req, res) => {
        const inscId = parseInt(req.params.inscId);
        const { onibus_id } = req.body;
        try {
            const { rows: [insc] } = await pool.query(`
                UPDATE evento_inscricoes SET onibus_id=$1 WHERE id=$2 RETURNING *
            `, [onibus_id || null, inscId]);
            if (!insc) return res.status(404).json({ erro: 'Inscrição não encontrada' });
            res.json(insc);
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    /* GET /api/passeios/:id/pulseiras/pdf — PDF gerado pelo servidor (A4, 24 pulseiras/página) */
    router.get('/passeios/:id/pulseiras/pdf', guardPasseios, async (req, res) => {
        const eventoId = parseInt(req.params.id);
        const { onibus_id } = req.query;
        let page;
        try {
            const { rows: [ev] } = await pool.query(`SELECT * FROM eventos WHERE id=$1`, [eventoId]);
            if (!ev) return res.status(404).json({ erro: 'Evento não encontrado' });

            let q = `
                SELECT ei.*, eo.numero AS onibus_numero, eo.nome AS onibus_nome, eo.cor AS onibus_cor
                FROM evento_inscricoes ei
                LEFT JOIN evento_onibus eo ON eo.id = ei.onibus_id
                WHERE ei.evento_id=$1
            `;
            const params = [eventoId];
            if (onibus_id) { q += ` AND ei.onibus_id=$2`; params.push(parseInt(onibus_id)); }
            q += ` ORDER BY eo.numero NULLS LAST, ei.turma, ei.nome_aluno`;
            const { rows: inscricoes } = await pool.query(q, params);
            if (!inscricoes.length) return res.status(404).json({ erro: 'Nenhuma inscrição encontrada' });

            const baseUrl = process.env.REPLIT_DEV_DOMAIN
                ? `https://${process.env.REPLIT_DEV_DOMAIN}`
                : 'http://localhost:5000';

            const items = await Promise.all(inscricoes.map(async (i) => {
                const url = `${baseUrl}/p/${eventoId}/${i.aluno_token}`;
                const qr  = await QRCode.toDataURL(url, { width: 100, margin: 1, errorCorrectionLevel: 'M' });
                const cor  = i.onibus_cor || '#4a90d9';
                const label = i.onibus_id ? (i.onibus_nome || `Ônibus ${i.onibus_numero}`) : 'Sem ônibus';
                const ini   = (i.nome_aluno || '?').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
                return { ...i, qrDataUrl: qr, cor, label, ini };
            }));

            /* ── Escapar HTML para evitar injeção no template do PDF ── */
            const esc2 = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

            /* ── Montar HTML A4 com 24 pulseiras (4×6) por página ── */
            const cardsHtml = items.map(i => `
                <div class="pulseira" style="border-left:6px solid ${esc2(i.cor)}">
                    <div class="ps-foto-wrap">
                        ${i.foto_url
                            ? `<img class="ps-foto" src="${esc2(i.foto_url)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
                            : ''}
                        <div class="ps-ini" style="display:${i.foto_url ? 'none' : 'flex'};background:${esc2(i.cor)}22;color:${esc2(i.cor)}">${esc2(i.ini)}</div>
                    </div>
                    <div class="ps-info">
                        <div class="ps-nome">${esc2(i.nome_aluno)}</div>
                        <div class="ps-turma">${esc2(i.turma || '')} &bull; ${esc2(i.label)}</div>
                        ${i.restricoes_medicas ? `<div class="ps-rest">⚠ ${esc2(i.restricoes_medicas)}</div>` : ''}
                    </div>
                    <div class="ps-qr"><img src="${esc2(i.qrDataUrl)}" width="72" height="72" alt="QR"></div>
                </div>`).join('');

            const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>Pulseiras — ${ev.nome}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,Helvetica,sans-serif;background:#fff}
.grade{display:grid;grid-template-columns:repeat(4,1fr);gap:4mm;padding:8mm;width:210mm}
.pulseira{display:flex;align-items:center;gap:2mm;border:1px solid #ccc;border-radius:3mm;padding:2mm;height:44mm;overflow:hidden;background:#fff;page-break-inside:avoid}
.ps-foto-wrap{flex-shrink:0;width:36px;height:36px;position:relative}
.ps-foto{width:36px;height:36px;border-radius:50%;object-fit:cover}
.ps-ini{width:36px;height:36px;border-radius:50%;align-items:center;justify-content:center;font-weight:700;font-size:13px}
.ps-info{flex:1;min-width:0;overflow:hidden}
.ps-nome{font-size:7.5pt;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ps-turma{font-size:6pt;color:#555;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1mm}
.ps-rest{font-size:5.5pt;color:#c0392b;margin-top:1mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ps-qr{flex-shrink:0}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
</head><body>
<div class="grade">${cardsHtml}</div>
</body></html>`;

            const browser = await getBrowser();
            page = await browser.newPage();
            await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
            const pdfBuffer = await page.pdf({
                format: 'A4',
                printBackground: true,
                margin: { top: '0', right: '0', bottom: '0', left: '0' },
            });
            await page.close();
            page = null;

            const nomeArquivo = encodeURIComponent(`pulseiras-${ev.nome}-${eventoId}`);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}.pdf"`);
            res.send(Buffer.from(pdfBuffer));
        } catch (e) {
            if (page) { try { await page.close(); } catch {} }
            console.error('[Passeios PDF]', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    /* GET /api/passeios/:id/pulseiras — dados para impressão de pulseiras */
    router.get('/passeios/:id/pulseiras', guardPasseios, async (req, res) => {
        const eventoId = parseInt(req.params.id);
        const { onibus_id } = req.query;
        try {
            const { rows: [ev] } = await pool.query(`SELECT * FROM eventos WHERE id=$1`, [eventoId]);
            if (!ev) return res.status(404).json({ erro: 'Evento não encontrado' });

            let q = `
                SELECT ei.*, eo.numero AS onibus_numero, eo.nome AS onibus_nome, eo.cor AS onibus_cor
                FROM evento_inscricoes ei
                LEFT JOIN evento_onibus eo ON eo.id = ei.onibus_id
                WHERE ei.evento_id=$1
            `;
            const params = [eventoId];
            if (onibus_id) { q += ` AND ei.onibus_id=$2`; params.push(parseInt(onibus_id)); }
            q += ` ORDER BY eo.numero NULLS LAST, ei.turma, ei.nome_aluno`;

            const { rows: inscricoes } = await pool.query(q, params);

            const baseUrl = process.env.REPLIT_DEV_DOMAIN
                ? `https://${process.env.REPLIT_DEV_DOMAIN}`
                : 'http://localhost:5000';

            /* Gerar QR data-URL para cada aluno */
            const items = await Promise.all(inscricoes.map(async (i) => {
                const url = `${baseUrl}/p/${eventoId}/${i.aluno_token}`;
                const qr  = await QRCode.toDataURL(url, { width: 120, margin: 1, errorCorrectionLevel: 'M' });
                return {
                    ...i,
                    qrDataUrl: qr,
                    pagLink:   url,
                    onibus_label: i.onibus_id ? (i.onibus_nome || `Ônibus ${i.onibus_numero}`) : '—',
                };
            }));

            res.json({ evento: ev, inscricoes: items });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    /* GET /api/passeios/:id/painel — painel ao vivo do evento */
    router.get('/passeios/:id/painel', guardPasseios, async (req, res) => {
        const eventoId = parseInt(req.params.id);
        try {
            const { rows: [ev] } = await pool.query(`SELECT * FROM eventos WHERE id=$1`, [eventoId]);
            if (!ev) return res.status(404).json({ erro: 'Evento não encontrado' });

            const { rows: onibus } = await pool.query(`
                SELECT eo.*,
                    COUNT(ei.id)                                          AS total,
                    COUNT(ei.id) FILTER (WHERE ei.embarcou = true)        AS embarcados,
                    COUNT(ei.id) FILTER (WHERE ei.desembarcou = true)     AS desembarcados,
                    COUNT(ei.id) FILTER (WHERE ei.embarcou = false)       AS ausentes
                FROM evento_onibus eo
                LEFT JOIN evento_inscricoes ei ON ei.onibus_id = eo.id
                WHERE eo.evento_id=$1
                GROUP BY eo.id
                ORDER BY eo.numero
            `, [eventoId]);

            const { rows: geral } = await pool.query(`
                SELECT
                    COUNT(*)                                                                  AS total,
                    COUNT(*) FILTER (WHERE status_pagamento IN ('pago','confirmado'))         AS pagos,
                    COUNT(*) FILTER (WHERE status_pagamento='pendente')                       AS pendentes,
                    COUNT(*) FILTER (WHERE embarcou=true)                                     AS embarcados,
                    COUNT(*) FILTER (WHERE desembarcou=true)                                  AS desembarcados
                FROM evento_inscricoes WHERE evento_id=$1
            `, [eventoId]);

            const { rows: ausentes_retorno } = await pool.query(`
                SELECT nome_aluno, turma, onibus_id
                FROM evento_inscricoes
                WHERE evento_id=$1 AND embarcou=true AND desembarcou=false
                ORDER BY nome_aluno
            `, [eventoId]);

            res.json({
                evento: ev,
                onibus,
                geral: geral[0],
                ausentes_retorno,
            });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    /* GET /api/passeios/comprovante/:filename — download autenticado de comprovante */
    router.get('/passeios/comprovante/:filename', guardPasseios, async (req, res) => {
        const filename = path.basename(req.params.filename); // sanitize — no path traversal
        const filePath = path.resolve(__dirname, '../../../uploads/comprovantes', filename);
        res.sendFile(filePath, err => {
            if (err) res.status(404).json({ erro: 'Arquivo não encontrado' });
        });
    });

    /* POST /api/passeios/:id/status-evento — mudar estado do evento + auto-notificar responsáveis */
    router.post('/passeios/:id/status-evento', guardPasseios, async (req, res) => {
        const eventoId = parseInt(req.params.id);
        const { status_atual } = req.body; // planejando | em_viagem | no_destino | retornando | encerrado
        const estadosValidos = ['planejando','em_viagem','no_destino','retornando','encerrado'];
        if (!estadosValidos.includes(status_atual)) {
            return res.status(400).json({ erro: `status_atual inválido. Use: ${estadosValidos.join(', ')}` });
        }

        /* Mapa estado → tipo de notificação (undefined = sem auto-notif) */
        const autoNotif = { em_viagem: 'saida', no_destino: 'chegada', retornando: 'retorno' };
        const tipo = autoNotif[status_atual];

        try {
            const { rows: [ev] } = await pool.query(
                `UPDATE eventos SET status_atual=$1 WHERE id=$2 RETURNING *`,
                [status_atual, eventoId]);
            if (!ev) return res.status(404).json({ erro: 'Evento não encontrado' });

            let enviados = 0, sem_n8n = false;
            if (tipo) {
                /* Auto-despachar notificação para todos os responsáveis cadastrados */
                const msgs = {
                    saida:   '🚌 O ônibus saiu com os alunos! Acompanhe em tempo real.',
                    chegada: '🎉 Chegamos ao destino com segurança!',
                    retorno: '🏠 O ônibus está retornando. Aguardem no ponto de chegada.',
                };
                const { rows: inscritos } = await pool.query(`
                    SELECT ei.*, eo.nome AS onibus_nome, eo.numero AS onibus_numero
                    FROM evento_inscricoes ei
                    LEFT JOIN evento_onibus eo ON eo.id = ei.onibus_id
                    WHERE ei.evento_id=$1 AND ei.contato_responsavel IS NOT NULL
                      AND ei.status_pagamento IN ('pago','confirmado')
                `, [eventoId]);

                const webhookUrl = await getConfig('n8n_webhook_url');
                const token      = await getConfig('comunicados_token');
                const baseUrl    = process.env.REPLIT_DEV_DOMAIN
                    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
                    : 'http://localhost:5000';

                sem_n8n = !webhookUrl;
                for (const insc of inscritos) {
                    const pagLink = `${baseUrl}/p/${eventoId}/${insc.aluno_token}`;
                    const mensagem = [
                        msgs[tipo],
                        `👤 Aluno: ${insc.nome_aluno}`,
                        `📅 Evento: ${ev.nome}`,
                        `📎 Acompanhe: ${pagLink}`,
                    ].join('\n');
                    if (webhookUrl) {
                        await fetch(webhookUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ telefone: insc.contato_responsavel, mensagem, token,
                                aluno: insc.nome_aluno, evento: ev.nome, tipo }),
                        }).catch(e => console.warn('[PASSEIOS-ESTADO-NOTIF]', e.message));
                    } else {
                        console.log(`[PASSEIOS-ESTADO-${tipo.toUpperCase()}] Sem N8n → ${insc.contato_responsavel}: ${mensagem.slice(0,60)}…`);
                    }
                    enviados++;
                }
            }

            res.json({ ok: true, status_atual, notif_tipo: tipo || null, enviados, sem_n8n });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    /* POST /api/passeios/:id/notificar-onibus — notificações de momento: saída/chegada/retorno */
    router.post('/passeios/:id/notificar-onibus', guardPasseios, async (req, res) => {
        const eventoId = parseInt(req.params.id);
        const { tipo, onibus_id, mensagem_extra } = req.body;
        // tipo: saida | chegada | retorno

        const msgs = {
            saida:   '🚌 O ônibus *{onibus}* saiu com os alunos! Acompanhe em tempo real.',
            chegada: '🎉 O ônibus *{onibus}* chegou ao destino com segurança!',
            retorno: '🏠 O ônibus *{onibus}* está retornando. Aguardem no ponto de chegada.',
        };
        if (!msgs[tipo]) return res.status(400).json({ erro: 'tipo inválido. Use: saida, chegada, retorno' });

        try {
            const { rows: [ev] } = await pool.query(`SELECT * FROM eventos WHERE id=$1`, [eventoId]);
            if (!ev) return res.status(404).json({ erro: 'Evento não encontrado' });

            /* Buscar alunos do ônibus especificado (ou todos com telefone) — inclui pagos E confirmados */
            let q = `SELECT ei.*, eo.nome AS onibus_nome, eo.numero AS onibus_numero
                     FROM evento_inscricoes ei
                     LEFT JOIN evento_onibus eo ON eo.id = ei.onibus_id
                     WHERE ei.evento_id=$1 AND ei.contato_responsavel IS NOT NULL
                     AND ei.status_pagamento IN ('pago','confirmado')`;
            const params = [eventoId];
            if (onibus_id) { q += ` AND ei.onibus_id=$2`; params.push(parseInt(onibus_id)); }

            const { rows: inscritos } = await pool.query(q, params);

            const webhookUrl = await getConfig('n8n_webhook_url');
            const token      = await getConfig('comunicados_token');
            const baseUrl    = process.env.REPLIT_DEV_DOMAIN
                ? `https://${process.env.REPLIT_DEV_DOMAIN}`
                : 'http://localhost:5000';

            const resultados = [];
            for (const insc of inscritos) {
                const onibusLabel = insc.onibus_nome || `Ônibus ${insc.onibus_numero}` || 'Ônibus';
                const pagLink = `${baseUrl}/p/${eventoId}/${insc.aluno_token}`;
                const mensagem = [
                    msgs[tipo].replace('{onibus}', onibusLabel),
                    `👤 Aluno: ${insc.nome_aluno}`,
                    `📅 Evento: ${ev.nome}`,
                    mensagem_extra || null,
                    `\n📎 Acompanhe: ${pagLink}`,
                ].filter(Boolean).join('\n');

                if (webhookUrl) {
                    try {
                        await fetch(webhookUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ telefone: insc.contato_responsavel, mensagem, token,
                                aluno: insc.nome_aluno, evento: ev.nome, tipo }),
                        });
                        resultados.push({ id: insc.id, ok: true });
                    } catch (err) {
                        resultados.push({ id: insc.id, ok: false, erro: err.message });
                    }
                } else {
                    console.log(`[PASSEIOS-NOTIF-${tipo.toUpperCase()}] Sem N8n. Para ${insc.contato_responsavel}: ${mensagem.slice(0,80)}...`);
                    resultados.push({ id: insc.id, ok: true, simulado: true });
                }
            }

            res.json({ ok: true, tipo, enviados: resultados.length, sem_n8n: !webhookUrl, resultados });
        } catch (e) { res.status(500).json({ erro: e.message }); }
    });

    /* POST /api/public/passeios/:eventoId/:alunoToken/notificar — responsável notifica escola (sem auth) */
    publicRouter.post('/public/passeios/:eventoId/:alunoToken/notificar', async (req, res) => {
        const { eventoId, alunoToken } = req.params;
        const { tipo = 'visualizou' } = req.body; // visualizou | confirmou
        try {
            const { rows } = await pool.query(
                `SELECT ei.nome_aluno, ei.turma, e.nome AS evento_nome
                 FROM evento_inscricoes ei JOIN eventos e ON e.id=ei.evento_id
                 WHERE ei.evento_id=$1 AND ei.aluno_token=$2`, [eventoId, alunoToken]);
            if (!rows.length) return res.status(404).json({ erro: 'Não encontrado' });

            const { nome_aluno, turma, evento_nome } = rows[0];
            console.log(`[PASSEIOS-PUBLIC-NOTIF] ${tipo}: ${nome_aluno} / ${evento_nome}`);

            /* Encaminhar via N8n webhook (se configurado) para notificar equipe escolar */
            const webhookUrl = await getConfig('n8n_webhook_url');
            const token      = await getConfig('comunicados_token');
            if (webhookUrl) {
                const tipoLabel = { visualizou: 'visualizou o link', confirmou: 'confirmou ciência' };
                const mensagem = [
                    `📱 *Notificação de Responsável — EduSync*`,
                    `O responsável do aluno *${nome_aluno}* (${turma}) ${tipoLabel[tipo] || tipo} na página do passeio *${evento_nome}*.`,
                ].join('\n');
                /* Envia para contato de notificação escolar se configurado */
                const escolaContato = await getConfig('notif_escola_telefone');
                if (escolaContato) {
                    await fetch(webhookUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ telefone: escolaContato, mensagem, token, tipo }),
                    }).catch(err => console.warn('[PASSEIOS-PUBLIC-NOTIF] webhook error:', err.message));
                }
            }

            res.json({ ok: true });
        } catch (e) {
            console.error('[PASSEIOS-PUBLIC-NOTIF]', e.message);
            res.status(500).json({ erro: e.message });
        }
    });

    return { router, publicRouter };
}

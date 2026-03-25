import { Router } from 'express';

function decodeJwtPayload(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch { return null; }
}

export function createAuthRouter({ tokenService, syncService }) {
    const router = Router();

    router.get('/status', (req, res) => {
        res.json(tokenService.getStatus());
    });

    // Dados básicos do professor logado (decodificados do JWT)
    router.get('/me', async (req, res) => {
        try {
            const token   = await tokenService.getValidToken();
            const payload = decodeJwtPayload(token);

            const nome = payload?.nome
                || payload?.name
                || payload?.preferred_username
                || payload?.sub
                || null;

            const cpf = tokenService.getCpf() || '';
            const cpfMask = cpf.length >= 11
                ? cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.***.***-$4')
                : cpf;

            res.json({
                nome:     nome || 'Professor(a)',
                cpfMask,
                claims:   payload || {},
            });
        } catch (e) {
            res.status(500).json({ erro: e.message });
        }
    });

    router.post('/configurar', async (req, res) => {
        const { cpf, senha } = req.body;
        if (!cpf || !senha) {
            return res.status(400).json({ erro: 'CPF e Senha são obrigatórios' });
        }

        const cpfAnterior = tokenService.getCpf();
        const trocouUsuario = cpfAnterior && cpfAnterior !== cpf;

        tokenService.setCredentials(cpf, senha);

        try {
            await tokenService.getValidToken(true);
            const status = tokenService.getStatus();

            // Disparar sincronização em background após login bem-sucedido
            // (especialmente importante ao trocar de usuário)
            if (trocouUsuario) {
                console.log(`[Auth] Troca de usuário detectada (${cpfAnterior.slice(-4)} → ${cpf.slice(-4)}), iniciando re-sync...`);
            } else {
                console.log('[Auth] Login bem-sucedido, iniciando sync em background...');
            }
            syncService.sincronizarComSupabase()
                .then(r => console.log('[Auth] Sync pós-login concluído:', r.status))
                .catch(e => console.warn('[Auth] Sync pós-login falhou:', e.message));

            res.json({
                sucesso: true,
                mensagem: 'Credenciais salvas e token gerado com sucesso',
                expiracao: status.tokenExpiracao,
                trocouUsuario,
            });
        } catch (error) {
            res.status(500).json({ sucesso: false, erro: error.message });
        }
    });

    return router;
}

import { Router } from 'express';

export function createAuthRouter({ tokenService, syncService }) {
    const router = Router();

    router.get('/status', (req, res) => {
        res.json(tokenService.getStatus());
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

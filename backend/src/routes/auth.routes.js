import { Router } from 'express';

export function createAuthRouter({ tokenService }) {
    const router = Router();

    router.get('/status', (req, res) => {
        res.json(tokenService.getStatus());
    });

    router.post('/configurar', async (req, res) => {
        const { cpf, senha } = req.body;
        if (!cpf || !senha) {
            return res.status(400).json({ erro: 'CPF e Senha são obrigatórios' });
        }
        tokenService.setCredentials(cpf, senha);
        try {
            await tokenService.getValidToken(true);
            const status = tokenService.getStatus();
            res.json({
                sucesso: true,
                mensagem: 'Credenciais salvas e token gerado com sucesso',
                expiracao: status.tokenExpiracao,
            });
        } catch (error) {
            res.status(500).json({ sucesso: false, erro: error.message });
        }
    });

    return router;
}

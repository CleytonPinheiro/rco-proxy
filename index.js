import express from 'express';
import axios from 'axios';

const app = express();

app.use(express.json());

app.get('/', (req, res) => {
        res.send('Servidor Express funcionando! Use /api/acessos para consultar a API do RCO Digital.');
});

app.get('/api/acessos', async (req, res) => {
        try {
                let authToken = process.env.AUTHORIZATION_TOKEN;
                
                if (!authToken) {
                        return res.status(500).json({ 
                                erro: 'Token de autorização não configurado. Configure a variável AUTHORIZATION_TOKEN.' 
                        });
                }

                authToken = authToken.trim().replace(/[\r\n\t]/g, '').replace(/\s+/g, '');
                authToken = authToken.replace(/[^a-zA-Z0-9._-]/g, '');

                const response = await axios.get(
                        'https://apigateway-educacao.paas.pr.gov.br/seed/rcdig/estadual/v1/classe/v1/acessos/atualizar',
                        {
                                headers: {
                                        'consumerId': 'RCDIGWEB',
                                        'Authorization': `Bearer ${authToken}`
                                },
                                timeout: 30000,
                                validateStatus: () => true
                        }
                );
                
                if (response.status === 401 || response.status === 403) {
                        return res.status(response.status).json({
                                erro: 'Token de autorização inválido ou expirado',
                                detalhes: response.data,
                                status: response.status,
                                dica: 'Atualize o AUTHORIZATION_TOKEN na aba Secrets do Replit com um token válido.'
                        });
                }
                
                if (response.status >= 400) {
                        return res.status(response.status).json({
                                erro: 'Erro na API do RCO Digital',
                                detalhes: response.data,
                                status: response.status
                        });
                }

                res.json(response.data);

        } catch (erro) {
                console.error('Erro ao consultar API:', erro.message);
                
                if (erro.response) {
                        return res.status(erro.response.status).json({ 
                                erro: 'Erro ao consultar a API do RCO Digital',
                                detalhes: erro.response.data || erro.message,
                                status: erro.response.status
                        });
                }
                
                res.status(500).json({ 
                        erro: 'Erro ao consultar a API do RCO Digital',
                        detalhes: erro.message 
                });
        }
});

app.listen(5000, '0.0.0.0', () => {
        console.log('Servidor Express rodando na porta 5000');
        console.log('Acesse /api/acessos para consultar a API do RCO Digital');
});
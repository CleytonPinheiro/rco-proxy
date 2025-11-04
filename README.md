# Servidor Express - API RCO Digital

Este projeto Express consome a API do portal RCO Digital (Registro de Classe Online) do estado do Paraná.

## 🚀 Como Funciona

O servidor possui dois endpoints:

### 1. Página Inicial
```
GET /
```
Retorna uma mensagem de boas-vindas confirmando que o servidor está funcionando.

### 2. Consultar Acessos (API do RCO)
```
GET /api/acessos
```
Faz uma requisição para a API do RCO Digital e retorna os dados de acessos atualizados.

## 🔐 Configuração do Token

Para usar o endpoint `/api/acessos`, você precisa configurar o token de autorização:

1. **Faça login no portal RCO Digital** e obtenha um novo token
2. Vá até a aba "Secrets" no Replit (ícone de cadeado 🔒)
3. Adicione ou atualize a variável:
   - **Nome**: `AUTHORIZATION_TOKEN`
   - **Valor**: Seu token Bearer (cole apenas o token JWT, sem a palavra "Bearer")
4. Salve a configuração
5. O servidor reiniciará automaticamente

**⚠️ Importante:** Tokens JWT expiram após algumas horas. Se você receber erro de "Token expirado", será necessário obter um novo token no portal RCO Digital e atualizar o secret.

## 📝 Exemplo de Uso

### Testar localmente
```bash
curl http://localhost:5000/api/acessos
```

### Resposta de Sucesso
Retorna um JSON com os dados da API do RCO Digital.

### Resposta de Erro (sem token configurado)
```json
{
  "erro": "Token de autorização não configurado. Configure a variável AUTHORIZATION_TOKEN."
}
```

### Resposta de Erro (problema na API)
```json
{
  "erro": "Erro ao consultar a API do RCO Digital",
  "detalhes": "Mensagem de erro detalhada"
}
```

## 🛠️ Tecnologias Utilizadas

- **Node.js** - Ambiente de execução JavaScript
- **Express** - Framework web minimalista
- **Fetch API** - Para fazer requisições HTTP

## 📦 Dependências

- `express` - Framework web
- `node-fetch` - Cliente HTTP (integrado no Node.js 18+)

## 🎯 Estrutura do Projeto

```
.
├── index.js          # Servidor Express principal
├── package.json      # Dependências do projeto
└── README.md         # Este arquivo
```

## ⚙️ Detalhes Técnicos

O endpoint `/api/acessos` faz uma requisição GET para:
```
https://apigateway-educacao.paas.pr.gov.br/seed/rcdig/estadual/v1/classe/v1/acessos/atualizar
```

Inclui os seguintes headers:
- `Authorization`: Bearer token (configurado via variável de ambiente)
- `consumerId`: RCDIGWEB
- Headers de navegador para compatibilidade

## 🔒 Segurança

- O token de autorização é armazenado como variável de ambiente (não no código)
- Nunca compartilhe seu token publicamente
- O token tem validade limitada e precisa ser renovado periodicamente

## 📞 Suporte

Em caso de dúvidas ou problemas:
- Verifique se o token está configurado corretamente
- Confira os logs do servidor para mensagens de erro
- Certifique-se de que o token não está expirado

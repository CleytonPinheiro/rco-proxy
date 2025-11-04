# Informações do Projeto

## Visão Geral
Servidor Express que consome a API do RCO Digital (Registro de Classe Online) do estado do Paraná.

## Estado Atual
- **Data**: 04/11/2025
- **Status**: Funcional
- **Linguagem**: JavaScript (Node.js com ES Modules)
- **Framework**: Express.js

## Arquitetura do Projeto

### Estrutura de Arquivos
```
.
├── index.js          # Servidor Express principal
├── package.json      # Dependências (express, node-fetch)
├── README.md         # Documentação em português
└── replit.md         # Este arquivo
```

### Endpoints Implementados

1. **GET /** - Página inicial de boas-vindas
2. **GET /api/acessos** - Consome API do RCO Digital
   - URL da API: `https://apigateway-educacao.paas.pr.gov.br/seed/rcdig/estadual/v1/classe/v1/acessos/atualizar`
   - Requer: Token de autorização via variável de ambiente `AUTHORIZATION_TOKEN`
   - Retorna: Dados da API do RCO ou erro em JSON

## Configuração

### Variáveis de Ambiente Necessárias
- `AUTHORIZATION_TOKEN`: Bearer token para autenticação na API do RCO Digital

### Porta
- O servidor roda na porta **5000** (0.0.0.0)

### Workflow
- **Nome**: `servidor-express`
- **Comando**: `node index.js`
- **Tipo**: webview (porta 5000)

## Decisões Técnicas

1. **Segurança**: Token armazenado como variável de ambiente ao invés de hardcoded
2. **Tratamento de Erros**: Try-catch com mensagens de erro detalhadas em português
3. **Headers**: Mantidos todos os headers originais da requisição do navegador para compatibilidade
4. **Idioma**: Toda documentação e mensagens em português brasileiro (conforme solicitado)

## Preferências do Usuário
- Idioma: Português do Brasil
- Comunicação: Explicações claras e simples, sem jargão técnico

## Mudanças Recentes
- **04/11/2025**: Projeto criado com conversão de fetch para endpoint Express
  - Implementado endpoint `/api/acessos` que consome API do RCO Digital
  - Configurado tratamento de erros e validação de token
  - Criada documentação completa em português
  - Resolvido problema de caracteres inválidos em headers HTTP com filtro de sanitização
  - Adicionado tratamento específico para tokens expirados (status 401/403)
  - Removido dependência desnecessária (node-fetch), usando axios para melhor compatibilidade

## Problemas Conhecidos e Soluções

### Token Expirado
- **Sintoma**: API retorna erro 403 "Falha com o token informado"
- **Causa**: Tokens JWT têm validade limitada (campo "exp" no token)
- **Solução**: Obter novo token no portal RCO Digital e atualizar a variável AUTHORIZATION_TOKEN nos Secrets

### Caracteres Inválidos no Token
- **Problema resolvido**: O código agora filtra automaticamente caracteres inválidos do token
- **Implementação**: Regex `replace(/[^a-zA-Z0-9._-]/g, '')` mantém apenas caracteres válidos em JWT

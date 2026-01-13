# RCO Digital Proxy

## Visão Geral
Servidor Express que consome a API do RCO Digital (Registro de Classe Online) do estado do Paraná com autenticação automática.

## Estado Atual
- **Data**: 13/01/2026
- **Status**: Funcional com login automático
- **Linguagem**: JavaScript (Node.js com ES Modules)
- **Framework**: Express.js

## Arquitetura do Projeto

### Estrutura de Pastas
```
.
├── backend/
│   ├── index.js          # Servidor Express (API + arquivos estáticos)
│   ├── package.json      # Dependências do backend
│   └── node_modules/
├── frontend/
│   ├── index.html        # Página de login
│   ├── style.css         # Estilos do login
│   ├── app.js            # Lógica do login
│   ├── dashboard.html    # Painel com dados do usuário
│   ├── dashboard.css     # Estilos do painel
│   └── dashboard.js      # Lógica do painel
├── replit.md             # Este arquivo
└── README.md             # Documentação
```

### Endpoints da API

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/` | Página de configuração (frontend) |
| GET | `/api/status` | Retorna status das credenciais e token |
| POST | `/api/configurar` | Salva CPF/senha e testa conexão |
| GET | `/api/acessos` | Retorna dados do RCO Digital |

## Funcionalidades

### Login Automático
O sistema obtém automaticamente o token JWT da Central de Segurança do Paraná:
1. Acessa a página de login e obtém cookie `CS-AUTH`
2. Faz POST com CPF/senha para obter token JWT
3. Armazena token em memória e renova automaticamente antes de expirar
4. Em caso de erro 403, tenta renovar o token automaticamente

### Interface Web
- **Página de Login** (`/`): Formulário para inserir CPF e senha
- **Dashboard** (`/dashboard.html`): Painel com dados do usuário
  - Cards de Turmas
  - Cards de Disciplinas
  - Cards de Livros de Classe
  - Dados completos em JSON
- Redirecionamento automático após login bem-sucedido

## Configuração

### Workflow
- **Nome**: `backend`
- **Comando**: `cd backend && node index.js`
- **Porta**: 5000 (webview)

### Variáveis de Ambiente (opcionais)
- `RCO_CPF`: CPF para login (alternativa ao formulário)
- `RCO_SENHA`: Senha para login (alternativa ao formulário)

## Decisões Técnicas

1. **Frontend integrado ao backend**: O Express serve os arquivos estáticos do frontend, evitando problemas de CORS
2. **Token em memória**: Mais seguro que salvar em arquivo, renova automaticamente
3. **Retry automático**: Se receber 403, tenta renovar token antes de retornar erro

## Mudanças Recentes

- **13/01/2026**: Dashboard com dados do usuário
  - Criada página dashboard.html com cards de turmas, disciplinas e livros
  - Redirecionamento automático após login bem-sucedido
  - Extração inteligente de dados do JSON da API

- **13/01/2026**: Separação em frontend e backend
  - Criada interface web para configurar credenciais
  - Implementado login automático via Central de Segurança PR
  - Token renovado automaticamente antes de expirar

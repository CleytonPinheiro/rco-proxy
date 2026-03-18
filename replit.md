# EduGest

## Visão Geral
Sistema de gestão escolar para professores do Paraná. Consome a API do RCO Digital (Registro de Classe Online) com autenticação automática. Inclui módulos de turmas, frequências, grupos, comportamento, materiais, empréstimos, presença diária e painel da cozinha.

## Estado Atual
- **Data**: 16/01/2026
- **Status**: Funcional com login via navegador automatizado + módulo de empréstimos + Supabase
- **Linguagem**: JavaScript (Node.js com ES Modules)
- **Framework**: Express.js
- **Banco de Dados**: Supabase (PostgreSQL)
- **Automação**: Puppeteer (Chromium) para autenticação

## Arquitetura do Projeto

### Estrutura de Pastas
```
.
├── backend/
│   ├── index.js          # Servidor Express (API + arquivos estáticos)
│   ├── auth-puppeteer.js # Módulo de autenticação via navegador
│   ├── supabase.js       # Cliente Supabase
│   ├── package.json      # Dependências do backend
│   └── node_modules/
├── frontend/
│   ├── index.html        # Página de login
│   ├── style.css         # Estilos do login
│   ├── app.js            # Lógica do login
│   ├── dashboard.html    # Painel com turmas e alunos
│   ├── dashboard.css     # Estilos do painel
│   ├── dashboard.js      # Lógica do painel
│   ├── materiais.html    # Gerenciamento de materiais
│   ├── materiais.css     # Estilos de materiais
│   ├── materiais.js      # Lógica de materiais
│   ├── emprestimos.html  # Registro de empréstimos
│   ├── emprestimos.css   # Estilos de empréstimos
│   └── emprestimos.js    # Lógica de empréstimos
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

### Login Automático (Puppeteer)
O sistema utiliza navegador automatizado (Chromium via Puppeteer) para autenticação:
1. Abre navegador headless e navega até a página de login da Central de Segurança
2. Preenche formulário com CPF e senha automaticamente
3. Aguarda redirecionamento e captura token JWT da URL
4. Armazena token em memória e renova automaticamente antes de expirar
5. Em caso de erro 403, tenta renovar o token automaticamente

**Nota**: Esta abordagem foi necessária porque a Central de Segurança PR gera cookies dinamicamente via JavaScript, impossibilitando autenticação via requisições HTTP simples.

### Interface Web
- **Página de Login** (`/`): Formulário para inserir CPF e senha
- **Dashboard** (`/dashboard.html`): Painel com dados do usuário
  - Cards de Turmas (clicáveis para ver alunos)
  - Cards de Disciplinas
  - Cards de Livros de Classe
  - Modal com lista de alunos e código de barras
- **Materiais** (`/materiais.html`): Gerenciamento de materiais
  - Cadastro de materiais (tablets, notebooks, calculadoras, etc.)
  - Filtros por tipo e status
  - Código de barras para cada material
- **Empréstimos** (`/emprestimos.html`): Controle de empréstimos
  - Registro de empréstimo por aluno/material
  - Seleção de aulas/período de uso
  - Registro de devolução
  - Histórico de empréstimos
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

- **16/01/2026**: Autenticação via Navegador Automatizado
  - Substituído método HTTP direto por Puppeteer com Chromium
  - Resolve problema "Nenhum cookie retornado" da Central de Segurança PR
  - Detecta erros de credenciais inválidas e retorna mensagens claras
  - Validação do caminho do Chromium com suporte a PUPPETEER_EXECUTABLE_PATH

- **14/01/2026**: Módulo de Empréstimos de Materiais
  - Cadastro e gerenciamento de materiais do colégio
  - Sistema de empréstimo com seleção de aulas
  - Registro de devolução com verificação de estado
  - Histórico completo de empréstimos
  - Código de barras para materiais e alunos
  - Navegação entre páginas do sistema

- **13/01/2026**: Dashboard com dados do usuário
  - Criada página dashboard.html com cards de turmas, disciplinas e livros
  - Redirecionamento automático após login bem-sucedido
  - Extração inteligente de dados do JSON da API

- **13/01/2026**: Separação em frontend e backend
  - Criada interface web para configurar credenciais
  - Implementado login automático via Central de Segurança PR
  - Token renovado automaticamente antes de expirar

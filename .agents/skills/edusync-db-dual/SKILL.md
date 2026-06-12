---
name: edusync-db-dual
description: Arquitetura de banco de dados dual do EduSync — Supabase (PostgreSQL remoto) para dados RCO e local PostgreSQL para dados EduSync. Use ao criar tabelas, queries, migrações ou qualquer operação de banco de dados para saber onde cada dado vive.
---

# EduSync — Banco de Dados Dual

## Regra geral

| Dado | Banco | Cliente |
|------|-------|---------|
| Dados espelhados do RCO (turmas, alunos, disciplinas, frequências, notas) | **Supabase** | `supabase` / `supabaseAdmin` |
| Dados próprios do EduSync (usuários, sessões, audit log, configurações, notificações, reputação, provas, passeios, tokens Google) | **PostgreSQL local** | `localPool` (node-postgres) |

## Clientes disponíveis

```js
// Supabase — dados RCO
import { supabase, supabaseAdmin } from '../config/supabase.js';
// supabase     → usa ANON_KEY, respeita RLS
// supabaseAdmin → usa SERVICE_ROLE_KEY, bypassa RLS (operações administrativas)

// PostgreSQL local — dados EduSync
import { localPool } from '../config/db.js';
const { rows } = await localPool.query('SELECT * FROM tabela WHERE id = $1', [id]);
```

## Tabelas Supabase (RCO)

- `estabelecimentos`, `turmas`, `alunos`, `disciplinas`
- `frequencias`, `notas`, `aulas`
- Sincronizadas via `backend/src/services/sync.service.js`

## Tabelas PostgreSQL local (EduSync)

- `edusync_usuarios` — usuários, perfis, RBAC
- `edusync_audit_log` — trilha de auditoria
- `edusync_config` — configurações globais (chave/valor)
- `edusync_perfis_overrides` — permissões customizadas por perfil
- `classroom_tokens` — tokens OAuth Google por usuário
- `notificacoes_aluno`, `notificacoes_professor`
- `aluno_reputacao`, `aluno_reputacao_log`
- `provas`, `questoes`, `respostas_aluno`, `correcoes`
- `passeios`, `evento_inscricoes`
- Todas as tabelas de módulos específicos (crachas, comportamento, etc.)

## Criando nova tabela

Sempre no **PostgreSQL local** (salvo se for espelho de dado RCO):

```js
// Em backend/src/config/db.js ou em um arquivo de migration
await localPool.query(`
  CREATE TABLE IF NOT EXISTS minha_tabela (
    id SERIAL PRIMARY KEY,
    criado_em TIMESTAMPTZ DEFAULT NOW()
  )
`);
```

Adicionar ao `initializeDatabase()` em `backend/src/config/db.js` para criar na inicialização.

## Migrações em produção

Para aplicar schema novo no banco de produção, use a `database` skill com `environment: "production"` para verificar estado atual, depois o agente executa as queries no banco de prod.

## Purga automática

O `purgeJob.js` limpa periodicamente:
- `edusync_audit_log` — padrão 365 dias
- `aluno_reputacao_log` — padrão 365 dias
- `notificacoes_aluno` / `notificacoes_professor` — lidas 90d, não-lidas 365d

Configurável via env vars `PURGA_*`. Novas tabelas com dados temporários devem ser adicionadas ao purgeJob.

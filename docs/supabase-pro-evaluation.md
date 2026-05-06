# Avaliação: Supabase Free vs Pro

**Data de coleta:** 06 de maio de 2026
**Fonte dos dados:** Consulta direta à API Supabase (service role key) e `rco_sync_log`
**Decisão necessária:** Manter Free tier, contratar Pro agora, ou definir gatilho de migração?

---

## 1. Limites do Free Tier (referência)

| Recurso        | Limite Free | O que acontece ao exceder |
|----------------|-------------|---------------------------|
| Banco de dados | 500 MB      | Projeto pausado automaticamente |
| Egress/mês     | 5 GB        | Projeto pausado automaticamente |
| Pro ($25/mês)  | 8 GB banco  | +$0,125/GB adicional de egress   |

> **Egress** = todo dado transferido **de dentro para fora** do Supabase (respostas da API REST). Escritas (upserts) enviadas **para** o Supabase não contam como egress.

---

## 2. Métricas Reais — Coletadas em 06/05/2026

### 2.1 Tamanho atual do banco

Medido via `select('*')` com contagem exata em cada tabela:

| Tabela                  | Linhas (real) | Tamanho JSON (real) | Bytes/linha |
|-------------------------|---------------|---------------------|-------------|
| `rco_estabelecimentos`  | 2             | 320 B               | 160 B       |
| `rco_turmas`            | 11            | 2.277 B             | 207 B       |
| `rco_disciplinas`       | 10            | 1.696 B             | 170 B       |
| `rco_classes`           | 17            | 2.819 B             | 166 B       |
| `alunos`                | 405           | 96.238 B (94 KB)    | 238 B       |
| `materiais`             | 17            | 4.305 B             | 253 B       |
| `emprestimos`           | 0             | 2 B                 | —           |
| `rco_observacoes`       | 93            | 39.752 B (39 KB)    | 427 B       |
| `rco_sync_log`          | 1.221         | ~197 KB estimado    | 161 B       |
| **Total atual**         |               | **~336 KB = 0,33 MB** |           |

**Limite de banco atingido em:** 0,07% dos 500 MB disponíveis.

Mesmo multiplicando os dados por 100× (crescimento extremo), o banco chegaria a ~33 MB — ainda bem abaixo do limite. **O banco de dados não é uma ameaça real.**

### 2.2 View `rco_dados_completos`

A view consolidada (join de 4 tabelas) retorna atualmente:
- **17 linhas | 5.792 bytes** por consulta completa.

Na fase de desenvolvimento, há apenas 1 escola com 3 turmas e 8 disciplinas sincronizadas.

### 2.3 Padrão real de sync (baseado em `rco_sync_log`)

| Período          | Detalhe                                      |
|------------------|----------------------------------------------|
| Primeiro sync    | 18/03/2026                                   |
| Último sync      | 06/05/2026 (hoje)                            |
| Dias com atividade | 14 de 49 dias (fase de desenvolvimento)   |
| Syncs/dia médio  | 35,7 (dias ativos — inclui testes intensivos)|
| Máximo em 1 dia  | 175 (14/04, provável dia de testes em lote)  |
| Taxa de sucesso  | 100%                                         |
| Dados por sync   | 1 estab · 3 turmas · 8 disc · 8 classes      |

Em produção com TTL de 4h, cada professor dispara no máximo **2–3 syncs/dia útil**.

### 2.4 Egress por sync (escritas para o Supabase)

O `SyncService` não usa `.select()` após os upserts — a resposta da API retorna apenas `{ data: null, error: null }`. Por sync completo:

| Operação                           | Egress real (resposta) |
|------------------------------------|------------------------|
| 4 upserts (estab/turmas/disc/classes) | ~100 B             |
| N upserts de alunos (1 por turma)  | ~200 B                 |
| 1 insert em rco_sync_log           | ~25 B                  |
| **Total por sync**                 | **< 400 B**            |

**Conclusão:** Writes geram egress desprezível — menos de 0,4 KB por sync completo.

---

## 3. Egress por Leitura (Fonte Principal)

O egress real vem das leituras que professores fazem durante o uso do app:

| Consulta frequente                     | Egress por chamada | Frequência estimada/dia |
|----------------------------------------|--------------------|-------------------------|
| Lista completa de alunos (`alunos.*`)  | **94 KB**          | 3–5×                    |
| rco_dados_completos (view)             | 5,6 KB             | 2–3×                    |
| rco_observacoes (todas)                | 39 KB              | 1–2×                    |
| materiais, sync_log e demais           | ~15 KB total       | variável                |

**Egress estimado por professor por dia útil:** ~450–550 KB (~0,5 MB)
**Egress estimado por professor por mês** (22 dias úteis): **~11 MB**

> Nota: a maioria dos módulos (grupos, comportamento, crachas, circulação, presença) usa o **PostgreSQL local**, não o Supabase. Apenas as tabelas acima geram egress externo.

---

## 4. Projeções Mensais

### Cenário A — Sem cache de sync (sync a cada login)

O custo adicional de sync é ínfimo (<400 B/sync) — o que muda é apenas o volume de leituras provocadas por novos usuários. O egress escala quase inteiramente com o número de professores ativos.

| Professores ativos | Egress estimado/mês | % do limite (5 GB) |
|--------------------|---------------------|--------------------|
| 10                 | ~110 MB             | 2,1%               |
| 30                 | ~330 MB             | 6,4%               |
| 100                | ~1,1 GB             | 22%                |
| 250                | ~2,75 GB            | 55%                |
| **~465**           | **~5 GB**           | **100% — limite**  |

### Cenário B — Com cache TTL 4h (já implementado)

O cache reduz syncs em ~75%, mas não reduz leituras de página. Como writes geram <400 B de egress, **o TTL de sync não tem impacto mensurável no egress**.

| Professores ativos | Egress estimado/mês | % do limite (5 GB) |
|--------------------|---------------------|--------------------|
| 10                 | ~108 MB             | 2,2%               |
| 30                 | ~325 MB             | 6,3%               |
| 100                | ~1,1 GB             | 21%                |
| **~465**           | **~5 GB**           | **100% — limite**  |

> O cache de sync ajuda principalmente em custos de CPU e carga no RCO Digital — não resolve o egress do Supabase.

---

## 5. Recomendação

### Situação atual
**Manter o Free tier.** Com 0,33 MB de banco e uso concentrado em desenvolvimento, o egress atual é estimado em poucos MB por mês — menos de 1% do limite. Contratar Pro agora seria pagar $25/mês sem necessidade.

### Gatilho de migração recomendado
**Contratar Pro quando o egress mensal superar 3,5 GB** — isso ocorre com aproximadamente **320 professores ativos** simultaneamente.

Como monitorar: **Supabase Dashboard → Settings → Usage → Egress** (atualizado diariamente). Verificar mensalmente ao abrir o painel.

### Ação contingencial
Se o egress se aproximar de 4 GB/mês antes de contratar o Pro, implementar o cache LRU no Express (tarefa #38) para dados estáticos — isso pode reduzir leituras repetidas de `alunos` em 60–70%, expandindo o limite efetivo para ~800 professores.

---

## 6. Ações de Mitigação (ordem de impacto)

| # | Ação                                                                      | Impacto estimado | Esforço |
|---|---------------------------------------------------------------------------|------------------|---------|
| 1 | **Cache LRU Express** para `alunos`, `rco_observacoes` (TTL 5–15 min)   | 30–50% redução   | Médio   |
| 2 | **Selecionar colunas específicas** (remover `select('*')` desnecessários) | 20–40% redução   | Médio   |
| 3 | **Purge de `rco_sync_log`** — a tabela já tem 1.221 linhas e não está coberta pelo job de purge existente | DB hygiene | Baixo |
| 4 | **Mover `rco_observacoes` para PostgreSQL local** — dados de escrita frequente sem necessidade de sync externo | 7–10% redução | Alto |
| 5 | **Paginação nos módulos pesados** — `circulacao.routes.js` tem 22 queries; limitar resultados por request | 5–15% redução | Médio |

---

## 7. Resumo Executivo

| Pergunta                              | Resposta (baseada em dados reais)                                          |
|---------------------------------------|----------------------------------------------------------------------------|
| O banco vai estourar?                 | Não — 0,33 MB atual (limite 500 MB). Risco nulo por anos.                 |
| O egress vai estourar logo?           | Não — estimado < 100 MB/mês na fase atual. Margem de 50×.                 |
| Quantos professores suporta no Free?  | ~465 professores ativos simultâneos antes de atingir 5 GB/mês             |
| Quando contratar o Pro?               | Ao atingir ~320 professores ativos ou egress > 3,5 GB/mês                 |
| Quanto custa o Pro?                   | $25/mês fixo (8 GB banco + egress proporcional acima de 5 GB)             |
| Vale otimizar antes?                  | Sim — cache LRU pode dobrar o limite efetivo sem custo                    |
| `rco_sync_log` precisa de purge?      | Sim — não está coberta pelo job existente. Cresce ~35 linhas/dia ativo.   |

---

## 8. Registro de Decisão

| Campo            | Valor                                                         |
|------------------|---------------------------------------------------------------|
| Data da decisão  | 06/05/2026                                                    |
| Decisão tomada   | ✅ **Manter Free tier**                                       |
| Gatilho definido | Migrar para Pro quando egress > 3,5 GB/mês (~320 professores)|
| Aprovado por     | Responsável pelo projeto (EduSync)                            |
| Observações      | Banco atual: 0,33 MB. Egress estimado em < 100 MB/mês. Nenhuma ação financeira necessária agora. Revisar mensalmente em Supabase → Settings → Usage. |

---

*Dados coletados via API Supabase em 06/05/2026 — 1 escola ativa (fase de desenvolvimento).
Projeções de produção baseadas em médias observadas de leitura e na estrutura real das tabelas.
Consultar Settings → Usage no Supabase Dashboard mensalmente para acompanhar o egress real.*

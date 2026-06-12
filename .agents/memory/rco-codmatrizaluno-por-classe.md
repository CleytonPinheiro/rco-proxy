---
name: RCO codMatrizAluno por classe
description: codMatrizAluno no RCO é específico por matrícula/classe, não por aluno global
---

## Regra

O campo `codMatrizAluno` no RCO Digital é **específico por matrícula em cada classe**.
Um mesmo aluno em 3 disciplinas da mesma turma tem 3 `codMatrizAluno` diferentes.

**Why:** O RCO cria uma matrícula (inscrição) separada por classe, não por aluno.

**How to apply:**
- O sync armazena apenas o codMatrizAluno da primeira classe por turma (via `turmaParaClasse`).
- Para buscar frequência nas outras classes, não usar o codMatrizAluno armazenado —
  chamar `avaliacaoAlunos` para a classe alvo e fazer match por `nome` do aluno.
- Implementado em `ficha-aluno.routes.js`: fallback via nome quando raw.length>0 mas aluno não encontrado.

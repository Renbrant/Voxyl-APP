# Prompt para Codex - Issue #12: User Search and Public Profile Routes

Cole este prompt no Codex para ele trabalhar nesta issue.

---

## PROMPT PARA CODEX

```
Você está trabalhando na Issue #12: "User search and public profile routes are missing after migration"

ARQUIVO DE REFERÊNCIA OBRIGATÓRIO: ISSUE_12_IMPLEMENTATION_PLAN.md

PROTOCOLO DE REVISÃO (OBRIGATÓRIO):
1. ANALYSIS ONLY - SEM ALTERAÇÕES DE CÓDIGO
2. Criar IMPLEMENTATION_REVIEW.md com análise detalhada
3. AGUARDAR APROVAÇÃO EXPLÍCITA
4. SÓ DEPOIS: criar diffs e snippets
5. AGUARDAR APROVAÇÃO NOVAMENTE
6. SÓ DEPOIS: alterações efetivas

TAREFA ATUAL: PHASE 1 - ANALYSIS ONLY

### Phase 1: Análise Completa (SEM MODIFICAR CÓDIGO)

1. Leia completamente: ISSUE_12_IMPLEMENTATION_PLAN.md
2. Abra e analise: workers/api/src/index.ts
3. Identifique e documente os padrões existentes:

   a) ROUTE DETECTION PATTERN:
      - Procure por funções tipo: isTopPodcastsRoute(), isPodcastSearchRoute()
      - Anote a estrutura comum
      - Documente linhas aproximadas
   
   b) HANDLER DISPATCH PATTERN:
      - Procure por: if (isTopPodcastsRoute(pathname)) { ... }
      - Identifique onde rotas são checadas
      - Note o padrão de dispatch
   
   c) HANDLER PATTERN:
      - Procure por funções tipo: async function handleTopPodcasts()
      - Anote como recebem (request, env)
      - Como extraem body: const payload = await request.json()
      - Como retornam resposta
   
   d) RESPONSE ENVELOPE:
      - Procure por: withDataEnvelope()
      - Procure por: { data: { ... } }
      - Documente o padrão
   
   e) D1 DATABASE PATTERN:
      - Procure por: env.DB.prepare()
      - Procure por: .bind(?1, ?2)
      - Documente parametrização
   
   f) ERROR HANDLING:
      - Como erros são capturados
      - Como respostas de erro são formadas
      - Status codes usados

4. Crie IMPLEMENTATION_REVIEW.md com:

   ## Implementation Review for Issue #12 - Analysis Phase
   
   ### 1. Existing Route Detection Pattern in index.ts
   [Copie 2-3 exemplos reais de isXxxRoute()]
   
   ### 2. Existing Handler Pattern in index.ts
   [Copie 2-3 exemplos reais de handleXxx()]
   
   ### 3. Response Envelope Pattern
   [Mostre como { data: {...} } é usado]
   
   ### 4. D1 Query Pattern
   [Mostre exemplo real de env.DB.prepare()]
   
   ### 5. Error Handling Pattern
   [Mostre como erros são tratados]
   
   ### 6. Proposed Implementation for searchUsers
   
   Based on existing patterns, here's what searchUsers would look like:
   
   Route Detection:
   [código snippet - NÃO EFETIVO]
   
   Handler:
   [código snippet - NÃO EFETIVO]
   
   D1 Query:
   [SQL snippet]
   
   Response:
   [JSON example]
   
   ### 7. Proposed Implementation for getPublicUserProfile
   [Mesmo formato acima]
   
   ### 8. Proposed Implementation for getUserPlaylists
   [Mesmo formato acima]
   
   ### 9. Privacy Rules Implementation
   Como garantir:
   - Hidden profiles não retornam em search
   - Private playlists não são expostas
   - Friends-only validação
   
   ### 10. Blockers or Concerns
   [Qualquer questão encontrada]

5. COMMIT:
   git add IMPLEMENTATION_REVIEW.md
   git commit -m "docs: Phase 1 analysis for issue #12 - proposed implementation strategy
   
   - Document existing route detection patterns
   - Document existing handler patterns
   - Document D1 query patterns
   - Propose searchUsers, getPublicUserProfile, getUserPlaylists handlers
   - Show privacy rule implementation approach
   
   AWAITING APPROVAL TO PROCEED TO PHASE 2"

6. AGUARDE APROVAÇÃO EXPLÍCITA:
   "Aprovado para Phase 2: Criar diffs detalhados"

CONSTRAINTS:
- ❌ Não modifique workers/api/src/index.ts ainda
- ❌ Não faça commits de código, apenas de documentação
- ❌ Não use Base44 packages
- ✅ Mostre snippets como exemplos
- ✅ Faça perguntas se tiver dúvidas
- ✅ Documente assunções

OUTPUT ESPERADO:
- IMPLEMENTATION_REVIEW.md criado
- Git commit feito
- Pronto para aprovação de Phase 2

PRÓXIMO PASSO APÓS APROVAÇÃO:
Aguardar comando: "Codex, Phase 2 aprovado - crie IMPLEMENTATION_DIFFS.md"
```

---

## Como Usar Este Prompt

1. Copie o texto acima (entre os ``` ```)
2. Abra o Codex/Claude/seu agente
3. Cole o prompt na conversa
4. Deixe o agente trabalhar na Phase 1
5. Revise o IMPLEMENTATION_REVIEW.md que será gerado
6. Aprove ou peça mudanças
7. Depois de aprovado, envie: "Phase 2 aprovado - crie IMPLEMENTATION_DIFFS.md"

---

## Comandos Subsequentes para Enviar Ao Codex

### Após Phase 1 Aprovada:
```
Phase 2 aprovado. Crie IMPLEMENTATION_DIFFS.md com:
- Diffs exatos para workers/api/src/index.ts
- Linhas exatas onde inserir código
- Código completo de cada função
- Sem fazer commits ainda
```

### Após Phase 2 Aprovada:
```
Phase 3 aprovado. Faça os commits e alterações:
- Modifique workers/api/src/index.ts
- Faça commits atomizados
- Um commit por função se possível
- Inclua testes de curl
```

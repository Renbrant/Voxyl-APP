# Issue #42: Fix Episode Progress Display During Playback Transitions

**Branch:** `fix/issue-42-progress-display`  
**Status:** Em desenvolvimento  
**Assignee:** Codex (para análise e correções)  
**Revisor:** GitHub Copilot (verificação pós-correção)

---

## 🎯 Objetivo

Corrigir o problema onde a **barra de progresso do episódio não é exibida corretamente quando o player muda de um episódio para outro** durante a reprodução.

## 📋 Contexto

Atualmente, durante transições entre episódios:
- A barra de progresso pode não refletir a posição correta do áudio
- Eventos de áudio (timeupdate, durationchange, playing, ended) podem ser processados fora de ordem
- O cache de progresso pode não ser sincronizado adequadamente com o estado visual do player

## 🔧 Arquivos Envolvidos

### Core Files (já implementados em cfe70075)
- `src/lib/PlayerContext.jsx` - Lógica principal do player (~250 linhas)
- `src/lib/webPlaybackTransition.js` - Coordenação de transições
- `src/lib/episodeProgressCache.js` - Cache de progresso

### Componentes que usam o Progress
- `src/components/player/AudioPlayer.jsx` - Renderização da barra
- `src/pages/PlaylistDetail.jsx` - Exibição de progresso em listas
- `src/components/player/ProgressBar.jsx` - Componente da barra (se existir)

### Testes
- `tests/episode-progress.test.mjs` - Suite de testes (732+ testes)

---

## ✅ Checklist de Verificação

### Antes de fazer alterações:
- [ ] Branch `fix/issue-42-progress-display` está criada e ativa
- [ ] Você leu os arquivos principais acima
- [ ] Você entendeu a arquitetura de transição de episódios

### Durante as correções:
- [ ] Todos os commits têm mensagens descritivas em português/inglês
- [ ] Código segue o padrão do projeto (indentação, nomes, estrutura)
- [ ] Novos testes foram adicionados se necessário
- [ ] Documentação foi atualizada (comentários no código)

### Após as correções:
- [ ] `npm test` passa sem erros
- [ ] `npm run lint` sem warnings críticos
- [ ] Commit foi feito com `git commit` (NÃO FAZER PUSH/MERGE)

---

## 🚀 Instruções para Codex

### Leitura Obrigatória
1. Estude `src/lib/webPlaybackTransition.js` para entender a coordenação de transições
2. Revise `src/lib/episodeProgressCache.js` para o mecanismo de cache
3. Analise `src/lib/PlayerContext.jsx` linhas chave de gerenciamento de estado
4. Veja `tests/episode-progress.test.mjs` para casos de teste

### Tarefas a Executar
1. **Análise**: Identifique os pontos críticos onde a barra de progresso pode não atualizar
2. **Verificação**: Confirme que eventos de áudio respeitam a ordem de transição
3. **Testes**: Rode `npm test` e certifique-se de que todos passam
4. **Validação**: Verifique se há casos de uso não cobertos pelos testes

### Possíveis Áreas de Melhoria
- Sincronização de duração do episódio antes de iniciar playback
- Tratamento de transições rápidas (skip múltiplo)
- Consistência entre Web e Native (Android)
- Performance em dispositivos com conexão lenta

### ⚠️ REGRAS IMPORTANTES

**NÃO FAÇA:**
- ❌ `git push` ou merge para `main`
- ❌ Alterações em produção ou environment files
- ❌ Mudar versão do app em `package.json` sem avisar
- ❌ Deploy via `wrangler publish`

**FAÇA:**
- ✅ Commit local com mensagem clara: `git commit -m "fix: descrição da correção (#42)"`
- ✅ Documente as mudanças em comentários de código
- ✅ Rode testes localmente antes de finalizar
- ✅ Criie um arquivo CHANGES.md com resumo das alterações

---

## 📝 Exemplo de Estrutura de Commit

```bash
# Commit 1: Análise e documentação
git commit -m "docs: analysis of episode progress display issue (#42)"

# Commit 2: Correção principal
git commit -m "fix: ensure progress bar updates correctly during playback transitions (#42)"

# Commit 3: Testes
git commit -m "test: add coverage for edge cases in episode transitions (#42)"
```

---

## 🔍 Validação Pós-Correção

Após completar as correções, o revisor (GitHub Copilot) irá:
1. Revisar todos os commits
2. Executar testes completos
3. Validar cobertura de testes
4. Checar performance
5. Criar PR para revisão antes de merge

---

## 📞 Próximas Etapas

1. ✅ Branch criada: `fix/issue-42-progress-display`
2. ⏳ Esperando Codex executar as correções
3. ⏳ GitHub Copilot fará verificação
4. ⏳ PR para `main` será criada para revisão final

---

**Última atualização:** 2026-07-20  
**Criado por:** GitHub Copilot  
**Status:** Aguardando correções do Codex

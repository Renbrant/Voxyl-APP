# Instruções e Regras de Desenvolvimento - Voxyl

## Regra de Versionamento Obrigatório (Beta 0.x.y)

1. **Sempre que fizer qualquer alteração no aplicativo**, atualize também a versão do projeto.
2. **Formato Beta**: Como o aplicativo ainda está em fase beta, mantenha **sempre** o prefixo `0.` (formato `0.x.y`). Nunca altere para `1.0.0` até a saída oficial do beta.
3. **Escala de versão**:
   - **Alterações comuns / correções / pequenos ajustes / refatorações**: Incremente o número de patch (`0.x.Y`, por exemplo: `0.4.6` -> `0.4.7`). O `versionCode` do Android deve acompanhar o incremento (ex: `406` -> `407`).
   - **Alterações grandes / novos módulos / features estruturais**: Incremente o número intermediário/maior (`0.X.0`, por exemplo: `0.4.7` -> `0.5.0`, com `versionCode` `500`).
4. **Arquivos que devem ser mantidos sincronizados em cada bump de versão**:
   - `package.json` (`version`)
   - `package-lock.json` (`version` na raiz e `packages[""].version`)
   - `android/app/build.gradle` (`versionCode` e `versionName`)
   - `workers/api/src/index.ts` (`version` em `healthResponse` e user agents)
   - `README.md` (tabela de releases e seção `Current Version`)
   - `docs/README.md` (referências de release ativa)
   - `ARCHITECTURE.md` (seção `Current Release Baseline`)
   - `docs/release-process.md` (exemplos e release de referência)
   - `CHANGELOG.md` (nova seção no topo com os detalhes da mudança)
   - `tests/version-consistency.test.mjs` (constantes `EXPECTED_VERSION`, `EXPECTED_ANDROID_VERSION_CODE` e assertions)
5. **Validação**:
   - Sempre execute `npm test` para certificar que `version-consistency.test.mjs` e toda a suíte de testes passem sem regressões.

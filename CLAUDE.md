# hypermemory

- `bun run gate` - lint (Biome), `tsc`, tamanho e `bun test --coverage`; teste pesado passa por `heavy-run`.
- Cobertura mínima de 80% de linhas e funções por arquivo (`bunfig.toml`): código que só roda em subprocesso não conta, então exporte a lógica e teste em processo.
- `claude plugin test mod` e `claude plugin validate mod` - testes e validação do mod (`mod/hooks/*.test.ts` não rodam no `bun test`).
- O `cc-plugin-sec-default` das organizações pula os hooks de mod `prompt.compose` e `classic.*`: contexto para o modelo só chega por hook de comando no `mod/hooks/hooks.json` (medido em 2026-11-20).
- `mod/hooks/inject-context.mjs` é JS puro rodado pelo `node`; os tipos ficam em `inject-context.d.mts`, e `projectSlug` e a marca de entregue estão duplicados em `handoff-rules.ts`, com teste que exige que os dois lados batam.
- `claude plugin update` só puxa código novo se a versão em `mod/.claude-plugin/plugin.json` mudar.
- Teste real do mod: `claude -p ... --model haiku --plugin-dir <repo>/mod --debug-file <log>` num diretório em `/tmp`; o log mostra hook pulado e chamada ao Haiku.
- PR: o repo não tem skill `ship`; abra com `gh pr create`, sem linha de atribuição, e faça squash merge. O Codex revisa todo PR.
- `.npmrc` do repo fixa o registro público: depois de mexer em dependência, `grep -c codeartifact bun.lock` tem de dar 0.

## O que muda e por quê

## Como foi verificado

- [ ] `bun run gate` passa
- [ ] `claude plugin test mod` passa (se mexeu em `mod/`)
- [ ] Mudança de comportamento tem teste que falha sem ela; regra nova com limite ganha mutante em `scripts/mutants.ts`
- [ ] `CHANGELOG.md` atualizado em `[Unreleased]` (se mexeu em `src/`, `mod/` ou `bin/`)
- [ ] Mudou o mod e quer que as sessões recebam: versão em `mod/.claude-plugin/plugin.json` sobe no PR de release

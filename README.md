# Hypermemory

Padrão de memória de agente do Jaime, construído em cima da memória nativa do Claude Code (auto memory). O formato continua o que o Claude Code já é treinado para escrever; por cima entram o diário só de acréscimo do [OptMem](https://github.com/VictorTaelin/OptMem) e os tipos, o "substituir em vez de apagar" e o handoff do [ai-memory](https://github.com/akitaonrails/ai-memory).

Substitui os dois: quem usa OptMem ou ai-memory migra a memória existente com `bun run migrate` (seção "Migrar").

## O que tem aqui

```
PADRAO.md          as regras: arquivos, frontmatter, índice, diário, ciclo
BLOCO-AGENTE.md    o bloco para colar no CLAUDE.md do projeto
modelos/           arquivo de memória, handoff e sub-índice de domínio
memory/            o esqueleto para copiar (plano, como o nativo)
  MEMORY.md        índice que o Claude Code carrega no começo (orçamento: 150 linhas)
  LOG.md           diário: uma linha por memória, nunca editado
```

## Como usar num projeto

1. Copie `memory/` para a raiz do projeto.
2. Ligue a pasta nativa a ela: `ln -s <projeto>/memory ~/.claude/projects/<projeto>/memory` (a pasta nativa precisa não existir ou estar vazia).
3. Cole o bloco de `BLOCO-AGENTE.md` no `CLAUDE.md` do projeto.

## Validar

Instale as dependências de desenvolvimento, rode os testes e valide a pasta de memória:

```sh
bun install
bun test
bun run src/cli.ts <pasta-da-memória>
```

Teste de ponta a ponta com o Claude Code de verdade (gasta cota; roda cada cenário 3 vezes e passa com 2):

```sh
e2e/rodar.sh                 # todos: preferencia, evento, substituicao, handoff
HM_RUNS=1 HM_PASS=1 e2e/rodar.sh evento
```

## Qualidade

Execute `bun run gate` para verificar a formatação e o lint com Biome, os tipos com TypeScript, o limite de 300 linhas por arquivo em `src/` e `test/` e os testes com cobertura mínima de 80% de linhas e funções por arquivo instrumentado.

## Migrar

```sh
bun run migrate optmem <destino>
bun run migrate ai-memory --list
bun run migrate ai-memory --project <nome> <destino>
```

Sem `--apply`, o comando só mostra o plano e não grava nada. Use `--from <pasta>` para indicar outra origem.

## O que ficou de fora

- Do OptMem: o script `memo`, o registro de largura fixa e a árvore binária de resumos. O papel dos resumos passa para os arquivos e o índice.
- Do ai-memory: servidor, banco, captura por hooks, busca por ranking, envelhecimento automático e pastas por tipo (a memória nativa é plana, então o tipo fica em `metadata.kind`).

# Hypermemory

Padrão de memória de agente do Jaime, construído em cima da memória nativa do Claude Code (auto memory). O formato continua o que o Claude Code já é treinado para escrever; por cima entram o diário só de acréscimo do [OptMem](https://github.com/VictorTaelin/OptMem) e os tipos, o "substituir em vez de apagar" e o handoff do [ai-memory](https://github.com/akitaonrails/ai-memory).

Substitui os dois: quem usa OptMem ou ai-memory migra a memória existente com `bun run migrate` (seção "Migrar").

## O que tem aqui

```
PADRAO.md          as regras: arquivos, frontmatter, índice, diário, ciclo
BLOCO-AGENTE.md    as regras do agente (o mod já as entrega; o bloco serve a quem não usa o mod)
modelos/           arquivo de memória, handoff e sub-índice de domínio
memory/            o esqueleto para copiar (plano, como o nativo)
  MEMORY.md        índice que o Claude Code carrega no começo (orçamento: 150 linhas)
  LOG.md           diário: uma linha por memória, nunca editado
```

## Como usar num projeto

1. Crie `memory/` na raiz do projeto com `hypermemory init memory --scope shared --apply` se ela for versionada e lida por outras pessoas. Use `--scope project` para uma memória local.
2. Ligue a pasta nativa a ela: `ln -s <projeto>/memory ~/.claude/projects/<projeto>/memory` (a pasta nativa precisa não existir ou estar vazia).
3. Instale o mod `hypermemory-escopo` (seção abaixo): ele entrega as regras ao agente e o resumo da sessão anterior, sem colar nada no `CLAUDE.md`.

Use `hypermemory init ~/.claude/hypermemory --scope personal --apply` para criar sua memória pessoal. Sem `--apply`, o comando mostra a alteração prevista. Em um índice do formato atual sem marcador de escopo, `--apply` insere o marcador na linha 2.

## Mod `hypermemory-escopo`

Instalado, o mod (em `mod/`) faz quatro coisas, sem nada no `CLAUDE.md`:

- **Regras:** um hook de comando (`hooks/inject-context.mjs`, roda com o `node`) entrega ao agente, na abertura de cada sessão, as regras do Hypermemory (`hooks/agent-rules.md`: as de `BLOCO-AGENTE.md`, sem as de handoff). É hook de comando, e não `prompt.compose`, porque o `cc-plugin-sec-default` das organizações pula os hooks de mod que mexem no contexto (medido em 2026-11-20).
- **Resumo da sessão anterior:** a próxima sessão no mesmo projeto sabe o que aconteceu na anterior. A cada turno do agente principal, e uma última vez ao fechar, o mod reescreve no lugar o handoff da sessão por regra fixa (sem chamar modelo): até 10 pedidos do usuário, arquivos editados, último texto do assistente, no máximo 6.000 caracteres. Cobre sessão que cai sem fechar. Os handoffs ficam em `~/.claude/hypermemory/sessoes/<projeto>/handoff-AAAA-MM-DD-HHMMSS-<id>.md`, nunca na `memory/` do projeto (repo de time é versionado). Ao abrir uma sessão (`session.start`), o mod pega até 3 handoffs `status: open` do projeto, pede ao Haiku (`claude-haiku-5-5`, esforço baixo, 600 tokens, 8 s, só o corpo do handoff, sem histórico) para reescrever em texto corrido curto, ou usa o texto por regra se ele falhar, grava o resultado em `.resumo-<sessão>.md` na mesma pasta e passa o handoff para `status: claimed`. O hook de comando entrega esse resumo no primeiro prompt, uma vez só. Handoff já pego não volta. `/clear` não dispara o `session.start` e começa sem o resumo.
- **Candidatos a memória:** na mesma abertura, o mod faz uma segunda chamada ao Haiku sobre o mesmo registro e junta ao resumo até 3 linhas `kind | texto` (decisão, armadilha, regra, procedimento). É sugestão: nada vai para a `memory/` do projeto, e o agente promove o que valer. O registro do handoff traz só pedidos, arquivos editados e a última resposta, então os candidatos são magros.
- **Escopo:** nega, na hora da gravação, Write, Edit ou Bash (`>`, `tee`, `cp`, `mv`) que ponha memória pessoal numa pasta cujo `MEMORY.md` declara `hypermemory-scope: shared`, inclusive em subpastas. O que escapar dele (script indireto, variável vinda de fora) o `check` pega.

Falha de qualquer hook não trava a sessão. Precisa do `node` no `PATH`. Instale no Claude Code:

```
/plugin install hypermemory-escopo --marketplace JaimeJunr/hypermemory
```

Responda `y` para adicionar o marketplace e escolha o escopo de usuário.

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

Execute `bun run gate` para verificar a formatação e o lint com Biome, os tipos com TypeScript, o limite de 300 linhas por arquivo em `src/`, `test/` e `mod/hooks/` e os testes com cobertura mínima de 80% de linhas e funções por arquivo instrumentado. Os testes do mod rodam com `claude plugin test mod`, e o CI roda os dois. `test/index-budget-invariant.test.ts` gera índices até o teto e exige que `init`, `upgrade` e `migrate` terminem dentro do orçamento ou recusem sem gravar; `test/mod-contract.test.ts` exige que o mod e o validador concordem sobre o que é memória pessoal.

## Envelhecimento

```sh
hypermemory aging <pasta> [--days N]
```

Lista as memórias sem toque há mais de N dias (padrão 180), da mais velha para a mais nova. A data é a mais recente entre `metadata.modified`, as datas "conferido em" e "medido em" do corpo e a data do arquivo. `pinned: true`, `status: superseded` e handoffs não aparecem. O comando só aponta: re-confira o fato (e escreva "conferido em AAAA-MM-DD"), substitua-o ou fixe-o com `pinned: true`. Não apaga nem edita nada.

## Migrar

```sh
bun run migrate optmem <destino>
bun run migrate ai-memory --list
bun run migrate ai-memory --project <nome> <destino>
```

Sem `--apply`, o comando só mostra o plano e não grava nada. Use `--from <pasta>` para indicar outra origem.

Use `--scope personal|project|shared` para escolher o escopo de um novo destino (padrão `project`). Na migração do ai-memory, passe `--personal-dest ~/.claude/hypermemory` para enviar perfis à memória pessoal. Em destino `shared`, perfis são pulados se essa opção for omitida.

## Versões

As mudanças de cada versão estão no [CHANGELOG.md](CHANGELOG.md). O wrapper do repositório, `bin/hypermemory`, aceita `check`, `migrate`, `upgrade` e `init`. Quando `hypermemory` estiver no PATH, use `hypermemory upgrade <pasta>` para ver o plano e `hypermemory upgrade <pasta> --apply` para criar o backup e atualizar. Também é possível usar `bun run upgrade <pasta> [--apply]`.

## O que ficou de fora

- Do OptMem: o script `memo`, o registro de largura fixa e a árvore binária de resumos. O papel dos resumos passa para os arquivos e o índice.
- Do ai-memory: servidor, banco, busca por ranking e pastas por tipo (a memória nativa é plana, então o tipo fica em `metadata.kind`). A captura por hooks e o envelhecimento entraram em versão enxuta, sem servidor nem banco (seções abaixo).

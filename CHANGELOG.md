# Changelog

Todas as mudanças notáveis deste projeto serão documentadas neste arquivo.

O formato segue o [Keep a Changelog 1.1.0](https://keepachangelog.com/pt-BR/1.1.0/)
e o projeto adota o [Versionamento Semântico 2.0.0](https://semver.org/lang/pt-BR/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Link do índice para fora da pasta da memória (`../arquivos/x.md`, `../CLAUDE.md`) passa no `check` quando o arquivo existe no repositório; antes era sempre recusado, e repos de contexto perdiam a navegação do índice para o resto do repo. Alvo inexistente continua reprovando.
- `init` e `upgrade` recusam, sem gravar, inserir marcador num `MEMORY.md` no teto de 150 linhas ou 25 mil bytes; antes gravavam e reprovavam o próprio `check`.

### Added

- Escopos `personal`, `project` e `shared` com marcador opcional na linha 2 de `MEMORY.md`. O formato da memória continua em 1, sem nova migração de formato.
- Comando `hypermemory init` para criar uma memória com escopo ou acrescentar o marcador a um índice existente.
- Opções de migração `--scope` para novos destinos e `--personal-dest` para encaminhar perfis do ai-memory à memória pessoal.
- Mod `hypermemory-escopo` em `mod/`, instalável pelo marketplace do repositório, que barra memória pessoal gravada por Write, Edit ou Bash numa pasta `shared`.
- Testes de invariante (todo comando que grava termina dentro do orçamento do índice ou recusa) e de contrato entre o mod e o validador, rodados no CI junto com os testes do mod.
- Validação do escopo `shared`, que rejeita memórias do tipo `user`, do kind `profile` e feedback marcado como pessoal, inclusive em subpastas como `archive/`.

## [0.1.0] - 2026-11-19

### Added

- Padrão sobre a memória nativa do Claude Code, com `PADRAO.md`, `BLOCO-AGENTE.md` e modelos de memória.
- Validador da pasta de memória.
- Migração de memórias do OptMem e do ai-memory.
- Teste de ponta a ponta com `claude -p`.
- Verificações de qualidade e integração contínua.
- Formato de memória 1 e comando `hypermemory upgrade` com prévia e backup.

Formato da memória: 1

[Unreleased]: https://github.com/JaimeJunr/hypermemory/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/JaimeJunr/hypermemory/releases/tag/v0.1.0

#!/usr/bin/env bash
# Teste de ponta a ponta: roda o Claude Code headless num repositório temporário
# com o bloco do Hypermemory e confere se a memória gravada segue o padrão.
# Gasta cota do Claude: fica fora do pre-push e roda só sob demanda.
#
# Uso: e2e/rodar.sh [cenário ...]   (sem argumento roda todos)
# Ambiente: HM_RUNS (padrão 3), HM_PASS (padrão 2), HM_MODEL (padrão sonnet)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUNS="${HM_RUNS:-3}"
PASS_MIN="${HM_PASS:-2}"
MODEL="${HM_MODEL:-sonnet}"
ALL_SCENARIOS=(preferencia evento substituicao handoff)

# Monta um projeto git temporário com o esqueleto, o bloco no CLAUDE.md e a
# memória nativa apontada para dentro dele (autoMemoryDirectory).
make_project() {
  local dir
  dir="$(mktemp -d)"
  cp -r "$ROOT/memory" "$dir/memory"
  sed -n '/^```markdown$/,/^```$/p' "$ROOT/BLOCO-AGENTE.md" | sed '1d;$d' > "$dir/CLAUDE.md"
  printf '{"autoMemoryDirectory": "%s/memory"}\n' "$dir" > "$dir/settings.json"
  git -C "$dir" init -q && git -C "$dir" add -A && git -C "$dir" -c user.name=e2e -c user.email=e2e@local commit -qm base
  echo "$dir"
}

run_claude() {
  local dir="$1" prompt="$2"
  (cd "$dir" && claude -p "$prompt" --model "$MODEL" --settings "$dir/settings.json" \
    --setting-sources project --permission-mode acceptEdits \
    --allowedTools "Read,Write,Edit,Bash(grep:*),Bash(ls:*),Bash(tail:*)" >"$dir/saida.txt" 2>&1) || true
}

validator_ok() { (cd "$ROOT" && bun run src/cli.ts "$1/memory" >/dev/null 2>&1); }

seed_fact() {
  printf -- '---\nname: gerenciador-pacotes\ndescription: Gerenciador de pacotes padrão do projeto\nmetadata:\n  type: project\n  kind: decision\n---\nO padrão é npm.\n\n**Why:** era o que o time usava.\n\n**How to apply:** use npm install.\n' > "$1/memory/gerenciador-pacotes.md"
  echo '- [Gerenciador de pacotes](gerenciador-pacotes.md) — npm é o padrão' >> "$1/memory/MEMORY.md"
}

seed_handoff() {
  printf -- '---\nname: handoff-2026-11-18-login\ndescription: Onde parou o fluxo de login\nmetadata:\n  type: project\n  kind: session\n  status: open\n  claimed_by:\n---\n**Onde parou:** faltava o teste do token expirado.\n' > "$1/memory/handoff-2026-11-18-login.md"
  echo '- [Handoff login](handoff-2026-11-18-login.md) — teste do token expirado pendente' >> "$1/memory/MEMORY.md"
}

# Cada cenário prepara o projeto, roda o Claude e devolve 0 se passou.
scenario_preferencia() {
  run_claude "$1" "Para guardar: em projeto novo eu prefiro Bun em vez de Node. Só registre isso na memória e responda ok."
  validator_ok "$1" && grep -lq "type: user" "$1"/memory/*.md && grep -q "\](.*\.md)" "$1/memory/MEMORY.md"
}

scenario_evento() {
  run_claude "$1" "Aconteceu hoje: o deploy de staging caiu às 14h e voltou às 14h20. Só registre e responda ok."
  validator_ok "$1" && grep -q "| event |" "$1/memory/LOG.md"
}

scenario_substituicao() {
  seed_fact "$1"; git -C "$1" add -A && git -C "$1" -c user.name=e2e -c user.email=e2e@local commit -qm fato
  run_claude "$1" "Mudou: o gerenciador de pacotes padrão agora é Bun, não mais npm. Atualize a memória e responda ok."
  validator_ok "$1" && grep -q "superseded_by" "$1/memory/gerenciador-pacotes.md"
}

scenario_handoff() {
  seed_handoff "$1"
  run_claude "$1" "Oi. Onde a gente parou?"
  validator_ok "$1" && grep -q "status: claimed" "$1/memory/handoff-2026-11-18-login.md"
}

run_scenario() {
  local name="$1" passed=0 i dir
  for ((i = 1; i <= RUNS; i++)); do
    dir="$(make_project)"
    if "scenario_$name" "$dir"; then passed=$((passed + 1)); echo "  $name #$i: passou"; else echo "  $name #$i: falhou ($dir)"; fi
  done
  echo "$name: $passed/$RUNS (mínimo $PASS_MIN)"
  [ "$passed" -ge "$PASS_MIN" ]
}

main() {
  local failed=0 name
  local scenarios=("$@")
  [ "${#scenarios[@]}" -eq 0 ] && scenarios=("${ALL_SCENARIOS[@]}")
  for name in "${scenarios[@]}"; do run_scenario "$name" || failed=1; done
  exit "$failed"
}

main "$@"

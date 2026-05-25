#!/bin/bash
# run-checks.sh - 运行所有代码质量检查，捕获输出，始终返回 0
# 被 check skill 的 !`bash ...` 调用，将结果注入 LLM 上下文

run_check() {
  local name="$1"
  shift
  echo "---[${name}]---"
  "$@" 2>&1 || true
  echo ""
}

run_check "deno fmt --check" deno fmt --check
run_check "deno lint" deno lint
run_check "deno check src/" deno check src/
run_check "deno test" deno test --allow-env
run_check "cspell" npx cspell '**/*.ts' '**/*.md'

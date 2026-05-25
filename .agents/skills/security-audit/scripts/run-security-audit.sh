#!/bin/bash
# run-security-audit.sh - 运行安全审计，捕获输出，始终返回 0
# 被 security-audit skill 的 !`bash ...` 调用，将结果注入 LLM 上下文

run_check() {
  local name="$1"
  shift
  echo "---[${name}]---"
  "$@" 2>&1 || true
  echo ""
}

run_check "deno audit" deno audit
run_check "deno audit --level=high" deno audit --level=high
run_check "deno audit --socket" deno audit --socket
run_check "deno outdated" deno outdated
run_check "deno outdated --compatible" deno outdated --compatible

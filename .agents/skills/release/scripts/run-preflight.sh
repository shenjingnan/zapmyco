#!/bin/bash
# run-preflight.sh - 执行发布预检（dry-run），捕获完整输出，始终返回 0
# 被 release skill 的 !`bash ...` 调用，将结果注入 LLM 上下文

run_check() {
  local name="$1"
  shift
  echo "---[${name}]---"
  "$@" 2>&1 || true
  echo ""
}

run_check "release dry-run" deno run -A tools/release.ts --dry-run "$@"

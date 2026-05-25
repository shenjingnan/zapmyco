#!/bin/bash
# build.sh - 构建 npm 包，捕获输出，始终返回 0
# 被 build skill 的 !`bash ...` 调用，将结果注入 LLM 上下文

run_check() {
  local name="$1"
  shift
  echo "---[${name}]---"
  "$@" 2>&1 || true
  echo ""
}

run_check "deno check src/" deno check src/
run_check "deno run -A tools/build-npm.ts" deno run -A tools/build-npm.ts

echo "---[verify dist/npm/]---"
if [ -d "dist/npm" ] && [ -f "dist/npm/package.json" ] && [ -f "dist/npm/esm/src/index.js" ] && [ -d "dist/npm/types" ]; then
  echo "✓ 构建产物验证通过"
  echo "  目录: dist/npm/"
  echo "  文件: package.json, esm/src/index.js, types/, ..."
  ls -lh dist/npm/
elif [ -d "dist/npm" ]; then
  echo "⚠ 构建产物部分缺失"
  ls -lh dist/npm/
else
  echo "✗ dist/npm/ 目录不存在"
fi
echo ""

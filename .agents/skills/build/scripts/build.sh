#!/bin/bash
# build.sh - 构建 Rust 项目，捕获输出，始终返回 0
# 被 build skill 的 !`bash ...` 调用，将结果注入 LLM 上下文

run_check() {
  local name="$1"
  shift
  echo "---[${name}]---"
  "$@" 2>&1 || true
  echo ""
}

run_check "cargo check" cargo check
run_check "cargo build --release" cargo build --release

echo "---[verify target/release/]---"
if [ -f "target/release/zapmyco" ]; then
  echo "✓ 构建产物验证通过"
  echo "  文件: target/release/zapmyco"
  ls -lh target/release/zapmyco
else
  echo "✗ target/release/zapmyco 不存在"
fi
echo ""

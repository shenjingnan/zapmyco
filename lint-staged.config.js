export default {
  '*.ts': [
    'biome check --write',
    'cspell --no-gitignore',
    // typecheck 是项目级操作，lint-staged 会把文件路径追加到命令末尾导致 TS5112
    // 用 sh -c 包裹，不引用 $@，使 tsc 不接收文件参数，始终做全量类型检查
    () => 'sh -c "tsc --noEmit"',
    // vitest v3 中 --related 从 run 选项变为独立子命令
    // 用 sh -c 包裹，通过 $@ 接收 lint-staged 传入的文件列表
    () => 'sh -c "npx vitest related $@"',
  ],
  '*.js': ['biome check --write'],
  '*.json': ['biome check --write'],
  '*.md': ['cspell --no-gitignore'],
};

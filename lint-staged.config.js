export default {
  '*.ts': ['biome check --write', 'cspell --no-gitignore', 'tsc --noEmit', 'vitest run --related'],
  '*.js': ['biome check --write'],
  '*.json': ['biome check --write'],
  '*.md': ['cspell --no-gitignore'],
};

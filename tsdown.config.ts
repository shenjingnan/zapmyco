/**
 * zapmyco 构建配置
 *
 * 支持多入口构建：
 * - src/index.ts → 库模式（供其他项目 import）
 * - src/cli/index.ts → CLI 二进制（zapmyco 命令）
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'tsdown';

const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8')) as {
  version: string;
};

export default defineConfig({
  // 多入口：库 + CLI
  entry: {
    index: 'src/index.ts',
    'cli/index': 'src/cli/index.ts',
    'protocol/index': 'src/protocol/index.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  minify: false,
  target: 'es2022',
  define: {
    __VERSION__: JSON.stringify(pkg.version),
  },
});

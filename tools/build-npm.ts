/**
 * tools/build-npm.ts — dnt 构建脚本
 *
 * 将 Deno 源码转换为 npm 包，输出到 dist/npm/。
 * 上游 workflow (release.yml) 会 cd dist/npm && npm publish。
 *
 * 用法:
 *   deno run -A tools/build-npm.ts            # 从 deno.json 读取版本
 *   deno run -A tools/build-npm.ts 0.5.0      # 指定版本
 *
 * 依赖:
 *   - jsr:@deno/dnt — Deno → npm 转换工具
 */

import { build, emptyDir } from 'jsr:@deno/dnt@0.42';

// 版本来源: CLI 参数 > deno.json
const version = Deno.args[0] ??
  (JSON.parse(Deno.readTextFileSync('deno.json'))).version;

const outDir = './dist/npm';

await emptyDir(outDir);

await build({
  entryPoints: [
    { name: '.', path: './src/index.ts' },
    { name: './cli', path: './src/cli.ts' },
  ],
  outDir,
  importMap: './deno.json',
  shims: {
    deno: true,
  },
  package: {
    name: 'zapmyco',
    version,
    description: 'AI 原生的 TypeScript 启动模板，专为 AI 辅助开发时代打造',
    license: 'MIT',
    repository: {
      type: 'git',
      url: 'https://github.com/shenjingnan/zapmyco.git',
    },
    bugs: {
      url: 'https://github.com/shenjingnan/zapmyco/issues',
    },
    bin: {
      zapmyco: './esm/cli.js',
    },
    publishConfig: {
      provenance: true,
      access: 'public',
    },
  },
  typeCheck: false,
  test: false,
  declaration: 'separate',
  esModule: true,
  scriptModule: false,
  postBuild() {
    Deno.copyFileSync('LICENSE', `${outDir}/LICENSE`);
    Deno.copyFileSync('README.md', `${outDir}/README.md`);
  },
});

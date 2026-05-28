# Changelog

## [0.22.2](https://github.com/shenjingnan/zapmyco/compare/v0.22.1...v0.22.2) (2026-05-27)

### Bug Fixes

- 升级 @anthropic-ai/sdk 至 v0.98 消除 punycode 弃用警告 (#245)
  ([a0af891](https://github.com/shenjingnan/zapmyco/commit/a0af891))

## [0.22.1](https://github.com/shenjingnan/zapmyco/compare/v0.22.0...v0.22.1) (2026-05-26)

### Bug Fixes

- **build:** 修复 npm 包 bin 路径和 shebang，解决 npx zapmyco 无法使用的问题 (#244)
  ([47510d5](https://github.com/shenjingnan/zapmyco/commit/47510d5))

## [0.22.0](https://github.com/shenjingnan/zapmyco/compare/v0.21.0...v0.22.0) (2026-05-26)

### Bug Fixes

- **release:** 在 git commit 前运行 deno fmt 以通过 pre-commit hook
  ([d38f1a8](https://github.com/shenjingnan/zapmyco/commit/d38f1a8))

### Features

- **cli:** 内联内容支持流式输出并自动进入交互模式 (#243)
  ([5c5d59a](https://github.com/shenjingnan/zapmyco/commit/5c5d59a))

## [0.21.0](https://github.com/shenjingnan/zapmyco/compare/v0.20.6...v0.21.0) (2026-05-26)

### Features

- **cli:** 集成 Commander.js 重构 CLI，修复非流式请求问题 (#242)
  ([06d49cc](https://github.com/shenjingnan/zapmyco/commit/06d49cc))
- 支持可配置的 maxTokens，扩展内置模型注册表字段 (#241)
  ([463f18e](https://github.com/shenjingnan/zapmyco/commit/463f18e))
- 重构 LLM 配置系统，支持多供应商和多模型配置档 (#239)
  ([eb4e4ff](https://github.com/shenjingnan/zapmyco/commit/eb4e4ff))
- 新增 ~/.zapmyco/settings.json 集中管理 LLM 配置 (#238)
  ([23e3edc](https://github.com/shenjingnan/zapmyco/commit/23e3edc))
- 为 install.sh 添加下载进度条 (#237)
  ([b15fe9d](https://github.com/shenjingnan/zapmyco/commit/b15fe9d))

### Ci

- **deps:** bump actions/download-artifact from 7 to 8 (#235)
  ([c45989b](https://github.com/shenjingnan/zapmyco/commit/c45989b))
- **deps:** bump actions/upload-artifact from 6 to 7 (#236)
  ([05e7ae3](https://github.com/shenjingnan/zapmyco/commit/05e7ae3))

## [0.20.6](https://github.com/shenjingnan/zapmyco/compare/v0.20.5...v0.20.6) (2026-05-25)

### Bug Fixes

- 移除 macOS 编译二进制的 UPX 压缩 (#234)
  ([057d634](https://github.com/shenjingnan/zapmyco/commit/057d634))

## [0.20.5](https://github.com/shenjingnan/zapmyco/compare/v0.20.4-beta.0...v0.20.5) (2026-05-25)

### Documentation

- 添加跨平台安装脚本（Unix 和 Windows） (#233)
  ([4b1f4e9](https://github.com/shenjingnan/zapmyco/commit/4b1f4e9))
- 将安装脚本移动到 docs 目录 (#232)
  ([eca3c25](https://github.com/shenjingnan/zapmyco/commit/eca3c25))
- 徽标居中显示 (#231) ([03358b4](https://github.com/shenjingnan/zapmyco/commit/03358b4))
- 移除 MDX 文件中的 H1 标题并修复徽标布局 (#230)
  ([01a525d](https://github.com/shenjingnan/zapmyco/commit/01a525d))
- 简化 README 中贡献相关的内容 (#229)
  ([6395fd6](https://github.com/shenjingnan/zapmyco/commit/6395fd6))
- 移除旧项目残留的过期文档文件 (#228)
  ([f06b43d](https://github.com/shenjingnan/zapmyco/commit/f06b43d))
- 使用 OpenManual 重构文档站点并配置 Vercel 部署 (#224)
  ([476f6e2](https://github.com/shenjingnan/zapmyco/commit/476f6e2))
- 更新 README 为 zapmyco 项目信息并添加 Logo (#223)
  ([14fa8d2](https://github.com/shenjingnan/zapmyco/commit/14fa8d2))

### Chores

- **docs:** 移动 logo.svg 到 docs/public 并去除白底 (#227)
  ([3495ea6](https://github.com/shenjingnan/zapmyco/commit/3495ea6))

### Code Refactoring

- **deploy:** 将 Vercel 配置从根目录迁移到 docs 目录 (#226)
  ([6dc77f3](https://github.com/shenjingnan/zapmyco/commit/6dc77f3))

### Bug Fixes

- **deploy:** 修复 Vercel 部署失败，从 npm 切换到 pnpm (#225)
  ([b40869f](https://github.com/shenjingnan/zapmyco/commit/b40869f))
- pre-commit 类型检查增加 tools 目录 (#222)
  ([a6af1e3](https://github.com/shenjingnan/zapmyco/commit/a6af1e3))

## [0.20.4-beta.0](https://github.com/shenjingnan/zapmyco/compare/v0.20.3...v0.20.4-beta.0) (2026-05-25)

### Code Refactoring

- **skills:** 优化 release skill 使用脚本预执行发布 (#221)
  ([ac4da10](https://github.com/shenjingnan/zapmyco/commit/ac4da10))
- **skills:** 优化 resolve-git-conflicts 使用脚本预执行冲突检测 (#220)
  ([fb4bbe5](https://github.com/shenjingnan/zapmyco/commit/fb4bbe5))
- **skills:** 优化 commit-push-pr skill 使用脚本预执行上下文 (#219)
  ([432cfa4](https://github.com/shenjingnan/zapmyco/commit/432cfa4))
- **skills:** 优化 security-audit skill 使用脚本预执行审计 (#218)
  ([8acc0d2](https://github.com/shenjingnan/zapmyco/commit/8acc0d2))
- **skills:** 优化 build skill 使用脚本预执行构建 (#217)
  ([cedb893](https://github.com/shenjingnan/zapmyco/commit/cedb893))
- **skills:** 合并 lint/test/spellcheck/typecheck 为统一的 check 技能 (#215)
  ([2c3b759](https://github.com/shenjingnan/zapmyco/commit/2c3b759))
- 将 .agents/commands 迁移为 skills (#213)
  ([ab75c90](https://github.com/shenjingnan/zapmyco/commit/ab75c90))

### Chores

- **skills:** 删除已迁移的旧技能文件 (#216)
  ([c12b127](https://github.com/shenjingnan/zapmyco/commit/c12b127))
- 更新技能和配置文件以适配 Deno 技术栈 (#214)
  ([d3fb5a1](https://github.com/shenjingnan/zapmyco/commit/d3fb5a1))

## [0.20.3](https://github.com/shenjingnan/zapmyco/compare/v0.20.2...v0.20.3) (2026-05-25)

### Chores

- 升级 upload-artifact/download-artifact 兼容 Node.js 24
  ([7598b04](https://github.com/shenjingnan/zapmyco/commit/7598b04))

## [0.20.2](https://github.com/shenjingnan/zapmyco/compare/v0.20.1...v0.20.2) (2026-05-25)

### Bug Fixes

- generate-checksums job 缺少 checkout 导致 gh release upload 失败
  ([ae86a11](https://github.com/shenjingnan/zapmyco/commit/ae86a11))

## [0.20.1](https://github.com/shenjingnan/zapmyco/compare/v0.20.0...v0.20.1) (2026-05-25)

### Bug Fixes

- Windows CI 上 shasum 命令不存在导致 SHA256 计算失败 (#212)
  ([b961f5d](https://github.com/shenjingnan/zapmyco/commit/b961f5d))

## [0.20.0](https://github.com/shenjingnan/zapmyco/compare/v0.19.2...v0.20.0) (2026-05-25)

### Features

- GitHub Release 增加 SHA256 checksum 校验和安装指引 (#211)
  ([ead8583](https://github.com/shenjingnan/zapmyco/commit/ead8583))

## [0.19.2](https://github.com/shenjingnan/zapmyco/compare/v0.19.1...v0.19.2) (2026-05-25)

### Bug Fixes

- 修复 Release workflow ARM64 二进制构建时 strip 失败的问题 (#210)
  ([63c10d7](https://github.com/shenjingnan/zapmyco/commit/63c10d7))

## [0.19.1](https://github.com/shenjingnan/zapmyco/compare/v0.19.0...v0.19.1) (2026-05-25)

### Performance Improvements

- 优化 deno compile 产物体积，引入 --no-check、strip 和 UPX 压缩 (#209)
  ([edf4820](https://github.com/shenjingnan/zapmyco/commit/edf4820))

## [0.19.0](https://github.com/shenjingnan/zapmyco/compare/v0.18.0...v0.19.0) (2026-05-25)

### Features

- 创建安装脚本，简化二进制安装命令 (#208)
  ([5f072dd](https://github.com/shenjingnan/zapmyco/commit/5f072dd))

## [0.18.0](https://github.com/shenjingnan/zapmyco/compare/v0.17.2-beta.2...v0.18.0) (2026-05-25)

### Features

- GitHub Release 自动构建多平台二进制文件 (#207)
  ([170f653](https://github.com/shenjingnan/zapmyco/commit/170f653))

## [0.17.2-beta.2](https://github.com/shenjingnan/zapmyco/compare/v0.16.0...v0.17.2-beta.2) (2026-05-25)

### Code Refactoring

- 移除 release-it，改用 Deno 原生发布脚本 + dnt 双发布 (#206)
  ([ad5042a](https://github.com/shenjingnan/zapmyco/commit/ad5042a))
- 将项目从 Node.js/pnpm 迁移到 Deno/JSR (#202)
  ([d49ed93](https://github.com/shenjingnan/zapmyco/commit/d49ed93))

### Features

- 新增 AI 对话模式和 CLI 交互原型 (#205)
  ([55fc341](https://github.com/shenjingnan/zapmyco/commit/55fc341))
- 添加 CLI 命令行支持 (#203) ([b8324e5](https://github.com/shenjingnan/zapmyco/commit/b8324e5))

## [0.4.5](https://github.com/shenjingnan/ai-typescript-starter/compare/v0.4.4...v0.4.5) (2026-04-14)

### Bug Fixes

- **commands:** 修复 fix-audit 命令中 pnpm audit 非零退出码问题
  ([#48](https://github.com/shenjingnan/ai-typescript-starter/issues/48))
  ([f70cd15](https://github.com/shenjingnan/ai-typescript-starter/commit/f70cd15bd99170652614d6a1b9a6a524b89df105))

## [0.4.4](https://github.com/shenjingnan/ai-typescript-starter/compare/v0.4.3...v0.4.4) (2026-04-14)

### Bug Fixes

- **security:** 修复 basic-ftp 高危漏洞并更新 Biome schema
  ([#47](https://github.com/shenjingnan/ai-typescript-starter/issues/47))
  ([59186c0](https://github.com/shenjingnan/ai-typescript-starter/commit/59186c05485bb5e745debe12ed35dd0b3d0985b4))

## [0.4.3](https://github.com/shenjingnan/ai-typescript-starter/compare/v0.4.2...v0.4.3) (2026-04-10)

### Bug Fixes

- **commands:** 修复 increase-coverage 命令的 git diff 用法
  ([#44](https://github.com/shenjingnan/ai-typescript-starter/issues/44))
  ([f9d8088](https://github.com/shenjingnan/ai-typescript-starter/commit/f9d8088408252c5621111cdf060bf15c3353f09a))

## [0.4.2](https://github.com/shenjingnan/ai-typescript-starter/compare/v0.4.1...v0.4.2) (2026-04-10)

### Documentation

- **skill:** 简化 update-readme skill 注意事项
  ([#41](https://github.com/shenjingnan/ai-typescript-starter/issues/41))
  ([5a4152b](https://github.com/shenjingnan/ai-typescript-starter/commit/5a4152bfc53af72ae04088ddba347014093fdb4c))
- 同步 README.md 与项目实际状态
  ([#42](https://github.com/shenjingnan/ai-typescript-starter/issues/42))
  ([02bcccd](https://github.com/shenjingnan/ai-typescript-starter/commit/02bcccd92c686587bae616c96a37fec5dd37125c))

## [0.4.1](https://github.com/shenjingnan/ai-typescript-starter/compare/v0.4.0...v0.4.1) (2026-04-08)

### Documentation

- 清理项目中残留的 tsup 引用，统一替换为 tsdown
  ([#39](https://github.com/shenjingnan/ai-typescript-starter/issues/39))
  ([c101462](https://github.com/shenjingnan/ai-typescript-starter/commit/c10146296ebc60f85ba41560dcac89271f4aeef5))

## [0.4.0](https://github.com/shenjingnan/ai-typescript-starter/compare/v0.3.0...v0.4.0) (2026-04-08)

### Features

- 导出编译时版本号常量 VERSION
  ([#28](https://github.com/shenjingnan/ai-typescript-starter/issues/28))
  ([341f72a](https://github.com/shenjingnan/ai-typescript-starter/commit/341f72ac36e99efeb81f96f8f8bd405ef599bcc6))
- 添加 update-readme skill ([#31](https://github.com/shenjingnan/ai-typescript-starter/issues/31))
  ([ec59d8c](https://github.com/shenjingnan/ai-typescript-starter/commit/ec59d8c69b11d0e88cf37c37136e361f726af8b6))
- 添加安全审计技能 fix-audit ([#30](https://github.com/shenjingnan/ai-typescript-starter/issues/30))
  ([0212b9f](https://github.com/shenjingnan/ai-typescript-starter/commit/0212b9fbb162947e49ed12b5124ee18eb9bda3a3))

### Bug Fixes

- **deps:** 修复 9 个间接依赖安全漏洞
  ([#29](https://github.com/shenjingnan/ai-typescript-starter/issues/29))
  ([396c814](https://github.com/shenjingnan/ai-typescript-starter/commit/396c814faa6749326b3aa21c2efc03d48498c265))
- **deps:** 修复安全审计漏洞，升级 vitest 2.x → 3.x
  ([#38](https://github.com/shenjingnan/ai-typescript-starter/issues/38))
  ([931082b](https://github.com/shenjingnan/ai-typescript-starter/commit/931082b0e4f378a7ef1490303b39c67a5e52bf3b))

### Code Refactoring

- dev 脚本改用 tsdown --watch 替代 tsx watch
  ([#36](https://github.com/shenjingnan/ai-typescript-starter/issues/36))
  ([26a41bc](https://github.com/shenjingnan/ai-typescript-starter/commit/26a41bcbb5bce37a7d0eed263f58dccb857c212b))
- 迁移构建工具 tsup → tsdown ([#35](https://github.com/shenjingnan/ai-typescript-starter/issues/35))
  ([97140ce](https://github.com/shenjingnan/ai-typescript-starter/commit/97140ce1ecc9e520a9ac1821463458c8b341bf32))

### Documentation

- 添加 spellcheck 和 typecheck 命令
  ([#37](https://github.com/shenjingnan/ai-typescript-starter/issues/37))
  ([efd04e2](https://github.com/shenjingnan/ai-typescript-starter/commit/efd04e2a788e8b71924eedbe65e5967269ea1175))
- 添加中文优先规则到关键规则 ([#32](https://github.com/shenjingnan/ai-typescript-starter/issues/32))
  ([00d4aa4](https://github.com/shenjingnan/ai-typescript-starter/commit/00d4aa4ecc9420029123c15a3f6b2c5804c15bad))

## [0.3.0](https://github.com/shenjingnan/ai-typescript-starter/compare/v0.3.0-beta.1...v0.3.0) (2026-04-03)

## [0.3.0-beta.1](https://github.com/shenjingnan/ai-typescript-starter/compare/v0.3.0-beta.0...v0.3.0-beta.1) (2026-04-03)

### Bug Fixes

- **ci:** 修复发布工作流中的拼写错误
  ([#26](https://github.com/shenjingnan/ai-typescript-starter/issues/26))
  ([5c12f0d](https://github.com/shenjingnan/ai-typescript-starter/commit/5c12f0dcdee6e292b1bd538d0475894198be2325))

## [0.3.0-beta.0](https://github.com/shenjingnan/ai-typescript-starter/compare/v0.2.0...v0.3.0-beta.0) (2026-04-03)

### Features

- **skills:** 添加 Git 冲突解决技能
  ([#20](https://github.com/shenjingnan/ai-typescript-starter/issues/20))
  ([a024c42](https://github.com/shenjingnan/ai-typescript-starter/commit/a024c42eb00c0ea240189218aa40490fd90e0579))

### Bug Fixes

- **ci:** 将 GitHub Actions 工作流名称还原为英文并修复文件末尾换行
  ([#19](https://github.com/shenjingnan/ai-typescript-starter/issues/19))
  ([3b55b47](https://github.com/shenjingnan/ai-typescript-starter/commit/3b55b47df6d38889a87a1aec1e9ae92ad1e921c4))
- 清理 husky pre-commit hook 中的废弃代码
  ([#23](https://github.com/shenjingnan/ai-typescript-starter/issues/23))
  ([05c7d30](https://github.com/shenjingnan/ai-typescript-starter/commit/05c7d306707d8d74f15c7ef796811e1d8d201c53))

### Code Refactoring

- 整合 AI 配置，统一使用 AGENTS.md
  ([#22](https://github.com/shenjingnan/ai-typescript-starter/issues/22))
  ([b5ea5de](https://github.com/shenjingnan/ai-typescript-starter/commit/b5ea5dea5cafa28718d95e01e1112c7e28a77bb9))

## 0.2.0 (2026-03-29)

### Features

- 初始化 AI 原生 TypeScript 启动模板
  ([#1](https://github.com/shenjingnan/ai-typescript-starter/issues/1))
  ([94e0755](https://github.com/shenjingnan/ai-typescript-starter/commit/94e075567cf188f9421b5c7327e49917668ef570))

### Documentation

- 将 GitHub Actions 工作流名称翻译为中文
  ([#14](https://github.com/shenjingnan/ai-typescript-starter/issues/14))
  ([41f20af](https://github.com/shenjingnan/ai-typescript-starter/commit/41f20af0c2fcc088d1b3e45d2bb39a30fc20792b))
- 将 GitHub Copilot 指南翻译为中文
  ([#15](https://github.com/shenjingnan/ai-typescript-starter/issues/15))
  ([557c4c6](https://github.com/shenjingnan/ai-typescript-starter/commit/557c4c6e61e79ee45a8571a89c5cbb51cf325a26))
- 将 GitHub Issue 模板翻译为中文
  ([#13](https://github.com/shenjingnan/ai-typescript-starter/issues/13))
  ([2549c70](https://github.com/shenjingnan/ai-typescript-starter/commit/2549c70d3c78af2bf8ab23ecbd7f39d58b7bd361))

### CI/CD

- **deps:** Bump actions/checkout from 4 to 6
  ([#4](https://github.com/shenjingnan/ai-typescript-starter/issues/4))
  ([a78628e](https://github.com/shenjingnan/ai-typescript-starter/commit/a78628ea133281a9fb4b086cc97a0b5c7bfafbc7))
- **deps:** Bump actions/setup-node from 4 to 6
  ([#3](https://github.com/shenjingnan/ai-typescript-starter/issues/3))
  ([53dfd3b](https://github.com/shenjingnan/ai-typescript-starter/commit/53dfd3b8f874fa96905c58005c876b447317c621))
- **deps:** Bump codecov/codecov-action from 4 to 6
  ([#5](https://github.com/shenjingnan/ai-typescript-starter/issues/5))
  ([94b3e22](https://github.com/shenjingnan/ai-typescript-starter/commit/94b3e22324ad632c02768c06316a66856ca2189e))
- **deps:** Bump pnpm/action-setup from 4 to 5
  ([#2](https://github.com/shenjingnan/ai-typescript-starter/issues/2))
  ([c2000b7](https://github.com/shenjingnan/ai-typescript-starter/commit/c2000b7ca8cc5129b57b15174a40d9701900d311))

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.22.17](https://github.com/shenjingnan/zapmyco/compare/v0.22.16...v0.22.17) - 2026-05-28

### Fixed

- 添加 rust-toolchain.toml 锁定 Rust 工具链版本为 1.95 ([#285](https://github.com/shenjingnan/zapmyco/pull/285))

## [0.22.16](https://github.com/shenjingnan/zapmyco/compare/v0.22.15...v0.22.16) - 2026-05-28

### Fixed

- *(ci)* 使用 PAT_TOKEN 替代 GITHUB_TOKEN 使 tag push 触发 cargo-dist ([#283](https://github.com/shenjingnan/zapmyco/pull/283))

## [0.22.15](https://github.com/shenjingnan/zapmyco/compare/v0.22.14...v0.22.15) - 2026-05-28

### Other

- *(ci)* 重构发布工作流，合并 cargo-dist 到 release.yml ([#281](https://github.com/shenjingnan/zapmyco/pull/281))

## [0.22.14](https://github.com/shenjingnan/zapmyco/compare/v0.22.13...v0.22.14) - 2026-05-28

### Fixed

- 修复 release 工作流中缺少 checkout 步骤导致触发 cargo-dist 失败的问题 ([#279](https://github.com/shenjingnan/zapmyco/pull/279))

## [0.22.13](https://github.com/shenjingnan/zapmyco/compare/v0.22.12...v0.22.13) - 2026-05-28

### Added

- 引入 cargo-dist 优化跨平台发布流程 ([#276](https://github.com/shenjingnan/zapmyco/pull/276))

### Other

- 更新 release-plz 配置，移除 git_push_extra_args ([#277](https://github.com/shenjingnan/zapmyco/pull/277))

## [0.22.12](https://github.com/shenjingnan/zapmyco/compare/v0.22.11...v0.22.12) - 2026-05-28

### Fixed

- 修复 Release 模板路径和 gh 参数错误 ([#274](https://github.com/shenjingnan/zapmyco/pull/274))

## [0.22.11](https://github.com/shenjingnan/zapmyco/compare/v0.22.10...v0.22.11) - 2026-05-28

### Added

- 为 Release 页面添加安装引导模板 ([#272](https://github.com/shenjingnan/zapmyco/pull/272))

## [0.22.10](https://github.com/shenjingnan/zapmyco/compare/v0.22.9...v0.22.10) - 2026-05-28

### Fixed

- *(ci)* generate-checksums 添加 checkout 步骤避免 gh release upload 失败

## [0.22.9](https://github.com/shenjingnan/zapmyco/compare/v0.22.8...v0.22.9) - 2026-05-28

### Fixed

- *(ci)* ARM64 交叉编译后使用 aarch64-linux-gnu-strip 而非 strip

## [0.22.8](https://github.com/shenjingnan/zapmyco/compare/v0.22.7...v0.22.8) - 2026-05-28

### Fixed

- *(ci)* 限制默认 apt 源为 amd64 避免添加 arm64 后安全源 404

## [0.22.7](https://github.com/shenjingnan/zapmyco/compare/v0.22.6...v0.22.7) - 2026-05-28

### Fixed

- *(ci)* 修复 ARM64 交叉编译 apt-get 安装 libssl-dev:arm64 失败

## [0.22.6](https://github.com/shenjingnan/zapmyco/compare/v0.22.5...v0.22.6) - 2026-05-28

### Fixed

- *(ci)* 修复 ARM64 交叉编译缺少 OpenSSL 和 Windows 上传重试

## [0.22.5](https://github.com/shenjingnan/zapmyco/compare/v0.22.4...v0.22.5) - 2026-05-28

### Fixed

- *(ci)* 修复 release-plz tag 检测机制，改用 releases output 而非 git describe

## [0.22.4] - 2026-05-27

### Other

- 添加 settings 模块的完整测试覆盖 ([#264](https://github.com/shenjingnan/zapmyco/pull/264))

## [0.22.3] - 2026-05-27

### Fixed

- *(build)* 同步 Cargo.lock 版本号到 0.22.2 ([#262](https://github.com/shenjingnan/zapmyco/pull/262))
- *(release)* 删除异常的 v{version} tag 并回退版本号到 0.22.2
- *(ci)* 修复 release 工作流并发控制和权限问题 ([#260](https://github.com/shenjingnan/zapmyco/pull/260))
- *(test)* 修复 test_version_constant 硬编码版本号导致发布失败 ([#257](https://github.com/shenjingnan/zapmyco/pull/257))

### Other

- *(ci)* 重命名 CI 工作流名称 ([#261](https://github.com/shenjingnan/zapmyco/pull/261))
- *(release)* 明确发布流程二阶段职责划分 ([#258](https://github.com/shenjingnan/zapmyco/pull/258))
- release v0.22.3 ([#256](https://github.com/shenjingnan/zapmyco/pull/256))
- *(release)* 将上下文获取命令抽取为独立脚本 ([#255](https://github.com/shenjingnan/zapmyco/pull/255))

## [0.1.0] - 2026-03-26

### Added

- Initial release
- Basic TypeScript project structure
- Build, test, and lint scripts
- CI/CD pipeline
- Documentation

[Unreleased]: https://github.com/shenjingnan/zapmyco/compare/v0.22.4...HEAD
[0.22.4]: https://github.com/shenjingnan/zapmyco/releases/tag/v0.22.4
[0.22.3]: https://github.com/shenjingnan/zapmyco/releases/tag/v0.22.3
[0.1.0]: https://github.com/shenjingnan/ai-typescript-starter/releases/tag/v0.1.0

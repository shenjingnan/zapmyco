# Changelog

## [Unreleased]

## [0.31.1](https://github.com/shenjingnan/zapmyco/compare/v0.31.0...v0.31.1) - 2026-05-31

### Added

- *(tools)* 添加 Grep 工具支持在本地文件系统中搜索文件内容 ([#353](https://github.com/shenjingnan/zapmyco/pull/353))

### Other

- *(built-in-tools)* 添加 Grep 内置工具文档 ([#354](https://github.com/shenjingnan/zapmyco/pull/354))

## [0.31.0](https://github.com/shenjingnan/zapmyco/compare/v0.30.0...v0.31.0) - 2026-05-31

### Added

- *(cli)* 添加 upgrade 命令，支持 zapmyco 自升级 ([#352](https://github.com/shenjingnan/zapmyco/pull/352))

### Fixed

- 恢复模块重构后的外部 API 兼容性，添加 pub use 重新导出 ([#350](https://github.com/shenjingnan/zapmyco/pull/350))

## [0.30.0](https://github.com/shenjingnan/zapmyco/compare/v0.29.2...v0.30.0) - 2026-05-31

### Other

- *(src)* 重构模块目录结构，按领域分组源代码 ([#348](https://github.com/shenjingnan/zapmyco/pull/348))

## [0.29.2](https://github.com/shenjingnan/zapmyco/compare/v0.29.1...v0.29.2) - 2026-05-31

### Added

- *(agent)* 添加联网搜索功能，支持 web_search_20250305 服务端工具 ([#345](https://github.com/shenjingnan/zapmyco/pull/345))

### Other

- 添加内置工具文档，介绍 run 命令的 AI Agent 工具能力 ([#347](https://github.com/shenjingnan/zapmyco/pull/347))

## [0.29.1](https://github.com/shenjingnan/zapmyco/compare/v0.29.0...v0.29.1) - 2026-05-31

### Other

- 更新 note 命令文档，适配 clap 枚举子命令重构 ([#343](https://github.com/shenjingnan/zapmyco/pull/343))

## [0.29.0](https://github.com/shenjingnan/zapmyco/compare/v0.28.0...v0.29.0) - 2026-05-31

### Other

- *(cli)* [**breaking**] 将 note 子命令重构为 clap 枚举子命令 ([#341](https://github.com/shenjingnan/zapmyco/pull/341))

## [0.28.0](https://github.com/shenjingnan/zapmyco/compare/v0.27.0...v0.28.0) - 2026-05-30

### Added

- *(cli)* 添加 note 子命令，支持快速记录笔记 ([#339](https://github.com/shenjingnan/zapmyco/pull/339))

### Fixed

- 为 ToolHandler 枚举添加 #[non_exhaustive] 注解 ([#337](https://github.com/shenjingnan/zapmyco/pull/337))

### Other

- 添加 tarpaulin 和 codecov 配置，排除 vendor 目录覆盖率统计 ([#340](https://github.com/shenjingnan/zapmyco/pull/340))

## [0.27.0](https://github.com/shenjingnan/zapmyco/compare/v0.26.1...v0.27.0) - 2026-05-30

### Added

- 添加 run_command 工具，支持 LLM 在本地执行 shell 命令 ([#335](https://github.com/shenjingnan/zapmyco/pull/335))

## [0.26.1](https://github.com/shenjingnan/zapmyco/compare/v0.26.0...v0.26.1) - 2026-05-30

### Fixed

- *(release-plz)* 仅对主包启用 git tag，避免 SDK tag 触发无效 release ([#333](https://github.com/shenjingnan/zapmyco/pull/333))

## [0.26.0](https://github.com/shenjingnan/zapmyco/compare/v0.25.2...v0.26.0) - 2026-05-30

### Added

- 添加 Web Fetch 工具，支持 LLM 获取网页内容 (#undefined)

### Other

- 大幅提升单测覆盖率，新增 40 个测试用例 ([#331](https://github.com/shenjingnan/zapmyco/pull/331))
- *(cli)* 移除 greet 示例命令 ([#329](https://github.com/shenjingnan/zapmyco/pull/329))

## [0.25.2](https://github.com/shenjingnan/zapmyco/compare/v0.25.1...v0.25.2) - 2026-05-30

### Other

- 优化安装文档结构和 Tabs 组件交互 ([#327](https://github.com/shenjingnan/zapmyco/pull/327))

## [0.25.1](https://github.com/shenjingnan/zapmyco/compare/v0.25.0...v0.25.1) - 2026-05-29

### Added

- *(datetime)* 引入 chrono 库重构日期时间处理 ([#323](https://github.com/shenjingnan/zapmyco/pull/323))
- *(sdk)* 完善 Anthropic SDK response 数据结构，新增缓存字段支持 ([#322](https://github.com/shenjingnan/zapmyco/pull/322))
- *(deps)* 将 anthropic-ai-sdk 替换为本地 vendor 的自维护 SDK ([#320](https://github.com/shenjingnan/zapmyco/pull/320))

### Other

- *(conversation)* 改进会话记录文件名格式，提升可读性 ([#324](https://github.com/shenjingnan/zapmyco/pull/324))

## [0.25.0](https://github.com/shenjingnan/zapmyco/compare/v0.24.3...v0.25.0) - 2026-05-29

### Added

- *(log)* 新增对话日志记录 — 持久化 LLM 请求/响应到 ~/.zapmyco/conversations/ ([#318](https://github.com/shenjingnan/zapmyco/pull/318))

## [0.24.3](https://github.com/shenjingnan/zapmyco/compare/v0.24.2...v0.24.3) - 2026-05-29

### Fixed

- *(uninstall)* 卸载时清理 shell 补全配置 ([#317](https://github.com/shenjingnan/zapmyco/pull/317))

## [0.24.2](https://github.com/shenjingnan/zapmyco/compare/v0.24.1...v0.24.2) - 2026-05-29

### Added

- *(cli)* 支持 zapmyco -v 显示版本号 ([#312](https://github.com/shenjingnan/zapmyco/pull/312))

### Fixed

- *(ci)* 为 CI 工作流添加显式权限声明 ([#314](https://github.com/shenjingnan/zapmyco/pull/314))

## [0.24.1](https://github.com/shenjingnan/zapmyco/compare/v0.24.0...v0.24.1) - 2026-05-29

### Added

- *(init)* 简化 init 流程 — 移除 API Key 二次确认并支持覆盖配置 ([#308](https://github.com/shenjingnan/zapmyco/pull/308))

### Other

- *(docs)* 将 LOGO 移至 Header 并更新站点 URL ([#311](https://github.com/shenjingnan/zapmyco/pull/311))
- 提升单测覆盖率 — 从 82 到 110 (+28 个新测试) ([#310](https://github.com/shenjingnan/zapmyco/pull/310))

## [0.24.0](https://github.com/shenjingnan/zapmyco/compare/v0.23.0...v0.24.0) - 2026-05-29

### Other

- 添加 settings.toml 配置参考文档并移除代码默认行为 ([#307](https://github.com/shenjingnan/zapmyco/pull/307))
- 将配置文件从 settings.json 迁移到 settings.toml ([#306](https://github.com/shenjingnan/zapmyco/pull/306))
- 添加拼写检查工具 typos 到 CI、pre-commit 和 check 脚本 ([#304](https://github.com/shenjingnan/zapmyco/pull/304))

## [0.23.0](https://github.com/shenjingnan/zapmyco/compare/v0.22.20...v0.23.0) - 2026-05-29

### Added

- *(cli)* 添加 uninstall 卸载命令 ([#298](https://github.com/shenjingnan/zapmyco/pull/298))

### Fixed

- *(cli)* 为 Commands 枚举添加 #[non_exhaustive] ([#300](https://github.com/shenjingnan/zapmyco/pull/300))
- *(cli)* 修复 Windows CI 因 inquire 交互提示导致测试卡住的问题 ([#301](https://github.com/shenjingnan/zapmyco/pull/301))

### Other

- 添加单测覆盖率 Codecov 徽标 ([#302](https://github.com/shenjingnan/zapmyco/pull/302))
- 增强 CLI 使用指南文档，补充 uninstall 命令和详细说明 ([#299](https://github.com/shenjingnan/zapmyco/pull/299))
- 简化 Windows 安装命令 ([#296](https://github.com/shenjingnan/zapmyco/pull/296))

## [0.22.20](https://github.com/shenjingnan/zapmyco/compare/v0.22.19...v0.22.20) - 2026-05-28

### Fixed

- 调整 Logo SVG 视口宽度使文字居中 ([#295](https://github.com/shenjingnan/zapmyco/pull/295))
- 修复 CI 中 rust-toolchain.toml 导致 rustfmt/clippy 组件不可用的问题 ([#293](https://github.com/shenjingnan/zapmyco/pull/293))

## [0.22.19](https://github.com/shenjingnan/zapmyco/compare/v0.22.18...v0.22.19) - 2026-05-28

### Other

- 清理 CHANGELOG.md 中残留的旧项目过期条目 ([#291](https://github.com/shenjingnan/zapmyco/pull/291))

## [0.22.18](https://github.com/shenjingnan/zapmyco/compare/v0.22.17...v0.22.18) - 2026-05-28

### Other

- 清理项目中残留的 Deno 引用 ([#290](https://github.com/shenjingnan/zapmyco/pull/290))
- 简化 README.md，移除已迁移至贡献指南的重复内容 ([#289](https://github.com/shenjingnan/zapmyco/pull/289))
- 更新安装脚本 URL 为 zapmyco.com ([#287](https://github.com/shenjingnan/zapmyco/pull/287))

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

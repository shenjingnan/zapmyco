# Changelog

## [Unreleased]

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

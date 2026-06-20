# Changelog

## [Unreleased]

## [0.42.1](https://github.com/shenjingnan/zapmyco/compare/v0.42.0...v0.42.1) - 2026-06-20

### Added

- *(web)* 添加 RawMessagePanel 原始消息面板组件 ([#469](https://github.com/shenjingnan/zapmyco/pull/469))

### Other

- update web dist for publish [skip ci]

## [0.42.0](https://github.com/shenjingnan/zapmyco/compare/v0.41.0...v0.42.0) - 2026-06-19

### Added

- *(web)* 配置 Storybook 并添加 AskUserCard 组件故事 ([#461](https://github.com/shenjingnan/zapmyco/pull/461))
- *(web)* 将 Web 前端构建产物嵌入 Rust 二进制文件 ([#459](https://github.com/shenjingnan/zapmyco/pull/459))
- *(shell-exec)* 实现工作目录自动跟踪并修复审批确认无限循环 ([#457](https://github.com/shenjingnan/zapmyco/pull/457))
- *(tui)* 实现 RunProgress 动态面板展示组件，改造 run 命令终端输出 ([#456](https://github.com/shenjingnan/zapmyco/pull/456))
- *(tui)* 添加基于 indicatif 的多条目进度显示组件 ([#455](https://github.com/shenjingnan/zapmyco/pull/455))
- *(plan)* 移除审批阶段 max_retries 限制，改为无限迭代 ([#452](https://github.com/shenjingnan/zapmyco/pull/452))
- *(cli)* 添加 --mode plan/base 执行模式，实现规划-审批-执行-总结四阶段流程 ([#450](https://github.com/shenjingnan/zapmyco/pull/450))
- *(session-log)* P2 实现 — events.log 用户交互记录 + ZAPMYCO\_LOG 日志级别 ([#445](https://github.com/shenjingnan/zapmyco/pull/445))
- *(session-log)* P1 实现 — SessionStats + SubAgent 关联 + session\_loader 兼容 ([#444](https://github.com/shenjingnan/zapmyco/pull/444))
- *(session-log)* 添加 session.json 元数据和 panic hook 增强会话日志 ([#443](https://github.com/shenjingnan/zapmyco/pull/443))
- *(logging)* 为 session 目录添加 app.log 应用执行日志 ([#442](https://github.com/shenjingnan/zapmyco/pull/442))
- *(shell-exec)* 增加始终允许选项，优化用户授权体验 ([#441](https://github.com/shenjingnan/zapmyco/pull/441))
- *(permission)* ReadOnly 模式下 shell_exec 降级 + SubAgent 权限继承 ([#440](https://github.com/shenjingnan/zapmyco/pull/440))
- *(agent)* 将 conversation 全面更名为 session ([#439](https://github.com/shenjingnan/zapmyco/pull/439))
- *(agent)* 添加工具调用日志记录功能 ([#438](https://github.com/shenjingnan/zapmyco/pull/438))
- *(run)* 每次 zapmyco run 创建会话子目录并记录终端输出 ([#435](https://github.com/shenjingnan/zapmyco/pull/435))
- *(output)* Phase 3 — 清理迁移桥接 RawStdout/RawStderr ([#427](https://github.com/shenjingnan/zapmyco/pull/427))
- *(output)* Phase 2 — 迁移全部模块到统一输出总线 ([#426](https://github.com/shenjingnan/zapmyco/pull/426))
- *(output)* 新增统一输出基础设施（Output Bus） ([#425](https://github.com/shenjingnan/zapmyco/pull/425))
- *(cli)* --skill 参数支持 Tab 补全可用 skill 名 ([#423](https://github.com/shenjingnan/zapmyco/pull/423))
- *(cli)* LLM 执行完成后支持用户继续交互 ([#421](https://github.com/shenjingnan/zapmyco/pull/421))
- *(shell-exec)* 内置绝对安全命令列表，自动放行无需用户确认 ([#415](https://github.com/shenjingnan/zapmyco/pull/415))
- *(subagent)* 新增 skill 参数支持，实现 Plan Mode 编排能力 ([#412](https://github.com/shenjingnan/zapmyco/pull/412))
- *(skills)* 实现 Skill 系统 — SKILL.md 解析、发现、工具和 CLI 集成 ([#409](https://github.com/shenjingnan/zapmyco/pull/409))
- *(subagent)* 实现 SubAgent 多 CLI 并发子代理工具 ([#408](https://github.com/shenjingnan/zapmyco/pull/408))
- *(run)* 移除任务执行5轮限制并添加 Ctrl+C 中断纠偏功能 ([#404](https://github.com/shenjingnan/zapmyco/pull/404))
- *(completion)* 移除位置参数补全使 Tab 始终显示选项列表 ([#401](https://github.com/shenjingnan/zapmyco/pull/401))
- *(completion)* 在 --model Tab 补全中显示供应商前缀 ([#400](https://github.com/shenjingnan/zapmyco/pull/400))
- *(completion)* 为 zsh 生成自定义补全脚本，修复 --model 补全描述显示问题 ([#398](https://github.com/shenjingnan/zapmyco/pull/398))
- *(run)* 优化 base-url 和 model 的 Tab 补全体验 ([#395](https://github.com/shenjingnan/zapmyco/pull/395))
- *(run)* 支持 --model/--api-key/--base-url 参数及 Tab 补全 ([#393](https://github.com/shenjingnan/zapmyco/pull/393))
- *(config)* 新增内建模型下线后的用户配置兼容方案 ([#391](https://github.com/shenjingnan/zapmyco/pull/391))
- *(config)* 完善内置模型列表并新增 baseUrl 配置项 ([#389](https://github.com/shenjingnan/zapmyco/pull/389))
- *(agent)* 优化系统提示词静态化与 KV Cache 缓存利用率，修复未知工具中断 ([#388](https://github.com/shenjingnan/zapmyco/pull/388))
- *(agent)* 支持工具并发调用以提升执行效率 ([#387](https://github.com/shenjingnan/zapmyco/pull/387))
- 在终端显示每轮对话的 token 用量和缓存命中率 ([#381](https://github.com/shenjingnan/zapmyco/pull/381))
- *(cli)* 添加权限模式和任务列表隔离功能 ([#379](https://github.com/shenjingnan/zapmyco/pull/379))
- *(logging)* 添加文件日志系统，默认记录到 ~/.zapmyco/logs/app.log ([#378](https://github.com/shenjingnan/zapmyco/pull/378))
- *(tools)* 任务列表改用事件流+检查点快照展示 ([#374](https://github.com/shenjingnan/zapmyco/pull/374))
- *(tools)* 实现 Task 任务管理系统 ([#373](https://github.com/shenjingnan/zapmyco/pull/373))
- *(tools)* 新增 ask_user 工具并提取共享 SelectPrompt 组件 ([#369](https://github.com/shenjingnan/zapmyco/pull/369))
- *(tools)* 新增 file_write 工具及预读检查机制 ([#367](https://github.com/shenjingnan/zapmyco/pull/367))
- *(tools)* 添加 Edit 工具支持本地文件文本替换编辑 ([#360](https://github.com/shenjingnan/zapmyco/pull/360))
- *(tools)* 添加 Glob 工具支持按文件名模式查找文件 ([#359](https://github.com/shenjingnan/zapmyco/pull/359))
- *(tools)* 添加 Read 工具支持读取本地文件内容 ([#357](https://github.com/shenjingnan/zapmyco/pull/357))
- *(tools)* 添加 Grep 工具支持在本地文件系统中搜索文件内容 ([#353](https://github.com/shenjingnan/zapmyco/pull/353))
- *(cli)* 添加 upgrade 命令，支持 zapmyco 自升级 ([#352](https://github.com/shenjingnan/zapmyco/pull/352))
- *(agent)* 添加联网搜索功能，支持 web_search_20250305 服务端工具 ([#345](https://github.com/shenjingnan/zapmyco/pull/345))
- *(cli)* 添加 note 子命令，支持快速记录笔记 ([#339](https://github.com/shenjingnan/zapmyco/pull/339))
- 添加 run_command 工具，支持 LLM 在本地执行 shell 命令 ([#335](https://github.com/shenjingnan/zapmyco/pull/335))
- 添加 Web Fetch 工具，支持 LLM 获取网页内容 (#undefined)
- *(datetime)* 引入 chrono 库重构日期时间处理 ([#323](https://github.com/shenjingnan/zapmyco/pull/323))
- *(sdk)* 完善 Anthropic SDK response 数据结构，新增缓存字段支持 ([#322](https://github.com/shenjingnan/zapmyco/pull/322))
- *(deps)* 将 anthropic-ai-sdk 替换为本地 vendor 的自维护 SDK ([#320](https://github.com/shenjingnan/zapmyco/pull/320))
- *(log)* 新增对话日志记录 — 持久化 LLM 请求/响应到 ~/.zapmyco/conversations/ ([#318](https://github.com/shenjingnan/zapmyco/pull/318))
- *(cli)* 添加 Shell Tab 自动补全支持 ([#315](https://github.com/shenjingnan/zapmyco/pull/315))
- *(cli)* 支持 zapmyco -v 显示版本号 ([#312](https://github.com/shenjingnan/zapmyco/pull/312))
- *(init)* 简化 init 流程 — 移除 API Key 二次确认并支持覆盖配置 ([#308](https://github.com/shenjingnan/zapmyco/pull/308))
- *(cli)* 添加 uninstall 卸载命令 ([#298](https://github.com/shenjingnan/zapmyco/pull/298))
- 引入 cargo-dist 优化跨平台发布流程 ([#276](https://github.com/shenjingnan/zapmyco/pull/276))
- 为 Release 页面添加安装引导模板 ([#272](https://github.com/shenjingnan/zapmyco/pull/272))
- 集成 release-plz 自动化发布流程 ([#252](https://github.com/shenjingnan/zapmyco/pull/252))
- *(ci)* 合并 macOS 和 Windows 测试任务为矩阵构建 ([#250](https://github.com/shenjingnan/zapmyco/pull/250))
- Rust 版基础骨架实现（CLI + Settings + Models） ([#248](https://github.com/shenjingnan/zapmyco/pull/248))
- *(cli)* 未知命令交互式重试提示 ([#247](https://github.com/shenjingnan/zapmyco/pull/247))
- *(cli)* init 命令升级为交互式初始化向导 ([#246](https://github.com/shenjingnan/zapmyco/pull/246))
- *(cli)* 内联内容支持流式输出并自动进入交互模式 ([#243](https://github.com/shenjingnan/zapmyco/pull/243))
- *(cli)* 集成 Commander.js 重构 CLI，修复非流式请求问题 ([#242](https://github.com/shenjingnan/zapmyco/pull/242))
- 支持可配置的 maxTokens，扩展内置模型注册表字段 ([#241](https://github.com/shenjingnan/zapmyco/pull/241))
- 重构 LLM 配置系统，支持多供应商和多模型配置档 ([#239](https://github.com/shenjingnan/zapmyco/pull/239))
- 新增 ~/.zapmyco/settings.json 集中管理 LLM 配置 ([#238](https://github.com/shenjingnan/zapmyco/pull/238))
- 为 install.sh 添加下载进度条 ([#237](https://github.com/shenjingnan/zapmyco/pull/237))
- GitHub Release 增加 SHA256 checksum 校验和安装指引 ([#211](https://github.com/shenjingnan/zapmyco/pull/211))
- 创建安装脚本，简化二进制安装命令 ([#208](https://github.com/shenjingnan/zapmyco/pull/208))
- GitHub Release 自动构建多平台二进制文件 ([#207](https://github.com/shenjingnan/zapmyco/pull/207))
- 新增 AI 对话模式和 CLI 交互原型 ([#205](https://github.com/shenjingnan/zapmyco/pull/205))
- 添加 CLI 命令行支持 ([#203](https://github.com/shenjingnan/zapmyco/pull/203))

### Fixed

- *(publish)* 修复 cargo publish 验证失败并支持前端产物打包 ([#462](https://github.com/shenjingnan/zapmyco/pull/462))
- *(web)* 修复 Web 模式下 ask_user 工具死锁问题 ([#460](https://github.com/shenjingnan/zapmyco/pull/460))
- *(ci)* 修复 Windows CI 上 test_poll_returns_completed_after_wait 竞态条件失败 ([#458](https://github.com/shenjingnan/zapmyco/pull/458))
- *(tools)* 标记 tools 模块为 doc(hidden) 避免 semver-checks 误报 ([#366](https://github.com/shenjingnan/zapmyco/pull/366))
- 添加 zapmyco-grep 依赖版本号以修复发布失败 ([#356](https://github.com/shenjingnan/zapmyco/pull/356))
- 恢复模块重构后的外部 API 兼容性，添加 pub use 重新导出 ([#350](https://github.com/shenjingnan/zapmyco/pull/350))
- 为 ToolHandler 枚举添加 #[non_exhaustive] 注解 ([#337](https://github.com/shenjingnan/zapmyco/pull/337))
- *(release-plz)* 仅对主包启用 git tag，避免 SDK tag 触发无效 release ([#333](https://github.com/shenjingnan/zapmyco/pull/333))
- 将 SDK 纳入 workspace 以支持发布到 crates.io ([#326](https://github.com/shenjingnan/zapmyco/pull/326))
- 为 vendor 依赖 zapmyco-anthropic-ai-sdk 添加 version 字段 ([#325](https://github.com/shenjingnan/zapmyco/pull/325))
- *(uninstall)* 卸载时清理 shell 补全配置 ([#317](https://github.com/shenjingnan/zapmyco/pull/317))
- *(ci)* 为 CI 工作流添加显式权限声明 ([#314](https://github.com/shenjingnan/zapmyco/pull/314))
- *(cli)* 为 Commands 枚举添加 #[non_exhaustive] ([#300](https://github.com/shenjingnan/zapmyco/pull/300))
- *(cli)* 修复 Windows CI 因 inquire 交互提示导致测试卡住的问题 ([#301](https://github.com/shenjingnan/zapmyco/pull/301))
- 调整 Logo SVG 视口宽度使文字居中 ([#295](https://github.com/shenjingnan/zapmyco/pull/295))
- 修复 CI 中 rust-toolchain.toml 导致 rustfmt/clippy 组件不可用的问题 ([#293](https://github.com/shenjingnan/zapmyco/pull/293))
- 添加 rust-toolchain.toml 锁定 Rust 工具链版本为 1.95 ([#285](https://github.com/shenjingnan/zapmyco/pull/285))
- *(ci)* 使用 PAT_TOKEN 替代 GITHUB_TOKEN 使 tag push 触发 cargo-dist ([#283](https://github.com/shenjingnan/zapmyco/pull/283))
- 修复 release 工作流中缺少 checkout 步骤导致触发 cargo-dist 失败的问题 ([#279](https://github.com/shenjingnan/zapmyco/pull/279))
- 修复 Release 模板路径和 gh 参数错误 ([#274](https://github.com/shenjingnan/zapmyco/pull/274))
- *(ci)* generate-checksums 添加 checkout 步骤避免 gh release upload 失败
- *(ci)* ARM64 交叉编译后使用 aarch64-linux-gnu-strip 而非 strip
- *(ci)* 限制默认 apt 源为 amd64 避免添加 arm64 后安全源 404
- *(ci)* 修复 ARM64 交叉编译 apt-get 安装 libssl-dev:arm64 失败
- *(ci)* 修复 ARM64 交叉编译缺少 OpenSSL 和 Windows 上传重试
- *(ci)* 修复 release-plz tag 检测机制，改用 releases output 而非 git describe
- *(release)* 修复 release-plz.toml 中 {version} 占位符语法，改为 Tera 模板 {{ version }}
- *(build)* 同步 Cargo.lock 版本号到 0.22.2 ([#262](https://github.com/shenjingnan/zapmyco/pull/262))
- *(release)* 删除异常的 v{version} tag 并回退版本号到 0.22.2
- *(ci)* 修复 release 工作流并发控制和权限问题 ([#260](https://github.com/shenjingnan/zapmyco/pull/260))
- *(test)* 修复 test_version_constant 硬编码版本号导致发布失败 ([#257](https://github.com/shenjingnan/zapmyco/pull/257))
- *(release)* 修正 release skill 为正确的触发发布流程 ([#254](https://github.com/shenjingnan/zapmyco/pull/254))
- *(ci)* 移除 CARGO_REGISTRY_TOKEN，启用 Trusted Publishing
- 修复 release-plz.toml 配置错误和测试隔离问题
- 升级 @anthropic-ai/sdk 至 v0.98 消除 punycode 弃用警告 ([#245](https://github.com/shenjingnan/zapmyco/pull/245))
- *(build)* 修复 npm 包 bin 路径和 shebang，解决 npx zapmyco 无法使用的问题 ([#244](https://github.com/shenjingnan/zapmyco/pull/244))
- *(release)* 在 git commit 前运行 deno fmt 以通过 pre-commit hook
- 移除 macOS 编译二进制的 UPX 压缩 ([#234](https://github.com/shenjingnan/zapmyco/pull/234))
- *(deploy)* 修复 Vercel 部署失败，从 npm 切换到 pnpm ([#225](https://github.com/shenjingnan/zapmyco/pull/225))
- pre-commit 类型检查增加 tools 目录 ([#222](https://github.com/shenjingnan/zapmyco/pull/222))
- generate-checksums job 缺少 checkout 导致 gh release upload 失败
- Windows CI 上 shasum 命令不存在导致 SHA256 计算失败 ([#212](https://github.com/shenjingnan/zapmyco/pull/212))
- 修复 Release workflow ARM64 二进制构建时 strip 失败的问题 ([#210](https://github.com/shenjingnan/zapmyco/pull/210))
- 移除 setup-node 的 cache:pnpm 配置
- npm 发布改用 pnpm publish 替代 npm publish
- 修复 npm/JSR 发布配置

### Other

- *(deps)* bump fs4 from 0.13.1 to 1.1.0 ([#420](https://github.com/shenjingnan/zapmyco/pull/420))
- *(deps)* bump time from 0.3.47 to 0.3.49 ([#447](https://github.com/shenjingnan/zapmyco/pull/447))
- *(deps)* bump ignore from 0.4.25 to 0.4.26 ([#417](https://github.com/shenjingnan/zapmyco/pull/417))
- *(deps)* bump mdka from 2.1.5 to 2.1.6 ([#419](https://github.com/shenjingnan/zapmyco/pull/419))
- *(deps)* bump rand from 0.8.6 to 0.9.4 ([#446](https://github.com/shenjingnan/zapmyco/pull/446))
- *(deps)* bump chrono from 0.4.44 to 0.4.45 ([#418](https://github.com/shenjingnan/zapmyco/pull/418))
- *(deps)* bump toml from 0.8.23 to 1.1.2+spec-1.1.0 ([#371](https://github.com/shenjingnan/zapmyco/pull/371))
- *(zapmyco)* release v0.41.0 ([#436](https://github.com/shenjingnan/zapmyco/pull/436))
- *(tui)* 提取 InlineInput 共享组件，统一单选/多选自定义输入行为 ([#454](https://github.com/shenjingnan/zapmyco/pull/454))
- *(skill)* 将 skill body 改为 user_message 注入，plan mode 提示词迁移到 SKILL.md ([#453](https://github.com/shenjingnan/zapmyco/pull/453))
- *(zapmyco)* release v0.40.0 ([#430](https://github.com/shenjingnan/zapmyco/pull/430))
- *(completion)* 为 zsh 位置参数过滤逻辑添加单测覆盖 ([#434](https://github.com/shenjingnan/zapmyco/pull/434))
- *(docs)* 重构文档目录结构，支持中英文 i18n 多语言 ([#433](https://github.com/shenjingnan/zapmyco/pull/433))
- *(cli)* 补充 note 命令测试覆盖 frontmatter 剥离和输出验证 ([#432](https://github.com/shenjingnan/zapmyco/pull/432))
- *(cli)* 将 CLI 命令参考拆分为独立 commands 目录 ([#431](https://github.com/shenjingnan/zapmyco/pull/431))
- *(cli)* 将子命令拆分为独立的 commands 模块 ([#429](https://github.com/shenjingnan/zapmyco/pull/429))
- *(zapmyco)* release v0.39.1 ([#424](https://github.com/shenjingnan/zapmyco/pull/424))
- 添加输出系统（Output Bus）设计文档 ([#428](https://github.com/shenjingnan/zapmyco/pull/428))
- *(zapmyco)* release v0.39.0 ([#414](https://github.com/shenjingnan/zapmyco/pull/414))
- *(deps)* bump codecov/codecov-action from 6 to 7 ([#416](https://github.com/shenjingnan/zapmyco/pull/416))
- *(skills)* 将 plan-mode 技能迁移为 plan 技能 ([#413](https://github.com/shenjingnan/zapmyco/pull/413))
- *(zapmyco)* release v0.38.0 ([#410](https://github.com/shenjingnan/zapmyco/pull/410))
- 添加 Skill 系统文档和内置工具文档 ([#411](https://github.com/shenjingnan/zapmyco/pull/411))
- *(zapmyco)* release v0.37.0 ([#407](https://github.com/shenjingnan/zapmyco/pull/407))
- *(conversation)* 补充 --conversation 功能的单元测试 ([#406](https://github.com/shenjingnan/zapmyco/pull/406))
- *(zapmyco)* release v0.36.4 ([#405](https://github.com/shenjingnan/zapmyco/pull/405))
- *(zapmyco)* release v0.36.3 ([#403](https://github.com/shenjingnan/zapmyco/pull/403))
- 将 built-in 文档目录迁移到 guide 同级 ([#402](https://github.com/shenjingnan/zapmyco/pull/402))
- *(zapmyco)* release v0.36.2 ([#399](https://github.com/shenjingnan/zapmyco/pull/399))
- *(zapmyco)* release v0.36.1 ([#396](https://github.com/shenjingnan/zapmyco/pull/396))
- *(readme)* 修正文档中内置模型数量与实际代码不一致的问题 ([#397](https://github.com/shenjingnan/zapmyco/pull/397))
- *(zapmyco)* release v0.36.0 ([#392](https://github.com/shenjingnan/zapmyco/pull/392))
- *(config)* 移除过时内置模型并优化文档 ([#394](https://github.com/shenjingnan/zapmyco/pull/394))
- release ([#386](https://github.com/shenjingnan/zapmyco/pull/386))
- 更新 README 项目描述和安装说明 ([#390](https://github.com/shenjingnan/zapmyco/pull/390))
- *(agent)* 添加工具流式处理的 20 个测试用例 ([#385](https://github.com/shenjingnan/zapmyco/pull/385))
- *(zapmyco)* release v0.34.0 ([#380](https://github.com/shenjingnan/zapmyco/pull/380))
- 将内置工具文档拆分为独立页面 ([#384](https://github.com/shenjingnan/zapmyco/pull/384))
- *(tools)* 简化 file_edit 模式并增强验证算法 ([#383](https://github.com/shenjingnan/zapmyco/pull/383))
- *(display)* 压缩工具调用日志为单行并添加分组概览 ([#382](https://github.com/shenjingnan/zapmyco/pull/382))
- release ([#377](https://github.com/shenjingnan/zapmyco/pull/377))
- *(deps)* bump reqwest from 0.12.28 to 0.13.4 ([#372](https://github.com/shenjingnan/zapmyco/pull/372))
- 移除交互式 REPL 模式，统一使用 run 子命令 ([#376](https://github.com/shenjingnan/zapmyco/pull/376))
- *(zapmyco)* release v0.32.2 ([#370](https://github.com/shenjingnan/zapmyco/pull/370))
- *(guide)* 更新内置工具文档，补充新增工具说明 ([#375](https://github.com/shenjingnan/zapmyco/pull/375))
- *(zapmyco)* release v0.32.1 ([#368](https://github.com/shenjingnan/zapmyco/pull/368))
- *(zapmyco)* release v0.32.0 ([#361](https://github.com/shenjingnan/zapmyco/pull/361))
- *(guide)* 同步内置工具命名到 domain_action 风格 ([#365](https://github.com/shenjingnan/zapmyco/pull/365))
- *(tools)* 统一工具命名为 domain_action 风格 ([#364](https://github.com/shenjingnan/zapmyco/pull/364))
- 重命名 FileRead 为 Read 以保持命名一致性 ([#363](https://github.com/shenjingnan/zapmyco/pull/363))
- *(guide)* 添加 Edit 工具文档说明 ([#362](https://github.com/shenjingnan/zapmyco/pull/362))
- *(zapmyco)* release v0.31.2 ([#358](https://github.com/shenjingnan/zapmyco/pull/358))
- *(zapmyco)* release v0.31.1 ([#355](https://github.com/shenjingnan/zapmyco/pull/355))
- *(built-in-tools)* 添加 Grep 内置工具文档 ([#354](https://github.com/shenjingnan/zapmyco/pull/354))
- *(zapmyco)* release v0.31.0 ([#351](https://github.com/shenjingnan/zapmyco/pull/351))
- *(zapmyco)* release v0.30.0 ([#349](https://github.com/shenjingnan/zapmyco/pull/349))
- *(src)* 重构模块目录结构，按领域分组源代码 ([#348](https://github.com/shenjingnan/zapmyco/pull/348))
- release ([#346](https://github.com/shenjingnan/zapmyco/pull/346))
- 添加内置工具文档，介绍 run 命令的 AI Agent 工具能力 ([#347](https://github.com/shenjingnan/zapmyco/pull/347))
- *(zapmyco)* release v0.29.1 ([#344](https://github.com/shenjingnan/zapmyco/pull/344))
- 更新 note 命令文档，适配 clap 枚举子命令重构 ([#343](https://github.com/shenjingnan/zapmyco/pull/343))
- *(zapmyco)* release v0.29.0 ([#342](https://github.com/shenjingnan/zapmyco/pull/342))
- *(cli)* [**breaking**] 将 note 子命令重构为 clap 枚举子命令 ([#341](https://github.com/shenjingnan/zapmyco/pull/341))
- *(zapmyco)* release v0.28.0 ([#338](https://github.com/shenjingnan/zapmyco/pull/338))
- 添加 tarpaulin 和 codecov 配置，排除 vendor 目录覆盖率统计 ([#340](https://github.com/shenjingnan/zapmyco/pull/340))
- *(zapmyco)* release v0.27.0 ([#336](https://github.com/shenjingnan/zapmyco/pull/336))
- *(zapmyco)* release v0.26.1 ([#334](https://github.com/shenjingnan/zapmyco/pull/334))
- release ([#330](https://github.com/shenjingnan/zapmyco/pull/330))
- 大幅提升单测覆盖率，新增 40 个测试用例 ([#331](https://github.com/shenjingnan/zapmyco/pull/331))
- *(cli)* 移除 greet 示例命令 ([#329](https://github.com/shenjingnan/zapmyco/pull/329))
- *(zapmyco)* release v0.25.2 ([#328](https://github.com/shenjingnan/zapmyco/pull/328))
- 优化安装文档结构和 Tabs 组件交互 ([#327](https://github.com/shenjingnan/zapmyco/pull/327))
- release v0.25.1 ([#321](https://github.com/shenjingnan/zapmyco/pull/321))
- *(conversation)* 改进会话记录文件名格式，提升可读性 ([#324](https://github.com/shenjingnan/zapmyco/pull/324))
- release v0.25.0 ([#319](https://github.com/shenjingnan/zapmyco/pull/319))
- release v0.24.3 ([#316](https://github.com/shenjingnan/zapmyco/pull/316))
- release v0.24.2 ([#313](https://github.com/shenjingnan/zapmyco/pull/313))
- release v0.24.1 ([#309](https://github.com/shenjingnan/zapmyco/pull/309))
- *(docs)* 将 LOGO 移至 Header 并更新站点 URL ([#311](https://github.com/shenjingnan/zapmyco/pull/311))
- 提升单测覆盖率 — 从 82 到 110 (+28 个新测试) ([#310](https://github.com/shenjingnan/zapmyco/pull/310))
- release v0.24.0 ([#305](https://github.com/shenjingnan/zapmyco/pull/305))
- 添加 settings.toml 配置参考文档并移除代码默认行为 ([#307](https://github.com/shenjingnan/zapmyco/pull/307))
- 将配置文件从 settings.json 迁移到 settings.toml ([#306](https://github.com/shenjingnan/zapmyco/pull/306))
- 添加拼写检查工具 typos 到 CI、pre-commit 和 check 脚本 ([#304](https://github.com/shenjingnan/zapmyco/pull/304))
- release v0.23.0 ([#303](https://github.com/shenjingnan/zapmyco/pull/303))
- 添加单测覆盖率 Codecov 徽标 ([#302](https://github.com/shenjingnan/zapmyco/pull/302))
- 增强 CLI 使用指南文档，补充 uninstall 命令和详细说明 ([#299](https://github.com/shenjingnan/zapmyco/pull/299))
- 简化 Windows 安装命令 ([#296](https://github.com/shenjingnan/zapmyco/pull/296))
- release v0.22.20 ([#294](https://github.com/shenjingnan/zapmyco/pull/294))
- release v0.22.19 ([#292](https://github.com/shenjingnan/zapmyco/pull/292))
- 清理 CHANGELOG.md 中残留的旧项目过期条目 ([#291](https://github.com/shenjingnan/zapmyco/pull/291))
- release v0.22.18 ([#288](https://github.com/shenjingnan/zapmyco/pull/288))
- 清理项目中残留的 Deno 引用 ([#290](https://github.com/shenjingnan/zapmyco/pull/290))
- 简化 README.md，移除已迁移至贡献指南的重复内容 ([#289](https://github.com/shenjingnan/zapmyco/pull/289))
- 更新安装脚本 URL 为 zapmyco.com ([#287](https://github.com/shenjingnan/zapmyco/pull/287))
- release v0.22.17 ([#286](https://github.com/shenjingnan/zapmyco/pull/286))
- release v0.22.16 ([#284](https://github.com/shenjingnan/zapmyco/pull/284))
- release v0.22.15 ([#282](https://github.com/shenjingnan/zapmyco/pull/282))
- *(ci)* 重构发布工作流，合并 cargo-dist 到 release.yml ([#281](https://github.com/shenjingnan/zapmyco/pull/281))
- release v0.22.14 ([#280](https://github.com/shenjingnan/zapmyco/pull/280))
- release v0.22.13 ([#278](https://github.com/shenjingnan/zapmyco/pull/278))
- 更新 release-plz 配置，移除 git_push_extra_args ([#277](https://github.com/shenjingnan/zapmyco/pull/277))
- release v0.22.12 ([#275](https://github.com/shenjingnan/zapmyco/pull/275))
- release v0.22.11 ([#273](https://github.com/shenjingnan/zapmyco/pull/273))
- release v0.22.10 ([#271](https://github.com/shenjingnan/zapmyco/pull/271))
- release v0.22.9 ([#270](https://github.com/shenjingnan/zapmyco/pull/270))
- release v0.22.8 ([#269](https://github.com/shenjingnan/zapmyco/pull/269))
- release v0.22.7 ([#268](https://github.com/shenjingnan/zapmyco/pull/268))
- release v0.22.6 ([#267](https://github.com/shenjingnan/zapmyco/pull/267))
- release v0.22.5 ([#266](https://github.com/shenjingnan/zapmyco/pull/266))
- release v0.22.4 ([#265](https://github.com/shenjingnan/zapmyco/pull/265))
- 添加 settings 模块的完整测试覆盖 ([#264](https://github.com/shenjingnan/zapmyco/pull/264))
- release v0.22.3 ([#263](https://github.com/shenjingnan/zapmyco/pull/263))
- *(ci)* 重命名 CI 工作流名称 ([#261](https://github.com/shenjingnan/zapmyco/pull/261))
- *(release)* 明确发布流程二阶段职责划分 ([#258](https://github.com/shenjingnan/zapmyco/pull/258))
- release v0.22.3 ([#256](https://github.com/shenjingnan/zapmyco/pull/256))
- *(release)* 将上下文获取命令抽取为独立脚本 ([#255](https://github.com/shenjingnan/zapmyco/pull/255))
- *(ci)* 合并 release-plz 与二进制构建为单一发布工作流 ([#253](https://github.com/shenjingnan/zapmyco/pull/253))
- 发布预检脚本添加 --allow-dirty 支持本地配置文件
- 将 Cargo.toml 版本号从 0.1.0 同步至 0.22.2 ([#251](https://github.com/shenjingnan/zapmyco/pull/251))
- *(deps)* bump inquire from 0.7.5 to 0.9.4 ([#249](https://github.com/shenjingnan/zapmyco/pull/249))
- *(release)* v0.22.2
- *(release)* v0.22.1
- *(release)* v0.22.0
- *(release)* v0.21.0
- *(deps)* bump actions/download-artifact from 7 to 8 ([#235](https://github.com/shenjingnan/zapmyco/pull/235))
- *(deps)* bump actions/upload-artifact from 6 to 7 ([#236](https://github.com/shenjingnan/zapmyco/pull/236))
- *(release)* v0.20.6
- *(release)* v0.20.5
- 添加跨平台安装脚本（Unix 和 Windows） ([#233](https://github.com/shenjingnan/zapmyco/pull/233))
- 将安装脚本移动到 docs 目录 ([#232](https://github.com/shenjingnan/zapmyco/pull/232))
- 徽标居中显示 ([#231](https://github.com/shenjingnan/zapmyco/pull/231))
- 移除 MDX 文件中的 H1 标题并修复徽标布局 ([#230](https://github.com/shenjingnan/zapmyco/pull/230))
- 简化 README 中贡献相关的内容 ([#229](https://github.com/shenjingnan/zapmyco/pull/229))
- 移除旧项目残留的过期文档文件 ([#228](https://github.com/shenjingnan/zapmyco/pull/228))
- *(docs)* 移动 logo.svg 到 docs/public 并去除白底 ([#227](https://github.com/shenjingnan/zapmyco/pull/227))
- *(deploy)* 将 Vercel 配置从根目录迁移到 docs 目录 ([#226](https://github.com/shenjingnan/zapmyco/pull/226))
- 使用 OpenManual 重构文档站点并配置 Vercel 部署 ([#224](https://github.com/shenjingnan/zapmyco/pull/224))
- 更新 README 为 zapmyco 项目信息并添加 Logo ([#223](https://github.com/shenjingnan/zapmyco/pull/223))
- *(release)* v0.20.4-beta.0
- *(skills)* 优化 release skill 使用脚本预执行发布 ([#221](https://github.com/shenjingnan/zapmyco/pull/221))
- *(skills)* 优化 resolve-git-conflicts 使用脚本预执行冲突检测 ([#220](https://github.com/shenjingnan/zapmyco/pull/220))
- *(skills)* 优化 commit-push-pr skill 使用脚本预执行上下文 ([#219](https://github.com/shenjingnan/zapmyco/pull/219))
- *(skills)* 优化 security-audit skill 使用脚本预执行审计 ([#218](https://github.com/shenjingnan/zapmyco/pull/218))
- *(skills)* 优化 build skill 使用脚本预执行构建 ([#217](https://github.com/shenjingnan/zapmyco/pull/217))
- *(skills)* 删除已迁移的旧技能文件 ([#216](https://github.com/shenjingnan/zapmyco/pull/216))
- *(skills)* 合并 lint/test/spellcheck/typecheck 为统一的 check 技能 ([#215](https://github.com/shenjingnan/zapmyco/pull/215))
- 更新技能和配置文件以适配 Deno 技术栈 ([#214](https://github.com/shenjingnan/zapmyco/pull/214))
- 将 .agents/commands 迁移为 skills ([#213](https://github.com/shenjingnan/zapmyco/pull/213))
- *(release)* v0.20.3
- 升级 upload-artifact/download-artifact 兼容 Node.js 24
- *(release)* v0.20.2
- *(release)* v0.20.1
- *(release)* v0.20.0
- *(release)* v0.19.2
- *(release)* v0.19.1
- 优化 deno compile 产物体积，引入 --no-check、strip 和 UPX 压缩 ([#209](https://github.com/shenjingnan/zapmyco/pull/209))
- *(release)* v0.19.0
- *(release)* v0.18.0
- *(release)* v0.17.2-beta.2
- 升级 pnpm/action-setup 至 v6 解决 Node 20 弃用告警
- *(release)* v0.17.2-beta.1
- *(release)* v0.17.2-beta.0
- *(release)* v0.17.2
- *(release)* v0.17.1
- *(release)* v0.17.0
- 移除 release-it，改用 Deno 原生发布脚本 + dnt 双发布 ([#206](https://github.com/shenjingnan/zapmyco/pull/206))
- 将项目从 Node.js/pnpm 迁移到 Deno/JSR ([#202](https://github.com/shenjingnan/zapmyco/pull/202))
- 初始化

## [0.41.0](https://github.com/shenjingnan/zapmyco/compare/v0.40.0...v0.41.0) - 2026-06-19

### Added

- *(web)* 将 Web 前端构建产物嵌入 Rust 二进制文件 ([#459](https://github.com/shenjingnan/zapmyco/pull/459))
- *(shell-exec)* 实现工作目录自动跟踪并修复审批确认无限循环 ([#457](https://github.com/shenjingnan/zapmyco/pull/457))
- *(tui)* 实现 RunProgress 动态面板展示组件，改造 run 命令终端输出 ([#456](https://github.com/shenjingnan/zapmyco/pull/456))
- *(tui)* 添加基于 indicatif 的多条目进度显示组件 ([#455](https://github.com/shenjingnan/zapmyco/pull/455))
- *(plan)* 移除审批阶段 max_retries 限制，改为无限迭代 ([#452](https://github.com/shenjingnan/zapmyco/pull/452))
- *(cli)* 添加 --mode plan/base 执行模式，实现规划-审批-执行-总结四阶段流程 ([#450](https://github.com/shenjingnan/zapmyco/pull/450))
- *(session-log)* P2 实现 — events.log 用户交互记录 + ZAPMYCO\_LOG 日志级别 ([#445](https://github.com/shenjingnan/zapmyco/pull/445))
- *(session-log)* P1 实现 — SessionStats + SubAgent 关联 + session\_loader 兼容 ([#444](https://github.com/shenjingnan/zapmyco/pull/444))
- *(session-log)* 添加 session.json 元数据和 panic hook 增强会话日志 ([#443](https://github.com/shenjingnan/zapmyco/pull/443))
- *(logging)* 为 session 目录添加 app.log 应用执行日志 ([#442](https://github.com/shenjingnan/zapmyco/pull/442))
- *(shell-exec)* 增加始终允许选项，优化用户授权体验 ([#441](https://github.com/shenjingnan/zapmyco/pull/441))
- *(permission)* ReadOnly 模式下 shell_exec 降级 + SubAgent 权限继承 ([#440](https://github.com/shenjingnan/zapmyco/pull/440))
- *(agent)* 将 conversation 全面更名为 session ([#439](https://github.com/shenjingnan/zapmyco/pull/439))
- *(agent)* 添加工具调用日志记录功能 ([#438](https://github.com/shenjingnan/zapmyco/pull/438))
- *(run)* 每次 zapmyco run 创建会话子目录并记录终端输出 ([#435](https://github.com/shenjingnan/zapmyco/pull/435))

### Fixed

- *(ci)* 修复 Windows CI 上 test_poll_returns_completed_after_wait 竞态条件失败 ([#458](https://github.com/shenjingnan/zapmyco/pull/458))

### Other

- *(tui)* 提取 InlineInput 共享组件，统一单选/多选自定义输入行为 ([#454](https://github.com/shenjingnan/zapmyco/pull/454))
- *(skill)* 将 skill body 改为 user_message 注入，plan mode 提示词迁移到 SKILL.md ([#453](https://github.com/shenjingnan/zapmyco/pull/453))

## [0.40.0](https://github.com/shenjingnan/zapmyco/compare/v0.39.1...v0.40.0) - 2026-06-11

### Other

- *(completion)* 为 zsh 位置参数过滤逻辑添加单测覆盖 ([#434](https://github.com/shenjingnan/zapmyco/pull/434))
- *(docs)* 重构文档目录结构，支持中英文 i18n 多语言 ([#433](https://github.com/shenjingnan/zapmyco/pull/433))
- *(cli)* 补充 note 命令测试覆盖 frontmatter 剥离和输出验证 ([#432](https://github.com/shenjingnan/zapmyco/pull/432))
- *(cli)* 将 CLI 命令参考拆分为独立 commands 目录 ([#431](https://github.com/shenjingnan/zapmyco/pull/431))
- *(cli)* 将子命令拆分为独立的 commands 模块 ([#429](https://github.com/shenjingnan/zapmyco/pull/429))

## [0.39.1](https://github.com/shenjingnan/zapmyco/compare/v0.39.0...v0.39.1) - 2026-06-09

### Added

- *(output)* Phase 3 — 清理迁移桥接 RawStdout/RawStderr ([#427](https://github.com/shenjingnan/zapmyco/pull/427))
- *(output)* Phase 2 — 迁移全部模块到统一输出总线 ([#426](https://github.com/shenjingnan/zapmyco/pull/426))
- *(output)* 新增统一输出基础设施（Output Bus） ([#425](https://github.com/shenjingnan/zapmyco/pull/425))
- *(cli)* --skill 参数支持 Tab 补全可用 skill 名 ([#423](https://github.com/shenjingnan/zapmyco/pull/423))

### Other

- 添加输出系统（Output Bus）设计文档 ([#428](https://github.com/shenjingnan/zapmyco/pull/428))

## [0.39.0](https://github.com/shenjingnan/zapmyco/compare/v0.38.0...v0.39.0) - 2026-06-09

### Added

- *(cli)* LLM 执行完成后支持用户继续交互 ([#421](https://github.com/shenjingnan/zapmyco/pull/421))
- *(shell-exec)* 内置绝对安全命令列表，自动放行无需用户确认 ([#415](https://github.com/shenjingnan/zapmyco/pull/415))

### Other

- *(deps)* bump codecov/codecov-action from 6 to 7 ([#416](https://github.com/shenjingnan/zapmyco/pull/416))
- *(skills)* 将 plan-mode 技能迁移为 plan 技能 ([#413](https://github.com/shenjingnan/zapmyco/pull/413))

## [0.38.0](https://github.com/shenjingnan/zapmyco/compare/v0.37.0...v0.38.0) - 2026-06-07

### Added

- *(subagent)* 新增 skill 参数支持，实现 Plan Mode 编排能力 ([#412](https://github.com/shenjingnan/zapmyco/pull/412))
- *(skills)* 实现 Skill 系统 — SKILL.md 解析、发现、工具和 CLI 集成 ([#409](https://github.com/shenjingnan/zapmyco/pull/409))

### Other

- 添加 Skill 系统文档和内置工具文档 ([#411](https://github.com/shenjingnan/zapmyco/pull/411))

## [0.37.0](https://github.com/shenjingnan/zapmyco/compare/v0.36.4...v0.37.0) - 2026-06-06

### Added

- *(subagent)* 实现 SubAgent 多 CLI 并发子代理工具 ([#408](https://github.com/shenjingnan/zapmyco/pull/408))

### Other

- *(conversation)* 补充 --conversation 功能的单元测试 ([#406](https://github.com/shenjingnan/zapmyco/pull/406))

## [0.36.4](https://github.com/shenjingnan/zapmyco/compare/v0.36.3...v0.36.4) - 2026-06-05

### Added

- *(run)* 移除任务执行5轮限制并添加 Ctrl+C 中断纠偏功能 ([#404](https://github.com/shenjingnan/zapmyco/pull/404))

## [0.36.3](https://github.com/shenjingnan/zapmyco/compare/v0.36.2...v0.36.3) - 2026-06-05

### Added

- *(completion)* 移除位置参数补全使 Tab 始终显示选项列表 ([#401](https://github.com/shenjingnan/zapmyco/pull/401))
- *(completion)* 在 --model Tab 补全中显示供应商前缀 ([#400](https://github.com/shenjingnan/zapmyco/pull/400))

### Other

- 将 built-in 文档目录迁移到 guide 同级 ([#402](https://github.com/shenjingnan/zapmyco/pull/402))

## [0.36.2](https://github.com/shenjingnan/zapmyco/compare/v0.36.1...v0.36.2) - 2026-06-05

### Added

- *(completion)* 为 zsh 生成自定义补全脚本，修复 --model 补全描述显示问题 ([#398](https://github.com/shenjingnan/zapmyco/pull/398))

## [0.36.1](https://github.com/shenjingnan/zapmyco/compare/v0.36.0...v0.36.1) - 2026-06-05

### Added

- *(run)* 优化 base-url 和 model 的 Tab 补全体验 ([#395](https://github.com/shenjingnan/zapmyco/pull/395))

### Other

- *(readme)* 修正文档中内置模型数量与实际代码不一致的问题 ([#397](https://github.com/shenjingnan/zapmyco/pull/397))

## [0.36.0](https://github.com/shenjingnan/zapmyco/compare/v0.35.0...v0.36.0) - 2026-06-05

### Added

- *(run)* 支持 --model/--api-key/--base-url 参数及 Tab 补全 ([#393](https://github.com/shenjingnan/zapmyco/pull/393))
- *(config)* 新增内建模型下线后的用户配置兼容方案 ([#391](https://github.com/shenjingnan/zapmyco/pull/391))

### Other

- *(config)* 移除过时内置模型并优化文档 ([#394](https://github.com/shenjingnan/zapmyco/pull/394))

## [0.35.0](https://github.com/shenjingnan/zapmyco/compare/v0.34.0...v0.35.0) - 2026-06-04

### Added

- *(config)* 完善内置模型列表并新增 baseUrl 配置项 ([#389](https://github.com/shenjingnan/zapmyco/pull/389))
- *(agent)* 优化系统提示词静态化与 KV Cache 缓存利用率，修复未知工具中断 ([#388](https://github.com/shenjingnan/zapmyco/pull/388))
- *(agent)* 支持工具并发调用以提升执行效率 ([#387](https://github.com/shenjingnan/zapmyco/pull/387))

### Other

- 更新 README 项目描述和安装说明 ([#390](https://github.com/shenjingnan/zapmyco/pull/390))
- *(agent)* 添加工具流式处理的 20 个测试用例 ([#385](https://github.com/shenjingnan/zapmyco/pull/385))

## [0.34.0](https://github.com/shenjingnan/zapmyco/compare/v0.33.0...v0.34.0) - 2026-06-03

### Added

- 在终端显示每轮对话的 token 用量和缓存命中率 ([#381](https://github.com/shenjingnan/zapmyco/pull/381))
- *(cli)* 添加权限模式和任务列表隔离功能 ([#379](https://github.com/shenjingnan/zapmyco/pull/379))

### Other

- 将内置工具文档拆分为独立页面 ([#384](https://github.com/shenjingnan/zapmyco/pull/384))
- *(tools)* 简化 file_edit 模式并增强验证算法 ([#383](https://github.com/shenjingnan/zapmyco/pull/383))
- *(display)* 压缩工具调用日志为单行并添加分组概览 ([#382](https://github.com/shenjingnan/zapmyco/pull/382))

## [0.33.0](https://github.com/shenjingnan/zapmyco/compare/v0.32.2...v0.33.0) - 2026-06-03

### Added

- *(logging)* 添加文件日志系统，默认记录到 ~/.zapmyco/logs/app.log ([#378](https://github.com/shenjingnan/zapmyco/pull/378))

### Other

- *(deps)* bump reqwest from 0.12.28 to 0.13.4 ([#372](https://github.com/shenjingnan/zapmyco/pull/372))
- 移除交互式 REPL 模式，统一使用 run 子命令 ([#376](https://github.com/shenjingnan/zapmyco/pull/376))

## [0.32.2](https://github.com/shenjingnan/zapmyco/compare/v0.32.1...v0.32.2) - 2026-06-02

### Added

- *(tools)* 任务列表改用事件流+检查点快照展示 ([#374](https://github.com/shenjingnan/zapmyco/pull/374))
- *(tools)* 实现 Task 任务管理系统 ([#373](https://github.com/shenjingnan/zapmyco/pull/373))
- *(tools)* 新增 ask_user 工具并提取共享 SelectPrompt 组件 ([#369](https://github.com/shenjingnan/zapmyco/pull/369))

### Other

- *(guide)* 更新内置工具文档，补充新增工具说明 ([#375](https://github.com/shenjingnan/zapmyco/pull/375))

## [0.32.1](https://github.com/shenjingnan/zapmyco/compare/v0.32.0...v0.32.1) - 2026-06-01

### Added

- *(tools)* 新增 file_write 工具及预读检查机制 ([#367](https://github.com/shenjingnan/zapmyco/pull/367))

## [0.32.0](https://github.com/shenjingnan/zapmyco/compare/v0.31.2...v0.32.0) - 2026-06-01

### Added

- *(tools)* 添加 Edit 工具支持本地文件文本替换编辑 ([#360](https://github.com/shenjingnan/zapmyco/pull/360))

### Fixed

- *(tools)* 标记 tools 模块为 doc(hidden) 避免 semver-checks 误报 ([#366](https://github.com/shenjingnan/zapmyco/pull/366))

### Other

- *(guide)* 同步内置工具命名到 domain_action 风格 ([#365](https://github.com/shenjingnan/zapmyco/pull/365))
- *(tools)* 统一工具命名为 domain_action 风格 ([#364](https://github.com/shenjingnan/zapmyco/pull/364))
- 重命名 FileRead 为 Read 以保持命名一致性 ([#363](https://github.com/shenjingnan/zapmyco/pull/363))
- *(guide)* 添加 Edit 工具文档说明 ([#362](https://github.com/shenjingnan/zapmyco/pull/362))

## [0.31.2](https://github.com/shenjingnan/zapmyco/compare/v0.31.1...v0.31.2) - 2026-05-31

### Added

- *(tools)* 添加 Glob 工具支持按文件名模式查找文件 ([#359](https://github.com/shenjingnan/zapmyco/pull/359))
- *(tools)* 添加 Read 工具支持读取本地文件内容 ([#357](https://github.com/shenjingnan/zapmyco/pull/357))

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

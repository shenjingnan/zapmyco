# Changelog

## [0.16.0](https://github.com/shenjingnan/zapmyco/compare/v0.15.0...v0.16.0) (2026-05-20)

### Features

* **agent-team:** 添加 Coordinator 模式支持 ([#147](https://github.com/shenjingnan/zapmyco/issues/147)) ([a7e89ba](https://github.com/shenjingnan/zapmyco/commit/a7e89bab12781432947f9e50607004232c840a48))
* **cli:** Agent 工具调用历史记录与输出阶段优化 ([#140](https://github.com/shenjingnan/zapmyco/issues/140)) ([6ba3eba](https://github.com/shenjingnan/zapmyco/commit/6ba3eba0e1a007e86b99ba52b16c141cc8f00e11))
* **llm:** 增强提供商支持并重构Agent运行时事件系统 ([#161](https://github.com/shenjingnan/zapmyco/issues/161)) ([146ffc0](https://github.com/shenjingnan/zapmyco/commit/146ffc0d954f2500a81f5995f58e10b35742a368))
* **llm:** 集成 Anthropic SDK 作为新的 LLM 提供商 ([#158](https://github.com/shenjingnan/zapmyco/issues/158)) ([0844d54](https://github.com/shenjingnan/zapmyco/commit/0844d54ab9e69436955295f8fbcbc357324ff38e))
* **repl:** 使用 AnimationManager 替代 setInterval 驱动动画 ([#154](https://github.com/shenjingnan/zapmyco/issues/154)) ([cb436cb](https://github.com/shenjingnan/zapmyco/commit/cb436cb816357ddd8490f64e281bfced2551b7b8))
* **repl:** 将打开外部编辑器快捷键改为 Ctrl+G ([#149](https://github.com/shenjingnan/zapmyco/issues/149)) ([9501731](https://github.com/shenjingnan/zapmyco/commit/95017311410d873c1e1507fb1ed72c7d0d52a98a))

### Bug Fixes

* **lsp:** 修复 isStopping 标志设置过早导致退出通知未发送的问题 ([#141](https://github.com/shenjingnan/zapmyco/issues/141)) ([4a72179](https://github.com/shenjingnan/zapmyco/commit/4a721794e2937ba736402e591e97dd64bb2dc6ad))
* **repl:** /clear 命令增加清空任务列表逻辑 ([#152](https://github.com/shenjingnan/zapmyco/issues/152)) ([4d9b771](https://github.com/shenjingnan/zapmyco/commit/4d9b77133e65227289c003888e3d8ad3d5c25aef))

### Performance Improvements

* **agent-runtime:** 定期让出事件循环以优化 TUI 响应 ([#153](https://github.com/shenjingnan/zapmyco/issues/153)) ([b9ee8de](https://github.com/shenjingnan/zapmyco/commit/b9ee8de7912a109dd8855b5d3cc260eaf473aaed))

### Code Refactoring

* **core:** 剥离 pi-ai 依赖，使用本地 Model 类型替代 ([#163](https://github.com/shenjingnan/zapmyco/issues/163)) ([3a09121](https://github.com/shenjingnan/zapmyco/commit/3a09121c5a65a04fe6642eb951bee6cfc7036e67))
* **core:** 提取工具参数验证为独立模块 ([#155](https://github.com/shenjingnan/zapmyco/issues/155)) ([0abe05a](https://github.com/shenjingnan/zapmyco/commit/0abe05af5f7b1c564b17a1506358983fb4b4a703))
* **core:** 替换 pi-ai complete 为 anthropic-provider ([#159](https://github.com/shenjingnan/zapmyco/issues/159)) ([91019ff](https://github.com/shenjingnan/zapmyco/commit/91019ff4b0ea8b18026529c9af0e6dda1c743407))
* **core:** 替换 pi-ai 外部类型依赖为本地兼容类型 ([#160](https://github.com/shenjingnan/zapmyco/issues/160)) ([90d0e0c](https://github.com/shenjingnan/zapmyco/commit/90d0e0c4b9fea7aa106e92b217845b0c7f5c4a9a))
* **llm:** 移除 pi-ai 运行时依赖，改用内置模型注册表 ([#162](https://github.com/shenjingnan/zapmyco/issues/162)) ([8bfafce](https://github.com/shenjingnan/zapmyco/commit/8bfafce66f1280c02f057a9a5d71497ff5cda191))
* **repl:** 简化 UI 键盘快捷键，移除冗余切换功能 ([#148](https://github.com/shenjingnan/zapmyco/issues/148)) ([8f7c227](https://github.com/shenjingnan/zapmyco/commit/8f7c22775f9a2507ff9927c4b40dac57d02e642e))
* **ui:** 优化 Agent 状态栏图标与活动描述 ([#150](https://github.com/shenjingnan/zapmyco/issues/150)) ([13f3b60](https://github.com/shenjingnan/zapmyco/commit/13f3b603832edaad94256ba9aea82c2f16e7316b))

## [0.15.0](https://github.com/shenjingnan/zapmyco/compare/v0.14.0...v0.15.0) (2026-05-18)

### Features

* **agent:** transformContext 支持 summary 角色消息转为 user 消息 ([#132](https://github.com/shenjingnan/zapmyco/issues/132)) ([25f37ea](https://github.com/shenjingnan/zapmyco/commit/25f37ea2035c0b38c2d613bbd5cc7e23585bce19))
* **cli:** 优化 Token 统计显示，新增缓存命中率和耗时 ([#128](https://github.com/shenjingnan/zapmyco/issues/128)) ([69b7ea0](https://github.com/shenjingnan/zapmyco/commit/69b7ea096f73e66e28f92bb9240189c62741a1db))
* **context:** 在压缩摘要中记录技能调用信息 ([#133](https://github.com/shenjingnan/zapmyco/issues/133)) ([fead8a8](https://github.com/shenjingnan/zapmyco/commit/fead8a8532c4f6de9601e5f96d31492253f3c68f))
* **core:** 增强核心模块日志可观测性 ([#137](https://github.com/shenjingnan/zapmyco/issues/137)) ([df6ebb3](https://github.com/shenjingnan/zapmyco/commit/df6ebb3e76b17bab3d489603e2d4dd3d5064b020))
* **core:** 添加 Agent 执行链路日志追踪 ([#136](https://github.com/shenjingnan/zapmyco/issues/136)) ([5e10299](https://github.com/shenjingnan/zapmyco/commit/5e10299a1783cdf79e8a7b5ebe4ea6a0ff7ab892))
* **core:** 添加 LLM 调用超时与子 Agent 进度监控 ([#139](https://github.com/shenjingnan/zapmyco/issues/139)) ([9d84c46](https://github.com/shenjingnan/zapmyco/commit/9d84c46426892314ccab27c713e4a8ba6cf98c0e))
* **repl:** /clear 命令改为清空 Agent 会话上下文 ([#135](https://github.com/shenjingnan/zapmyco/issues/135)) ([08408d8](https://github.com/shenjingnan/zapmyco/commit/08408d8bbefdbf8d271bef3a0a2ebe12f8e2c5d3))
* **repl:** 技能文件热重载支持 ([#134](https://github.com/shenjingnan/zapmyco/issues/134)) ([091cd4b](https://github.com/shenjingnan/zapmyco/commit/091cd4bf9e1e827aef60478e44ee8f4fbeebb1e6))
* **skill-tool:** 新增 Shell 命令执行 (! 语法) 支持 ([#130](https://github.com/shenjingnan/zapmyco/issues/130)) ([3733ea1](https://github.com/shenjingnan/zapmyco/commit/3733ea1076703c45be078028b61df51bc36693f8))

### Code Refactoring

* **agent-runtime:** 技能提示改为增量发送机制 ([#131](https://github.com/shenjingnan/zapmyco/issues/131)) ([76198b6](https://github.com/shenjingnan/zapmyco/commit/76198b684ee1fc5bfb9625dc0ac9e387a4b8cfb5))
* **core:** 将子 Agent 超时机制迁移至 Agent 内部实现 ([#138](https://github.com/shenjingnan/zapmyco/issues/138)) ([9b5e761](https://github.com/shenjingnan/zapmyco/commit/9b5e76187fbb5e616fa13ada2b95a0a26109cca0))

## [0.14.0](https://github.com/shenjingnan/zapmyco/compare/v0.13.0...v0.14.0) (2026-05-15)

### Features

* **cli:** 技能执行时显示技能名称而非展开内容 ([#126](https://github.com/shenjingnan/zapmyco/issues/126)) ([db60847](https://github.com/shenjingnan/zapmyco/commit/db60847bdd5e80a57c5da66641a2b8789bda9ddd))
* **cli:** 新增 Agent 状态栏实时显示子代理运行状态 ([#115](https://github.com/shenjingnan/zapmyco/issues/115)) ([499f51f](https://github.com/shenjingnan/zapmyco/commit/499f51f9d02add637b15d22cbac758850762337a))
* **cli:** 新增 Markdown 格式化的 ANSI 终端输出 ([#122](https://github.com/shenjingnan/zapmyco/issues/122)) ([824b968](https://github.com/shenjingnan/zapmyco/commit/824b968664d90837c637fdb543b65373d21933cf))
* **security:** normal 模式默认放行工具，仅内容级安全检查触发审批 ([#117](https://github.com/shenjingnan/zapmyco/issues/117)) ([8fc8e27](https://github.com/shenjingnan/zapmyco/commit/8fc8e27abe9ca5d2d8c600e4d5cefd025422f635))
* **tui:** 新增 TaskStatusBar 组件与 TaskStore 变更通知机制 ([#116](https://github.com/shenjingnan/zapmyco/issues/116)) ([2c239c8](https://github.com/shenjingnan/zapmyco/commit/2c239c8be90638d23d884f1615be56a3839cab8e)), closes [#N](https://github.com/shenjingnan/zapmyco/issues/N)

### Bug Fixes

* **cli:** 过滤 TaskManage 工具调用在 OutputArea 的重复显示 ([#118](https://github.com/shenjingnan/zapmyco/issues/118)) ([90085b5](https://github.com/shenjingnan/zapmyco/commit/90085b5cd8da99eba1a851fc6fbea60afdc4f9c4))

### Performance Improvements

* **repl:** 斜杠命令触发技能时内联展开内容 ([#125](https://github.com/shenjingnan/zapmyco/issues/125)) ([87982ce](https://github.com/shenjingnan/zapmyco/commit/87982ce1af28d3b4058df8658960e22ec34f16c2))

### Code Refactoring

* **agents:** 将 commands 转换为 skills 格式 ([#123](https://github.com/shenjingnan/zapmyco/issues/123)) ([7005ed3](https://github.com/shenjingnan/zapmyco/commit/7005ed38fc76eeaea76b6c032667ccebe476aa23))
* **cli:** 优化 thinking 到响应模式的过渡显示 ([#127](https://github.com/shenjingnan/zapmyco/issues/127)) ([f5f7a99](https://github.com/shenjingnan/zapmyco/commit/f5f7a992f876fa28d22616e2b348ab3594a0f3ce))
* **cli:** 将 Agent 状态栏快捷键从 Ctrl+O 改为 Ctrl+Shift+O ([#124](https://github.com/shenjingnan/zapmyco/issues/124)) ([df2fd68](https://github.com/shenjingnan/zapmyco/commit/df2fd68870cdb240606cf6c164c9737c76b1b58d))
* **core:** 改进 Exec 工具显示为前缀格式 ([#120](https://github.com/shenjingnan/zapmyco/issues/120)) ([37add72](https://github.com/shenjingnan/zapmyco/commit/37add721d583c921d89e618301cd9d2ed4d4998c))

## [0.13.0](https://github.com/shenjingnan/zapmyco/compare/v0.12.0...v0.13.0) (2026-05-14)

### Features

* **agent-team:** 支持子 Agent 按类型路由模型 ([#113](https://github.com/shenjingnan/zapmyco/issues/113)) ([4cb6071](https://github.com/shenjingnan/zapmyco/commit/4cb6071b65e3382ce1d22243d67085933c648dc4))
* **agent:** 新增 thinking/reasoning 展示与日志支持 ([#107](https://github.com/shenjingnan/zapmyco/issues/107)) ([5ac1e35](https://github.com/shenjingnan/zapmyco/commit/5ac1e359f8f79ea5fbaaaf83c93538e24d2fda3c))
* **cli:** 优化 Exec 工具执行状态显示 ([#109](https://github.com/shenjingnan/zapmyco/issues/109)) ([8431ea6](https://github.com/shenjingnan/zapmyco/commit/8431ea6a792db192a38da07c51b7a1a450a30072))
* **cli:** 将审批弹窗改为编辑器内联审批面板 ([#108](https://github.com/shenjingnan/zapmyco/issues/108)) ([a8d1fef](https://github.com/shenjingnan/zapmyco/commit/a8d1fef1786f471c52f8684391a23fdc7ec23d3d))
* **cli:** 新增 thinking 内容折叠/展开/隐藏三种展示模式 ([#111](https://github.com/shenjingnan/zapmyco/issues/111)) ([0f4ea37](https://github.com/shenjingnan/zapmyco/commit/0f4ea37248f530b226d8a8263548ad6e24610c3e))
* **cli:** 简化审批对话框并优化交互体验 ([#102](https://github.com/shenjingnan/zapmyco/issues/102)) ([998de9a](https://github.com/shenjingnan/zapmyco/commit/998de9aa040f5e7794c6180e07df73fb8c66b31e))
* **core:** 添加 Prompt Cache 支持与优化 ([#110](https://github.com/shenjingnan/zapmyco/issues/110)) ([3a702ca](https://github.com/shenjingnan/zapmyco/commit/3a702ca04d2204db9b026f0b442a730203feb65b))
* **infra:** 改进错误日志记录，消除静默异常捕获 ([#105](https://github.com/shenjingnan/zapmyco/issues/105)) ([017b3a3](https://github.com/shenjingnan/zapmyco/commit/017b3a30677ebac3f7c41856027b6c2b6c4b4de0))
* 使用 matchesKey 替代字符串比较处理键盘输入 ([#99](https://github.com/shenjingnan/zapmyco/issues/99)) ([ca28ac7](https://github.com/shenjingnan/zapmyco/commit/ca28ac7e6a34fd70aa2e7012993a1b494382b84a))
* 安全审计增强、对话日志与子Agent监控 ([#97](https://github.com/shenjingnan/zapmyco/issues/97)) ([0727774](https://github.com/shenjingnan/zapmyco/commit/0727774dc620e1ecfdf0bc8c3bb3512c09a31814))
* 新增缓存 Token 追踪与会话日志记录功能 ([#100](https://github.com/shenjingnan/zapmyco/issues/100)) ([7fae463](https://github.com/shenjingnan/zapmyco/commit/7fae4633edde2885c44837fa01af9908b14da357))

### Code Refactoring

* **cli:** 移除聊天前缀并优化欢迎语显示 ([#106](https://github.com/shenjingnan/zapmyco/issues/106)) ([68a35b4](https://github.com/shenjingnan/zapmyco/commit/68a35b412e6ef1a16bb5dfe4c7d870935a28afb8))
* **llm:** 整合 Provider 层，移除独立接口与适配器文件 ([#104](https://github.com/shenjingnan/zapmyco/issues/104)) ([00949b6](https://github.com/shenjingnan/zapmyco/commit/00949b63c791007ba34eec98c6bf745711f146a0))

### Documentation

* **skill:** 完善 commit-push-pr 技能的提交格式规范 ([#101](https://github.com/shenjingnan/zapmyco/issues/101)) ([e9ab8bb](https://github.com/shenjingnan/zapmyco/commit/e9ab8bb6e4b3b04dd048f23fde38bd74aa31c25b))

## [0.12.0](https://github.com/shenjingnan/zapmyco/compare/v0.11.0...v0.12.0) (2026-05-13)

### Features

* **cli:** 移除所有 '/' 命令的别名 ([#91](https://github.com/shenjingnan/zapmyco/issues/91)) ([ae87748](https://github.com/shenjingnan/zapmyco/commit/ae877483bbb32942797dd475805620fa07ce7559))
* **settings:** 支持在 /settings 中配置视觉模型、轻量模型和分析模型 ([#90](https://github.com/shenjingnan/zapmyco/issues/90)) ([560c275](https://github.com/shenjingnan/zapmyco/commit/560c2755926b21b00d7d0720ccf805e4598304d1))
* **skill:** 支持从 .agents/skills/ 路径加载项目级技能 ([#92](https://github.com/shenjingnan/zapmyco/issues/92)) ([ac4a6e4](https://github.com/shenjingnan/zapmyco/commit/ac4a6e45bde4932869272f163348512278fa9426))

### Documentation

* 更新 commit-push-pr 技能中的 Attribution 品牌引用 ([#93](https://github.com/shenjingnan/zapmyco/issues/93)) ([4c1f487](https://github.com/shenjingnan/zapmyco/commit/4c1f48728c1da3f62253b47def020d2be47868d1))

## [0.11.0](https://github.com/shenjingnan/zapmyco/compare/v0.10.0...v0.11.0) (2026-05-12)

### Features

* **llm:** 新增多模型分层配置支持（分析/轻量/视觉） ([#89](https://github.com/shenjingnan/zapmyco/issues/89)) ([632704e](https://github.com/shenjingnan/zapmyco/commit/632704e525975bc35701bb1edf611a3d35e57e22))

### Bug Fixes

* **worktree:** 修复 baseDir 空字符串导致 REPL 启动失败 ([#88](https://github.com/shenjingnan/zapmyco/issues/88)) ([5ad0d4f](https://github.com/shenjingnan/zapmyco/commit/5ad0d4fc76b2b301d4daace17cf4d06408ad969c))

## [0.10.0](https://github.com/shenjingnan/zapmyco/compare/v0.9.0...v0.10.0) (2026-05-12)

### Features

* **agent-team:** 实现后台异步 Agent 执行 (run_in_background) ([#77](https://github.com/shenjingnan/zapmyco/issues/77)) ([40e08f0](https://github.com/shenjingnan/zapmyco/commit/40e08f024f5394535164d1a79dda02eabb40b132))
* **lsp:** 实现 Phase 4 LSP 代码智能——三层架构语义级代码理解 ([#86](https://github.com/shenjingnan/zapmyco/issues/86)) ([ff66c4f](https://github.com/shenjingnan/zapmyco/commit/ff66c4fba72851a8f52655521c689a99326b8967))
* **question:** 实现 AskUserQuestion 交互式提问工具 ([#87](https://github.com/shenjingnan/zapmyco/issues/87)) ([393e715](https://github.com/shenjingnan/zapmyco/commit/393e715ee26b2e45ef78c8940870930489edff95))
* **worktree:** 实现 Phase 1 工作树隔离——Agent 级别 git worktree 文件系统隔离 ([#85](https://github.com/shenjingnan/zapmyco/issues/85)) ([207cd56](https://github.com/shenjingnan/zapmyco/commit/207cd561febf0ee2937913128de34918358a0436))

### Bug Fixes

* **commands:** 修复 increase-coverage 命令先跑单测再跑覆盖率 ([#78](https://github.com/shenjingnan/zapmyco/issues/78)) ([1093933](https://github.com/shenjingnan/zapmyco/commit/1093933386bcccef3cc1970ceafc780b5c2900fd))

## [0.9.0](https://github.com/shenjingnan/zapmyco/compare/v0.8.0...v0.9.0) (2026-05-11)

### Features

* **agent-team:** Phase 1 基础设施——Agent类型系统与团队协作核心 ([#73](https://github.com/shenjingnan/zapmyco/issues/73)) ([14a5328](https://github.com/shenjingnan/zapmyco/commit/14a5328106bb3e838b060c71af057aa0559181ea))
* **agent-team:** Phase 2 编排器升级——Coordinator模式与Agent间通信 ([#74](https://github.com/shenjingnan/zapmyco/issues/74)) ([6edaa32](https://github.com/shenjingnan/zapmyco/commit/6edaa32f15b8ae8f2c480bc51082ff4ef1a1b088))
* **agent-team:** Phase 3 高级特性——用户自定义Agent、Agent Memory、智能生成 ([#75](https://github.com/shenjingnan/zapmyco/issues/75)) ([28c12f9](https://github.com/shenjingnan/zapmyco/commit/28c12f910c18f52884193c5cf6df0cbb62024dc8))
* **agent-team:** Phase 4 可视化与调试——补齐 Coordinator 类型、增强 /agents 命令 ([#76](https://github.com/shenjingnan/zapmyco/issues/76)) ([00ada3e](https://github.com/shenjingnan/zapmyco/commit/00ada3ec7baa62614cc1c7978e360b555b3c7481))
* **core:** 添加对话上下文自动压缩功能 ([#68](https://github.com/shenjingnan/zapmyco/issues/68)) ([6e698b4](https://github.com/shenjingnan/zapmyco/commit/6e698b4ee0bb72e2182e011cd5ee7abf7001071f))
* **security:** 实施安全框架 Phase 0 — 激活运行时安全守卫 ([#69](https://github.com/shenjingnan/zapmyco/issues/69)) ([2729197](https://github.com/shenjingnan/zapmyco/commit/2729197bcfe5e1e1297f7830cc242c3f13e55e78))
* **security:** 实施安全框架 Phase 1 — 权限系统核心 ([#70](https://github.com/shenjingnan/zapmyco/issues/70)) ([0f7e511](https://github.com/shenjingnan/zapmyco/commit/0f7e511c4cdf9a28263c71a50054b6dc83e8291a))
* **security:** 实施安全框架 Phase 2 — 审计诊断与安全加固 ([#71](https://github.com/shenjingnan/zapmyco/issues/71)) ([ab06a02](https://github.com/shenjingnan/zapmyco/commit/ab06a0294f3a0293165f526e3893ca1b35ac347b))

### Bug Fixes

* **security:** 安全框架 Phase 2 收尾——修复统计断连、加固 TOCTOU 保护、补全文件权限检查 ([#72](https://github.com/shenjingnan/zapmyco/issues/72)) ([45800ac](https://github.com/shenjingnan/zapmyco/commit/45800acc76733fd6df2c7af6c8d860ff957d94d9))

## [0.8.0](https://github.com/shenjingnan/zapmyco/compare/v0.7.0...v0.8.0) (2026-05-09)

### Features

* **i18n:** 添加国际化支持并集成至设置界面 ([#65](https://github.com/shenjingnan/zapmyco/issues/65)) ([6468eeb](https://github.com/shenjingnan/zapmyco/commit/6468eeb0db469f8dca36076b61ee8685cb51e0aa))
* **settings:** 在 /settings 中添加语言配置选项 ([#63](https://github.com/shenjingnan/zapmyco/issues/63)) ([97d1ea7](https://github.com/shenjingnan/zapmyco/commit/97d1ea716b0411485a5cf3fc8f6e4004d100cd1d))

### Bug Fixes

* **cli/repl:** 优化 REPL 会话关闭流程，修复定时器与进程退出问题 ([#67](https://github.com/shenjingnan/zapmyco/issues/67)) ([ccbdd50](https://github.com/shenjingnan/zapmyco/commit/ccbdd50821ed63d7965fb9b97ddb382680c040fd))
* 修复 `zapmyco -v` 版本号始终显示 `0.0.0-dev` 的问题 ([#66](https://github.com/shenjingnan/zapmyco/issues/66)) ([a166618](https://github.com/shenjingnan/zapmyco/commit/a1666188985ab6d5c63ef98a19bb229cb09b4c0d))

## [0.7.0](https://github.com/shenjingnan/zapmyco/compare/v0.6.0...v0.7.0) (2026-05-09)

### Features

* API Key 缺失时交互式引导用户输入并自动重试 ([#58](https://github.com/shenjingnan/zapmyco/issues/58)) ([b00dbf5](https://github.com/shenjingnan/zapmyco/commit/b00dbf5879e34bb16bdf6df9829356d6339089c9))
* **llm:** 实现多 AI 厂商支持与认证凭据池基础设施 ([#49](https://github.com/shenjingnan/zapmyco/issues/49)) ([f598afd](https://github.com/shenjingnan/zapmyco/commit/f598afdd13fe9442f683241de2aa7593619c1ed2))
* **repl:** /config set 后立即生效无需重启 ([#52](https://github.com/shenjingnan/zapmyco/issues/52)) ([9dcc642](https://github.com/shenjingnan/zapmyco/commit/9dcc642cc47e2d74ebd4be7f1fd0a578bfb1aca7))
* **repl:** 为 REPL 输出添加颜色区分并支持显示思考内容 ([#48](https://github.com/shenjingnan/zapmyco/issues/48)) ([98809da](https://github.com/shenjingnan/zapmyco/commit/98809dace3197e1c94b496769e5a63a9b5d69fdb))
* **repl:** 支持 Ctrl+O 快捷键打开外部编辑器进行多行输入 ([#47](https://github.com/shenjingnan/zapmyco/issues/47)) ([10f1474](https://github.com/shenjingnan/zapmyco/commit/10f1474fdf6ce272aca4ea676e56636bdbae417f))
* **repl:** 添加 /settings 交互式配置菜单 ([#53](https://github.com/shenjingnan/zapmyco/issues/53)) ([11be938](https://github.com/shenjingnan/zapmyco/commit/11be9388ba89f73605d766224310831dc526e0f4))
* **settings:** /settings 菜单底部添加全屏操作提示 ([#56](https://github.com/shenjingnan/zapmyco/issues/56)) ([35ee0a1](https://github.com/shenjingnan/zapmyco/commit/35ee0a121f64bf4bbf1a9f34fa10188c1ac9ce15))
* **settings:** /settings 默认模型菜单展示所有 pi-ai 模型并支持 / 搜索 ([#57](https://github.com/shenjingnan/zapmyco/issues/57)) ([c54954d](https://github.com/shenjingnan/zapmyco/commit/c54954d4d73101279863b3dd91a72e0cbf9493e7))
* **settings:** 为 /settings 添加 h/l 键盘导航 ([#59](https://github.com/shenjingnan/zapmyco/issues/59)) ([8189404](https://github.com/shenjingnan/zapmyco/commit/8189404f674513a96c81648e9eac7f994467dbda))
* **settings:** 调整 /settings 键盘导航 — q/esc 退出，backspace/h 返回 ([#61](https://github.com/shenjingnan/zapmyco/issues/61)) ([fe5029c](https://github.com/shenjingnan/zapmyco/commit/fe5029c708c2481eecf913ddeff74eec0af013b3))

### Bug Fixes

* **repl:** 修复 SelectList 中 j/k 键无法上下导航的问题 ([#54](https://github.com/shenjingnan/zapmyco/issues/54)) ([dfab74c](https://github.com/shenjingnan/zapmyco/commit/dfab74c276a2b8790729f94f1421c0b1b29df481))
* **settings:** /settings 菜单显示位置从居中改为左上角 ([#55](https://github.com/shenjingnan/zapmyco/issues/55)) ([0eccc55](https://github.com/shenjingnan/zapmyco/commit/0eccc550efd74446ba3c6dbadd77dc64d627ff1b))
* **settings:** View Config 改为 overlay 内展示，修复内容被菜单遮挡问题 ([#62](https://github.com/shenjingnan/zapmyco/issues/62)) ([7f91670](https://github.com/shenjingnan/zapmyco/commit/7f916701831eee83325cfb96d3c0a72b92ce2a11))

### Code Refactoring

* **config:** LLM 配置结构重构：将 models 嵌套到 providers 中 ([#51](https://github.com/shenjingnan/zapmyco/issues/51)) ([c99fdef](https://github.com/shenjingnan/zapmyco/commit/c99fdef6ece6e277c6db72179fd696b47614b4c7))
* **config:** 将用户家目录配置文件从 zapmyco.json 重命名为 settings.json ([#50](https://github.com/shenjingnan/zapmyco/issues/50)) ([0eb1a68](https://github.com/shenjingnan/zapmyco/commit/0eb1a68133cb8398202026592af3a3ffb5ff5f87))
* **settings:** 将 Provider 列表合并为 Manage Providers 子菜单 ([#60](https://github.com/shenjingnan/zapmyco/issues/60)) ([a2ae172](https://github.com/shenjingnan/zapmyco/commit/a2ae17230758e86f176266dc13ec6fbb13e628a0))

## [0.6.0](https://github.com/shenjingnan/zapmyco/compare/v0.5.0...v0.6.0) (2026-05-07)

### Features

* **repl:** 将 loading spinner 从编辑器移至输出区 "ZapMyco:" 行 ([#43](https://github.com/shenjingnan/zapmyco/issues/43)) ([8725154](https://github.com/shenjingnan/zapmyco/commit/87251544eb7fcccb223199b06ff0ead4a1d726d2))
* **repl:** 支持上下方向键切换历史输入并持久化到文件 ([#46](https://github.com/shenjingnan/zapmyco/issues/46)) ([9415019](https://github.com/shenjingnan/zapmyco/commit/94150198fddbaed5a0f4e13d670c20228a1ac876))
* **repl:** 输入 '/' 自动弹出命令补全菜单 ([#45](https://github.com/shenjingnan/zapmyco/issues/45)) ([675d2a2](https://github.com/shenjingnan/zapmyco/commit/675d2a27b1ed49fb9495e54cefabbf253dc10470))

## [0.5.0](https://github.com/shenjingnan/zapmyco/compare/v0.4.0...v0.5.0) (2026-05-07)

### Features

* **logger:** 将日志输出从终端重定向到文件系统 ([#42](https://github.com/shenjingnan/zapmyco/issues/42)) ([249b978](https://github.com/shenjingnan/zapmyco/commit/249b978b5a530e81a653165285ddd3a452cdd382))

## [0.4.0](https://github.com/shenjingnan/zapmyco/compare/v0.3.0...v0.4.0) (2026-05-07)

### Features

* **cron:** 新增定时任务调度系统，支持 cron 表达式定时触发 Agent 任务 ([#30](https://github.com/shenjingnan/zapmyco/issues/30)) ([deaa1fb](https://github.com/shenjingnan/zapmyco/commit/deaa1fbcdb573b973df21f2cc80ffe492f0d0261))
* **mcp:** 新增 MCP 客户端支持，可动态接入外部 MCP Server 工具 ([#25](https://github.com/shenjingnan/zapmyco/issues/25)) ([53c5c76](https://github.com/shenjingnan/zapmyco/commit/53c5c7696eb3c9f98d1c60f92f7e02f5528af2b7))
* **memory:** 新增持久化记忆系统，支持跨会话用户画像与项目上下文记忆 ([#27](https://github.com/shenjingnan/zapmyco/issues/27)) ([e71d154](https://github.com/shenjingnan/zapmyco/commit/e71d1542a367f630a2c74a8a3638290f978f3a52))
* **repl:** 新增 exec 和 process Shell 执行工具 ([#23](https://github.com/shenjingnan/zapmyco/issues/23)) ([03562e0](https://github.com/shenjingnan/zapmyco/commit/03562e0d634412f0c98a43b11f784f2b3d8a00fa))
* **repl:** 新增文件写入、编辑、搜索工具（write_file / edit_file / glob / grep） ([#24](https://github.com/shenjingnan/zapmyco/issues/24)) ([bb61ef1](https://github.com/shenjingnan/zapmyco/commit/bb61ef1fc5951b1b1bdd4e5dd97b461e6a6ba6e0))
* **skill:** 新增 Skill 技能系统，支持预定义工作流调用与自动同步 ([#28](https://github.com/shenjingnan/zapmyco/issues/28)) ([581ec6b](https://github.com/shenjingnan/zapmyco/commit/581ec6b0cde177931f69620001c307d142b963e5))
* **sub-agent:** 新增 Sub-Agent 并行调度系统，支持独立子任务并行执行 ([#29](https://github.com/shenjingnan/zapmyco/issues/29)) ([69ad252](https://github.com/shenjingnan/zapmyco/commit/69ad252d1e2103123e852850fc8345e7d93dfdd7))
* **task:** 新增 Agent 任务管理工具 task_manage ([#26](https://github.com/shenjingnan/zapmyco/issues/26)) ([f2d7b33](https://github.com/shenjingnan/zapmyco/commit/f2d7b3335b7457901071de062ad8751251a5001c))

### Bug Fixes

* **repl:** 优化工具调用展示为 ToolName(参数) 格式 ([#39](https://github.com/shenjingnan/zapmyco/issues/39)) ([d197e0a](https://github.com/shenjingnan/zapmyco/commit/d197e0aee3491a8ecf76d466a0d136e224ab7937))

### Code Refactoring

* **tools:** 统一工具 ID 命名规范为 PascalCase ([#40](https://github.com/shenjingnan/zapmyco/issues/40)) ([1b76030](https://github.com/shenjingnan/zapmyco/commit/1b760303e85e3e7a1d49ab3a1720de2518479435))

## [0.3.0](https://github.com/shenjingnan/zapmyco/compare/v0.2.1...v0.3.0) (2026-05-01)

### Features

* **repl:** 简化 TUI 界面为聊天式交互风格 ([#21](https://github.com/shenjingnan/zapmyco/issues/21)) ([a6e507c](https://github.com/shenjingnan/zapmyco/commit/a6e507c65f3313839d70117c91069b059d974887))
* **web:** 新增 web_fetch 和 web_search 工具 ([#22](https://github.com/shenjingnan/zapmyco/issues/22)) ([84a8d66](https://github.com/shenjingnan/zapmyco/commit/84a8d66e0d5d91e460f53ad893e3ed3fdeb2f60e))

## [0.2.1](https://github.com/shenjingnan/zapmyco/compare/v0.2.0...v0.2.1) (2026-04-29)

### Bug Fixes

* **ci:** 修复 release 工作流 node-version 参数兼容 v6 ([#20](https://github.com/shenjingnan/zapmyco/issues/20)) ([42e3e85](https://github.com/shenjingnan/zapmyco/commit/42e3e8582f3493f302e5b91568b353658c6b4c95))

## 0.2.0 (2026-04-29)

### Features

* **agent-runtime:** 集成 pi-agent-core 作为 Agent 运行时适配层 ([#13](https://github.com/shenjingnan/zapmyco/issues/13)) ([f6a551b](https://github.com/shenjingnan/zapmyco/commit/f6a551b5d57683e628bc0f000c736ac899112c8f))
* **config:** 添加 @/ 路径别名配置 ([#7](https://github.com/shenjingnan/zapmyco/issues/7)) ([e55dc8e](https://github.com/shenjingnan/zapmyco/commit/e55dc8e78150b60a9ae01e315b7586d98c52f5dc))
* **deps:** 引入 pi-agent-core 并移除冗余的 @anthropic-ai/sdk ([#12](https://github.com/shenjingnan/zapmyco/issues/12)) ([238c314](https://github.com/shenjingnan/zapmyco/commit/238c314b8fb49864c1f8ab9b72bf8114333b04e3))
* **lint-staged:** 在 pre-commit 中添加 typecheck 和 test 拦截 ([#18](https://github.com/shenjingnan/zapmyco/issues/18)) ([38a4653](https://github.com/shenjingnan/zapmyco/commit/38a465380d31dafe30e814d9fa535895ebb9f403))
* **llm:** 集成 @mariozechner/pi-ai 作为 LLM 提供商并接通 REPL 流式对话 ([#11](https://github.com/shenjingnan/zapmyco/issues/11)) ([402568e](https://github.com/shenjingnan/zapmyco/commit/402568e7f746e2b7f228c687421ac272613c7fd5))
* **repl:** 将 REPL 执行路径从直接调 LLM 切换为 Agent 层 ([#14](https://github.com/shenjingnan/zapmyco/issues/14)) ([eeb80ec](https://github.com/shenjingnan/zapmyco/commit/eeb80ecfb0e357165be157eabcbea054a1b0d1a5))
* **repl:** 迁移 REPL 至 @mariozechner/pi-tui 框架 ([#6](https://github.com/shenjingnan/zapmyco/issues/6)) ([324d1ea](https://github.com/shenjingnan/zapmyco/commit/324d1ea76ef5a872614d9ae5f702df8e0b979754))
* 搭建 zapmyco Phase 0 骨架 — AI 总管并行任务编排系统 ([#4](https://github.com/shenjingnan/zapmyco/issues/4)) ([6ec7640](https://github.com/shenjingnan/zapmyco/commit/6ec7640036c3c9455d5ed135ea8cbb1d769afb97))

### Code Refactoring

* **ci:** release 工作流 Node 版本改为从 .node-version 读取 ([#17](https://github.com/shenjingnan/zapmyco/issues/17)) ([2cb558f](https://github.com/shenjingnan/zapmyco/commit/2cb558fc47ee7393b85c6c0d2c26d467b4ff5d8c))
* **ci:** 移除工作流中 pnpm 硬编码版本号，改用 packageManager 字段 ([#15](https://github.com/shenjingnan/zapmyco/issues/15)) ([4c0b588](https://github.com/shenjingnan/zapmyco/commit/4c0b5882debb018e01c8714a99b1cfbaec6a7820))
* 将 .nvmrc 替换为通用的 .node-version ([#16](https://github.com/shenjingnan/zapmyco/issues/16)) ([0f4ec8b](https://github.com/shenjingnan/zapmyco/commit/0f4ec8be3ae987391643894822f087ddecf2134f))
* 将 JSDoc 注释中的相对路径 import 更新为 @/ 别名 ([#10](https://github.com/shenjingnan/zapmyco/issues/10)) ([a029005](https://github.com/shenjingnan/zapmyco/commit/a0290058f5a3954ee19cdf2ff683d25dc419b1e1)), closes [#8](https://github.com/shenjingnan/zapmyco/issues/8)
* 将所有剩余相对路径 import 统一转换为 @/ 路径别名 ([#9](https://github.com/shenjingnan/zapmyco/issues/9)) ([fbea177](https://github.com/shenjingnan/zapmyco/commit/fbea177398a4b6c9d211adc94160383cb205b113)), closes [#8](https://github.com/shenjingnan/zapmyco/issues/8)
* 将跨模块相对路径 import 统一转换为 @/ 路径别名 ([#8](https://github.com/shenjingnan/zapmyco/issues/8)) ([d8653fe](https://github.com/shenjingnan/zapmyco/commit/d8653fedf15cd607d2fd513012c170d83fdbc3f7))

### Documentation

* 更新 README.md 反映项目实际状态 ([#19](https://github.com/shenjingnan/zapmyco/issues/19)) ([cad257f](https://github.com/shenjingnan/zapmyco/commit/cad257f57cc1a797ea680064566f996effeaea01))

### CI/CD

* **deps:** bump pnpm/action-setup from 5 to 6 ([#1](https://github.com/shenjingnan/zapmyco/issues/1)) ([e42218c](https://github.com/shenjingnan/zapmyco/commit/e42218cdf3b37fd1ce121d11b849ae6b6ee99384))

## [0.4.5](https://github.com/shenjingnan/ai-typescript-starter/compare/v0.4.4...v0.4.5) (2026-04-14)

### Bug Fixes

* **commands:** 修复 fix-audit 命令中 pnpm audit 非零退出码问题 ([#48](https://github.com/shenjingnan/ai-typescript-starter/issues/48)) ([f70cd15](https://github.com/shenjingnan/ai-typescript-starter/commit/f70cd15bd99170652614d6a1b9a6a524b89df105))

## [0.4.4](https://github.com/shenjingnan/ai-typescript-starter/compare/v0.4.3...v0.4.4) (2026-04-14)

### Bug Fixes

* **security:** 修复 basic-ftp 高危漏洞并更新 Biome schema ([#47](https://github.com/shenjingnan/ai-typescript-starter/issues/47)) ([59186c0](https://github.com/shenjingnan/ai-typescript-starter/commit/59186c05485bb5e745debe12ed35dd0b3d0985b4))

## [0.4.3](https://github.com/shenjingnan/ai-typescript-starter/compare/v0.4.2...v0.4.3) (2026-04-10)

### Bug Fixes

* **commands:** 修复 increase-coverage 命令的 git diff 用法 ([#44](https://github.com/shenjingnan/ai-typescript-starter/issues/44)) ([f9d8088](https://github.com/shenjingnan/ai-typescript-starter/commit/f9d8088408252c5621111cdf060bf15c3353f09a))

## [0.4.2](https://github.com/shenjingnan/ai-typescript-starter/compare/v0.4.1...v0.4.2) (2026-04-10)

### Documentation

* **skill:** 简化 update-readme skill 注意事项 ([#41](https://github.com/shenjingnan/ai-typescript-starter/issues/41)) ([5a4152b](https://github.com/shenjingnan/ai-typescript-starter/commit/5a4152bfc53af72ae04088ddba347014093fdb4c))
* 同步 README.md 与项目实际状态 ([#42](https://github.com/shenjingnan/ai-typescript-starter/issues/42)) ([02bcccd](https://github.com/shenjingnan/ai-typescript-starter/commit/02bcccd92c686587bae616c96a37fec5dd37125c))

## [0.4.1](https://github.com/shenjingnan/ai-typescript-starter/compare/v0.4.0...v0.4.1) (2026-04-08)

### Documentation

* 清理项目中残留的 tsup 引用，统一替换为 tsdown ([#39](https://github.com/shenjingnan/ai-typescript-starter/issues/39)) ([c101462](https://github.com/shenjingnan/ai-typescript-starter/commit/c10146296ebc60f85ba41560dcac89271f4aeef5))

## [0.4.0](https://github.com/shenjingnan/ai-typescript-starter/compare/v0.3.0...v0.4.0) (2026-04-08)

### Features

* 导出编译时版本号常量 VERSION ([#28](https://github.com/shenjingnan/ai-typescript-starter/issues/28)) ([341f72a](https://github.com/shenjingnan/ai-typescript-starter/commit/341f72ac36e99efeb81f96f8f8bd405ef599bcc6))
* 添加 update-readme skill ([#31](https://github.com/shenjingnan/ai-typescript-starter/issues/31)) ([ec59d8c](https://github.com/shenjingnan/ai-typescript-starter/commit/ec59d8c69b11d0e88cf37c37136e361f726af8b6))
* 添加安全审计技能 fix-audit ([#30](https://github.com/shenjingnan/ai-typescript-starter/issues/30)) ([0212b9f](https://github.com/shenjingnan/ai-typescript-starter/commit/0212b9fbb162947e49ed12b5124ee18eb9bda3a3))

### Bug Fixes

* **deps:** 修复 9 个间接依赖安全漏洞 ([#29](https://github.com/shenjingnan/ai-typescript-starter/issues/29)) ([396c814](https://github.com/shenjingnan/ai-typescript-starter/commit/396c814faa6749326b3aa21c2efc03d48498c265))
* **deps:** 修复安全审计漏洞，升级 vitest 2.x → 3.x ([#38](https://github.com/shenjingnan/ai-typescript-starter/issues/38)) ([931082b](https://github.com/shenjingnan/ai-typescript-starter/commit/931082b0e4f378a7ef1490303b39c67a5e52bf3b))

### Code Refactoring

* dev 脚本改用 tsdown --watch 替代 tsx watch ([#36](https://github.com/shenjingnan/ai-typescript-starter/issues/36)) ([26a41bc](https://github.com/shenjingnan/ai-typescript-starter/commit/26a41bcbb5bce37a7d0eed263f58dccb857c212b))
* 迁移构建工具 tsup → tsdown ([#35](https://github.com/shenjingnan/ai-typescript-starter/issues/35)) ([97140ce](https://github.com/shenjingnan/ai-typescript-starter/commit/97140ce1ecc9e520a9ac1821463458c8b341bf32))

### Documentation

* 添加 spellcheck 和 typecheck 命令 ([#37](https://github.com/shenjingnan/ai-typescript-starter/issues/37)) ([efd04e2](https://github.com/shenjingnan/ai-typescript-starter/commit/efd04e2a788e8b71924eedbe65e5967269ea1175))
* 添加中文优先规则到关键规则 ([#32](https://github.com/shenjingnan/ai-typescript-starter/issues/32)) ([00d4aa4](https://github.com/shenjingnan/ai-typescript-starter/commit/00d4aa4ecc9420029123c15a3f6b2c5804c15bad))

## [0.3.0](https://github.com/shenjingnan/ai-typescript-starter/compare/v0.3.0-beta.1...v0.3.0) (2026-04-03)

## [0.3.0-beta.1](https://github.com/shenjingnan/ai-typescript-starter/compare/v0.3.0-beta.0...v0.3.0-beta.1) (2026-04-03)

### Bug Fixes

* **ci:** 修复发布工作流中的拼写错误 ([#26](https://github.com/shenjingnan/ai-typescript-starter/issues/26)) ([5c12f0d](https://github.com/shenjingnan/ai-typescript-starter/commit/5c12f0dcdee6e292b1bd538d0475894198be2325))

## [0.3.0-beta.0](https://github.com/shenjingnan/ai-typescript-starter/compare/v0.2.0...v0.3.0-beta.0) (2026-04-03)

### Features

* **skills:** 添加 Git 冲突解决技能 ([#20](https://github.com/shenjingnan/ai-typescript-starter/issues/20)) ([a024c42](https://github.com/shenjingnan/ai-typescript-starter/commit/a024c42eb00c0ea240189218aa40490fd90e0579))

### Bug Fixes

* **ci:** 将 GitHub Actions 工作流名称还原为英文并修复文件末尾换行 ([#19](https://github.com/shenjingnan/ai-typescript-starter/issues/19)) ([3b55b47](https://github.com/shenjingnan/ai-typescript-starter/commit/3b55b47df6d38889a87a1aec1e9ae92ad1e921c4))
* 清理 husky pre-commit hook 中的废弃代码 ([#23](https://github.com/shenjingnan/ai-typescript-starter/issues/23)) ([05c7d30](https://github.com/shenjingnan/ai-typescript-starter/commit/05c7d306707d8d74f15c7ef796811e1d8d201c53))

### Code Refactoring

* 整合 AI 配置，统一使用 AGENTS.md ([#22](https://github.com/shenjingnan/ai-typescript-starter/issues/22)) ([b5ea5de](https://github.com/shenjingnan/ai-typescript-starter/commit/b5ea5dea5cafa28718d95e01e1112c7e28a77bb9))

## 0.2.0 (2026-03-29)

### Features

* 初始化 AI 原生 TypeScript 启动模板 ([#1](https://github.com/shenjingnan/ai-typescript-starter/issues/1)) ([94e0755](https://github.com/shenjingnan/ai-typescript-starter/commit/94e075567cf188f9421b5c7327e49917668ef570))

### Documentation

* 将 GitHub Actions 工作流名称翻译为中文 ([#14](https://github.com/shenjingnan/ai-typescript-starter/issues/14)) ([41f20af](https://github.com/shenjingnan/ai-typescript-starter/commit/41f20af0c2fcc088d1b3e45d2bb39a30fc20792b))
* 将 GitHub Copilot 指南翻译为中文 ([#15](https://github.com/shenjingnan/ai-typescript-starter/issues/15)) ([557c4c6](https://github.com/shenjingnan/ai-typescript-starter/commit/557c4c6e61e79ee45a8571a89c5cbb51cf325a26))
* 将 GitHub Issue 模板翻译为中文 ([#13](https://github.com/shenjingnan/ai-typescript-starter/issues/13)) ([2549c70](https://github.com/shenjingnan/ai-typescript-starter/commit/2549c70d3c78af2bf8ab23ecbd7f39d58b7bd361))

### CI/CD

* **deps:** Bump actions/checkout from 4 to 6 ([#4](https://github.com/shenjingnan/ai-typescript-starter/issues/4)) ([a78628e](https://github.com/shenjingnan/ai-typescript-starter/commit/a78628ea133281a9fb4b086cc97a0b5c7bfafbc7))
* **deps:** Bump actions/setup-node from 4 to 6 ([#3](https://github.com/shenjingnan/ai-typescript-starter/issues/3)) ([53dfd3b](https://github.com/shenjingnan/ai-typescript-starter/commit/53dfd3b8f874fa96905c58005c876b447317c621))
* **deps:** Bump codecov/codecov-action from 4 to 6 ([#5](https://github.com/shenjingnan/ai-typescript-starter/issues/5)) ([94b3e22](https://github.com/shenjingnan/ai-typescript-starter/commit/94b3e22324ad632c02768c06316a66856ca2189e))
* **deps:** Bump pnpm/action-setup from 4 to 5 ([#2](https://github.com/shenjingnan/ai-typescript-starter/issues/2)) ([c2000b7](https://github.com/shenjingnan/ai-typescript-starter/commit/c2000b7ca8cc5129b57b15174a40d9701900d311))

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial project setup
- TypeScript 5.x configuration
- Vitest testing framework
- Biome linter and formatter
- cspell spell checker
- tsup build configuration
- release-it for version management
- Husky git hooks
- lint-staged configuration
- GitHub Actions CI/CD workflows
- Issue templates (bug report, feature request)
- Dependabot configuration
- GitHub Copilot instructions
- Claude Code integration (.claude directory)
- Documentation (architecture, API, contributing)

## [0.1.0] - 2026-03-26

### Added

- Initial release
- Basic TypeScript project structure
- Build, test, and lint scripts
- CI/CD pipeline
- Documentation

[Unreleased]: https://github.com/shenjingnan/ai-typescript-starter/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/shenjingnan/ai-typescript-starter/releases/tag/v0.1.0

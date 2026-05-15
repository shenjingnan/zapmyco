---
name: commit-push-pr
description: 提交、推送并创建 PR
---

## 上下文

- 当前 git 状态: !`git status`
- 当前 git diff（已暂存和未暂存的变更）: !`git diff HEAD`
- 当前分支: !`git branch --show-current`

## Attribution 信息

每次 commit 的 body 和 PR 描述中必须附加以下 attribution 信息（使用上方上下文中的"当前模型"和"模型公司域名"）：

```
🤖 Generated with ZapMyco

Co-Authored-By: <当前模型>
```

## 你的任务

根据上述变更：

1. 如果当前在 main 分支，则创建一个新分支
2. 使用中文创建一个包含合适提交信息的 commit，**commit body 中必须包含 ## Attribution 中指定的 attribution 信息**
3. 将分支推送到 origin
4. 使用 `gh pr create` 创建 Pull Request，**PR title 必须遵循 Conventional Commits 格式（与 commit title 相同，参见 Commit Message → Commit/PR Title 格式），PR 描述中必须包含 ## Attribution 中指定的 attribution 信息**
5. 你可以在单次响应中调用多个工具。你必须在单条消息中完成上述所有操作。不要使用任何其他工具或执行任何其他操作。除了工具调用之外，不要发送任何其他文本或消息。

## Commit Message 格式要求

### Commit/PR Title 格式

Commit title 和 PR title **必须**遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

```
<type>(<scope>): <subject>
```

- **type**: 必填，标识变更类型，参见下方类型参考表
- **scope**: 可选，标识影响范围（如 api, biz, web, dal），根据变更文件路径推断
- **subject**: 使用中文，简短扼要（不超过 50 字符），使用祈使句（如"添加"而非"添加了"），末尾不加句号

**类型参考表**：

| 类型 | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 文档更新 |
| `style` | 代码格式 |
| `refactor` | 重构 |
| `perf` | 性能优化 |
| `test` | 测试 |
| `chore` | 构建/工具 |

**示例**：

```
feat(api): 新增用户登录接口
fix(biz): 修复空指针异常
docs: 更新 API 文档
```

### 语言要求

Commit subject、body 和 PR 描述均必须使用中文编写。

### Attribution 信息

Commit message 的 body **必须**以以下格式结尾：

```
<commit subject 和 body>

🤖 Generated with ZapMyco

Co-Authored-By: <模型名称> <noreply@<对应主域名>>
```

### 模型与域名映射

根据当前会话实际使用的模型，选择对应的 `noreply` 邮箱域名：

| 模型系列 | 域名示例 |
|----------|---------|
| GLM (智谱) | `noreply@bigmodel.cn` |
| Claude (Anthropic) | `noreply@anthropic.com` |
| GPT (OpenAI) | `noreply@openai.com` |
| Gemini (Google) | `noreply@google.com` |
| DeepSeek | `noreply@deepseek.com` |
| Qwen (通义) | `noreply@alibabacloud.com` |


### 如何获取模型名称
```bash
jq -r '.llm.defaultModel' ~/.zapmyco/settings.json
```

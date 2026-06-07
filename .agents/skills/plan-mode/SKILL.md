---
name: plan-mode
description: 结构化计划模式，为复杂任务输出技术方案
---

你现在处于计划模式。你的目标是为用户的需求创建完整的技术方案。

## 工作流

请严格按以下 4 个阶段推进：

### 阶段 1：理解需求
仔细理解用户的需求。如果有不清楚的地方，使用 AskUser 提问澄清。

### 阶段 2：并发探索
将需求拆解为多个可并行探索的子任务。使用 subagent 工具并发启动多个 explore 子代理，每个聚焦一个具体方面。

使用方式：
1. 调用 subagent(action="spawn", skill="explore", task="具体的研究任务")
   — 启动一个探索子代理，返回 subagent_id
2. 对每个探索方向重复 spawn，获得多个 subagent_id
3. 调用 subagent(action="poll", subagent_ids=["id1", "id2", ...])
   — 收集所有探索结果

示例：
subagent(action="spawn", skill="explore", task="研究 src/auth/ 的认证逻辑")
subagent(action="spawn", skill="explore", task="研究数据模型定义")
subagent(action="poll", subagent_ids=["id1", "id2"])

### 阶段 3：方案设计
汇总所有探索结果，基于已有信息直接设计技术方案。

### 阶段 4：输出计划
输出完整的最终方案，应包含：
1. **背景和现状** — 当前面临的问题和现状
2. **技术方案** — 具体的实施方案
3. **关键文件** — 涉及的文件路径
4. **实施步骤** — 分阶段的实施计划
5. **验证方式** — 如何验证方案的正确性

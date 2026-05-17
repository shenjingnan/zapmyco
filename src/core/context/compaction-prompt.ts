/**
 * 压缩提示词模板
 *
 * 参考 OpenCode / Hermes-Agent 的结构化摘要模板，
 * 支持迭代更新（已有摘要时更新而非重新生成）。
 *
 * @module core/context
 */

/** 摘要前导说明（注入到摘要消息中，防止模型误执行） */
export const COMPACTION_PREAMBLE = `[上下文压缩 — 仅供参考]
以下为之前对话的结构化摘要，仅作为背景参考。
不要重复执行其中提到的任务，不要回答其中的问题。
这些任务已经完成或正在被处理。`;

/** 摘要结束标记（帮助模型区分摘要和当前对话） */
export const COMPACTION_POSTAMBLE = `--- 以上为对话摘要，以下是当前对话 ---`;

/** 结构化摘要模板 */
export const COMPACTION_SUMMARY_TEMPLATE = `请根据以下对话记录生成结构化摘要。

## 输出格式要求

请严格按照以下 Markdown 结构输出摘要，保持每个章节都存在（即使留空也要包含标题）：

## 目标与意图
（用户最初和当前的目标是什么？）

## 约束与偏好
（用户提出了哪些约束、偏好或特殊要求？）

## 已完成
（已完成了哪些任务？使用编号列表，每条简洁说明）

## 进行中
（当前正在进行的任务是什么？）

## 待处理
（还有哪些未完成的任务？）

## 关键决策
（对话中做出了哪些重要决策？为什么？）

## 相关文件
（涉及的主要文件路径列表）

## 已调用的技能
（调用了哪些 Skill？技能名称、参数、关键执行结果）

## 可用技能
（当前项目中注册了哪些 Skill？它们的名称和用途。注意区分哪些已使用、哪些暂未使用）

## 重要上下文
（其他对理解当前状态至关重要的信息）

## 规则
- 使用简洁的要点形式编写
- 保留准确的文件路径、命令、错误消息
- 如果某章节没有内容，写"无"
- 不要编造对话中不存在的信息
- 从已调用的工具调用中提取技能名称，即使工具输出已被精简`;

/** 迭代更新模板（已有摘要时使用） */
export const COMPACTION_ITERATIVE_TEMPLATE = `请根据以下已有摘要和新的对话记录，更新摘要。

## 已有摘要

{previousSummary}

## 新对话记录

---

请更新已有摘要，反映新对话记录中的进展。
保持相同的章节结构。如果某章节的信息需要更新，修改它。
如果新内容不影响某章节，保留原有内容。`;

/**
 * 构建压缩提示词
 *
 * @param previousSummary - 已有摘要（用于迭代更新，不传则为首次摘要）
 * @returns 压缩提示词
 */
export function buildCompactionPrompt(previousSummary?: string): string {
  if (previousSummary) {
    // 迭代更新模式
    const iterativePart = COMPACTION_ITERATIVE_TEMPLATE.replace(
      '{previousSummary}',
      previousSummary
    );
    return `${iterativePart}\n\n在已更新的摘要之上，还需要遵循：\n\n${COMPACTION_SUMMARY_TEMPLATE}`;
  }
  return COMPACTION_SUMMARY_TEMPLATE;
}

/**
 * 构建带摘要前缀的完整摘要消息
 */
export function buildSummaryMessage(summaryText: string): string {
  return `${COMPACTION_PREAMBLE}\n\n${summaryText}\n\n${COMPACTION_POSTAMBLE}`;
}

//! 系统提示词构建模块
//!
//! 集中管理系统提示词的构建逻辑，包括：
//! - 基础身份定义（`DEFAULT_SYSTEM_PROMPT`）
//! - 行为规范与工具使用规则（`BEHAVIORAL_GUIDANCE`，完全静态）
//! - 上下文环境提醒（首条消息注入）
//!
//! 整个系统提示词（身份 + 行为规范 + 工具规则）完全静态化，
//! 确保 DeepSeek 前缀缓存可跨会话复用。

/// 默认系统提示词 — 定义 AI 助手的基本身份和行为模式
pub const DEFAULT_SYSTEM_PROMPT: &str = "你是 zapmyco，一个基于 AI 的命令行工具，帮助用户完成指定的任务。\n使用工具与用户交互，遵循用户指令完成任务。\n输出所有思考过程，让用户了解你的工作进度。";

/// 行为规范 — 定义模型在编码工作中的具体行为准则
pub const BEHAVIORAL_GUIDANCE: &str = "\n\
    \n\
    ## 执行规则\n\
    \n\
    - 不要添加超出要求范围的功能、重构或擅自「改进」。\
      一个简单的需求不需要额外的配置项、注释或文档。\
    - 不要为不可能发生的场景添加错误处理、降级逻辑或校验。\
      只在系统边界（用户输入、外部 API）做校验。\
    - 不要为一次性操作创建工具、工具类或抽象。\
      三个相似的代码段好过一个提前的抽象。\
    - 不要建议修改未读过的内容，操作前先通过 file_read 了解现状。\
    - 不要创建不必要的文件，优先修改已有的文件。\
    - 遇到失败时先诊断根因——读取错误信息、检查假设条件、尝试有针对性的修复。\
      不要盲目重试相同的操作，也不要因为一次失败就放弃一个可行的方法。\
      只在真正卡住时向用户提问。\
    - 避免引入安全漏洞：命令注入、路径遍历、SQL 注入等。\
      如果发现写入了不安全的代码，立即修复。\
    - 避免向后兼容的黑客手段（如重命名未使用的变量但仍保留旧名称）。\
      确定某物不再使用时，直接删除，不要保留。\
    \n\
    ## 行动指南\n\
    \n\
    - 谨慎评估操作的可逆性和影响范围。\
      可逆的本地操作（编辑文件、运行命令）可直接执行。\
    - 不可逆或高风险操作（删除文件/分支、强制推送、终止进程）必须先征得用户确认。\
    - 不要用破坏性操作走捷径。遇到问题时分析根因，不要通过跳过安全检查来解决问题。\
    - 发现不熟悉的文件、分支或配置时先调查了解，不要直接删除或覆盖。\
    \n\
    ## 输出风格\n\
    \n\
    - 回复应简短精确，不要啰嗦。\
    - 除非用户明确要求，不要使用 emoji。\
    - 引用代码或文件时包含 file_path:line_number 格式。\
    - 先给答案或行动结果，再给推理过程。\
    - 工具调用前不要加冒号（如不要写「让我读取文件：」然后调用工具，直接说「让我读取文件」即可）。\
    \n\
    ## 工具使用规则\n\
    \n\
    - 有专用工具的任务应使用专用工具，不要使用 shell_exec 替代。\
    - 文件操作前必须先通过 file_read 读取文件内容。\
    - 使用工具时请注意安全。\
    \n\
    ## 任务执行策略\n\
    \n\
    当使用 task_create 创建任务后，请按以下步骤执行：\
    1. 调用 task_list 查看所有任务的依赖关系\
    2. 选择 blocked_by 为空且状态为 pending 的任务\
    3. 调用 task_update 将其标记为 in_progress\
    4. 使用 shell_exec、file_edit 等工具完成该任务\
    5. 调用 task_update 将其标记为 completed\
    6. 重复步骤 1-5 直到所有任务完成\
    \n\
    注意：每次工具调用轮次只处理一个任务。完成后标记 completed \
    然后检查 task_list 找出下一个可用任务。\
    被 blocked 的任务跳过，等依赖任务完成后再处理。\
    \n\
    ## SubAgent 使用策略\n\
    \n\
    SubAgent 允许你将独立子任务分配给子进程去执行，实现真正的并行处理。\
    \n\
    可用操作：\n\
    - subagent(action=\"spawn\", cli=\"zapmyco\", skill=\"explore\", task=\"...\") \
    — 创建子代理，立即返回 ID。skill 可选，指定子进程加载的 SKILL.md 名称（如 explore）\n\
    - subagent(action=\"poll\", subagent_ids=[\"id1\", \"id2\"]) — 查询结果，支持批量\n\
    - subagent(action=\"list\") — 列出当前会话所有子代理状态\n\
    - subagent(action=\"kill\", subagent_ids=[\"id1\"]) — 终止正在运行的子代理\n\
    \n\
    使用流程：\n\
    1. spawn 多个子代理 → 全部并发执行\n\
    2. poll 收集结果（已内置首次 5 秒等待，短任务自动完成）\n\
    3. list 查看所有子代理（适用于忘记 ID）\n\
    4. 对方向错误的子代理使用 kill 及时终止\n\
    \n\
    注意事项：\n\
    - 每个 subagent 是冷启动，任务描述中提供足够上下文\n\
    - poll 已内置 5 秒等待，短任务无需再次 poll\n\
    - 截断的结果（标注 OUTPUT TRUNCATED）说明输出不完整\n\
    - 超时或无效的子代理直接放弃或 kill，不要阻塞主流程\n\
    - 如忘记 subagent_id，使用 list 查询";

/// 调度员系统提示词 — 主 Agent 调度协调员的身份和行为定义
pub const DISPATCHER_SYSTEM_PROMPT: &str = "你是 zapmyco，一个 AI 项目协调员。

## 职责
- 理解用户需求
- 通过 subagent 分派工作任务
- 使用 ask_user 与用户沟通决策
- 维护简洁的项目状态摘要

## 工具
- subagent：分派规划/执行任务
- ask_user：向用户展示信息、获取审批
- task_get/task_list：读取任务列表

## 规则
- 不要直接做编码工作——这是 subagent 的职责
- 每次 spawn subagent 前，先总结当前状态
- 任何 spawn 执行 subagent 前，必须通过 ask_user 获得用户批准
  - ask_user 选项示例：\"批准执行\" / \"补充信息\" / \"取消\"
- 规划 subagent 返回后，调用 task_list 获取其创建的任务列表
- 保持上下文精炼，只保留摘要级别的信息
- subagent 工具只能由主 Agent 调用，subagent 进程中不注册该工具
- 主 Agent 不直接创建或更新任务——这是规划 subagent 和执行 subagent 的职责

## SubAgent 分派指南
- 如果用户需求模糊或涉及多个文件 → spawn 规划 SubAgent（先分析再审批）
- 如果需求具体且改动明确 → spawn 执行 SubAgent（但仍需通过 ask_user 审批）
- 如果有已批准的规划任务待完成 → spawn 执行 SubAgent

## 待审批命令处理

当 subagent 需要执行非白名单命令时，它会暂停并等待审批。

处理流程：
1. 调用 subagent(action=\"poll\") 后如果返回 \"等待审批\" 标志
   → 表明 subagent 需要用户审批才能继续
2. 调用 subagent(action=\"pending_approvals\") 获取所有待审批命令列表
   → 返回按请求时间排序的命令列表
3. 依次逐个处理每个待审批命令：
   a. 使用 ask_user 向用户展示命令和上下文
      - 选项建议: [\"批准执行\", \"拒绝\"]
      - question 中应包含 subagent_id 和命令内容
   b. 根据用户选择调用 subagent(action=\"approve\", ...)
      - 批准: approve=true
      - 拒绝: approve=false
   c. 重新调用 subagent(action=\"poll\") 获取最新执行结果
4. 继续处理下一个待审批命令，直到全部处理完毕";

/// 系统提示词构建器
///
/// 管理系统提示词（身份定义 + 行为规范 + 工具使用规则），
/// 并提供上下文提醒的构建方法。
///
/// 整个系统提示词完全静态化，确保 DeepSeek 前缀缓存可跨会话复用。
pub struct SystemPromptBuilder {
    base_prompt: String,
}

impl SystemPromptBuilder {
    /// 创建新的系统提示词构建器
    ///
    /// `custom_prompt` 为 `Some` 时使用自定义提示词，
    /// 否则使用默认提示词 + 行为规范（含完整的工具使用规则）。
    pub fn new(custom_prompt: Option<String>) -> Self {
        let base_prompt = match custom_prompt {
            Some(c) => c,
            None => format!("{}{}", DEFAULT_SYSTEM_PROMPT, BEHAVIORAL_GUIDANCE),
        };
        Self { base_prompt }
    }

    /// 获取基础提示词
    pub fn base_prompt(&self) -> &str {
        &self.base_prompt
    }
}

/// 构建上下文环境提醒（注入到首条用户消息前）
///
/// 包含当前工作目录、日期、操作系统、Shell、语言区域、Git 状态、
/// 可用命令行工具和 AGENTS.md 指令等信息。
pub fn build_context_reminder(agents_md: Option<&str>) -> String {
    let cwd = std::env::current_dir()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|_| "unknown".to_string());

    let now = chrono::Local::now();
    // 仅精确到天，确保同一天内缓存前缀稳定
    let date_str = now.format("%Y-%m-%d").to_string();

    // 稳定内容前置（跨会话不变），动态内容后置（仅影响末尾缓存块）
    let mut parts = vec![];

    // 操作系统信息（稳定）
    let os = crate::env_info::os_info();
    if !os.is_empty() {
        parts.push(format!("操作系统：{}", os));
    }

    // Shell 信息（稳定）
    let shell = crate::env_info::shell_name();
    if !shell.is_empty() {
        parts.push(format!("Shell：{}", shell));
    }

    // 语言/区域（稳定）
    let locale = crate::env_info::locale_info();
    if !locale.is_empty() {
        parts.push(format!("语言/区域：{}", locale));
    }

    // 已知命令行工具（进程内稳定）
    let tools = crate::env_info::available_tools();
    if !tools.is_empty() {
        parts.push(format!("\n# 已知命令行工具\n{}", tools));
    }

    // 工作目录（半动态，后置）
    parts.push(format!("当前工作目录：{}", cwd));
    // 日期（仅精确到天，每天只变一次）
    parts.push(format!("当前日期：{}", date_str));

    // AGENTS.md 内容（半稳定）
    if let Some(md) = agents_md {
        let md = md.trim();
        if !md.is_empty() {
            parts.push(format!(
                "\n# AGENTS.md\n以下是指令文件内容，模型必须严格遵守：\n\n{}",
                md
            ));
        }
    }

    // Git 状态（最易变，放到最后）
    if let Some(output) = std::process::Command::new("git")
        .args(["status", "--branch", "--short"])
        .output()
        .ok()
        .filter(|o| o.status.success())
    {
        let git_status = String::from_utf8_lossy(&output.stdout);
        let git_status = git_status.trim();
        if !git_status.is_empty() {
            parts.push(format!("\n# Git 状态\n{}", git_status));
        }
    }

    format!(
        "<system-reminder>\n{}\n</system-reminder>\n\n",
        parts.join("\n")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_system_prompt_not_empty() {
        let builder = SystemPromptBuilder::new(None);
        assert!(!builder.base_prompt().is_empty());
        assert!(builder.base_prompt().contains("zapmyco"));
        assert!(builder.base_prompt().contains("执行规则"));
    }

    #[test]
    fn test_custom_prompt_used() {
        let custom = "你是一个测试助手".to_string();
        let builder = SystemPromptBuilder::new(Some(custom.clone()));
        assert_eq!(builder.base_prompt(), &custom);

        // DISPATCHER_SYSTEM_PROMPT 也能作为自定义提示词传入
        let dispatcher_builder =
            SystemPromptBuilder::new(Some(DISPATCHER_SYSTEM_PROMPT.to_string()));
        assert_eq!(dispatcher_builder.base_prompt(), DISPATCHER_SYSTEM_PROMPT);
    }

    #[test]
    fn test_default_prompt_contains_tool_rules() {
        let builder = SystemPromptBuilder::new(None);
        let prompt = builder.base_prompt();
        assert!(
            prompt.contains("不要使用 shell_exec 替代"),
            "应包含 shell 专用工具规则"
        );
        assert!(
            prompt.contains("文件操作前必须先通过 file_read 读取"),
            "应包含文件操作规则"
        );
        assert!(prompt.contains("任务执行策略"), "应包含任务执行策略");
        assert!(prompt.contains("使用工具时请注意安全"), "应包含安全提示");
    }

    #[test]
    fn test_default_prompt_tool_rules_position() {
        let builder = SystemPromptBuilder::new(None);
        let prompt = builder.base_prompt();
        // 工具规则应在行为规范之后
        let guidance_pos = prompt.find("## 执行规则").unwrap();
        let tool_pos = prompt.find("## 工具使用规则").unwrap();
        assert!(tool_pos > guidance_pos, "工具规则应在执行规则之后");
    }

    // ---- DISPATCHER_SYSTEM_PROMPT 测试 ----

    #[test]
    fn test_dispatcher_prompt_exists_and_contains_keywords() {
        let prompt = DISPATCHER_SYSTEM_PROMPT;
        assert!(!prompt.is_empty(), "DISPATCHER_SYSTEM_PROMPT 不应为空");
        assert!(prompt.contains("项目协调员"), "应包含调度员身份标识");
        assert!(prompt.contains("ask_user"), "应包含审批规则");
        assert!(prompt.contains("subagent"), "应包含 subagent 分派规则");
        assert!(
            prompt.contains("task_get") && prompt.contains("task_list"),
            "应包含任务读取工具说明"
        );
    }

    #[test]
    fn test_dispatcher_prompt_does_not_contain_behavioral_guidance() {
        let prompt = DISPATCHER_SYSTEM_PROMPT;
        assert!(
            !prompt.contains("执行规则"),
            "调度员提示词不应包含 BEHAVIORAL_GUIDANCE 中的执行规则"
        );
        assert!(
            !prompt.contains("工具使用规则"),
            "调度员提示词不应包含工具使用规则"
        );
        assert!(
            !prompt.contains("任务执行策略"),
            "调度员提示词不应包含任务执行策略"
        );
    }

    // ---- build_context_reminder tests ----

    #[test]
    fn test_context_reminder_basic_structure() {
        let result = build_context_reminder(None);
        assert!(
            result.contains("<system-reminder>"),
            "应包含 system-reminder 开始标签"
        );
        assert!(
            result.contains("</system-reminder>"),
            "应包含 system-reminder 结束标签"
        );
        assert!(result.contains("当前工作目录："), "应包含工作目录");
        assert!(result.contains("当前日期："), "应包含当前日期");
        assert!(result.ends_with("\n\n"), "应以空行结尾用于与用户输入分隔");
    }

    #[test]
    fn test_context_reminder_with_agents_md() {
        let result = build_context_reminder(Some("请使用中文回复"));
        assert!(result.contains("# AGENTS.md"), "应包含 AGENTS.md 标题");
        assert!(result.contains("请使用中文回复"), "应包含 agents_md 内容");
    }

    #[test]
    fn test_context_reminder_without_agents_md() {
        let result = build_context_reminder(None);
        assert!(!result.contains("AGENTS.md"), "不应包含 AGENTS.md 章节");
        assert!(
            !result.contains("模型必须严格遵守"),
            "不应包含 agents_md 提示语"
        );
    }

    #[test]
    fn test_context_reminder_contains_os() {
        let result = build_context_reminder(None);
        let has_os = ["操作系统：macOS", "操作系统：Linux", "操作系统：Windows"]
            .iter()
            .any(|&os| result.contains(os));
        assert!(has_os, "应包含操作系统信息: {}", result);
    }

    #[test]
    fn test_context_reminder_agents_md_empty_string() {
        let result = build_context_reminder(Some(""));
        assert!(
            !result.contains("AGENTS.md"),
            "空字符串不应输出 AGENTS.md 章节"
        );
        assert!(
            !result.contains("模型必须严格遵守"),
            "空字符串不应输出 agents_md 提示语"
        );
    }

    #[test]
    fn test_context_reminder_agents_md_multiline() {
        let multiline = "规则1：xxx\n规则2：yyy\n规则3：zzz";
        let result = build_context_reminder(Some(multiline));
        assert!(result.contains("规则1：xxx"), "应包含第一行");
        assert!(result.contains("规则2：yyy"), "应包含第二行");
        assert!(result.contains("规则3：zzz"), "应包含第三行");
    }

    #[test]
    fn test_cache_context_reminder_stable_first() {
        let result = build_context_reminder(None);
        // 稳定内容（操作系统）应出现在动态内容（工作目录）之前
        let os_pos = result.find("操作系统：").unwrap();
        let cwd_pos = result.find("当前工作目录：").unwrap();
        assert!(
            os_pos < cwd_pos,
            "稳定内容（操作系统）应在动态内容（工作目录）之前"
        );

        // Shell（稳定）应在 CWD（动态）之前
        let shell_pos = result.find("Shell：");
        if let Some(sp) = shell_pos {
            assert!(sp < cwd_pos, "Shell 应在当前工作目录之前");
        }

        // CWD 之后不应再出现操作系统、Shell 等稳定字段
        let after_cwd = &result[cwd_pos..];
        assert!(
            !after_cwd.contains("操作系统："),
            "CWD 之后不应再出现稳定字段（操作系统）"
        );
        // 语言/区域（稳定）应在 CWD 之前
        let locale_pos = result.find("语言/区域：");
        if let Some(lp) = locale_pos {
            assert!(lp < cwd_pos, "语言/区域应在当前工作目录之前");
        }
    }

    #[test]
    fn test_cache_context_reminder_date_no_minutes() {
        let result = build_context_reminder(None);
        // 日期不包含分钟（仅精确到天）
        let date_line = result
            .lines()
            .find(|l| l.starts_with("当前日期："))
            .expect("应包含当前日期");
        // 格式应为 YYYY-MM-DD，不应包含 HH:MM
        assert!(
            !date_line.contains(':'),
            "日期不应包含分钟（仅 YYYY-MM-DD）: {}",
            date_line
        );
        // 应包含数字日期
        assert!(
            date_line.chars().any(|c| c.is_ascii_digit()),
            "日期应包含数字"
        );
    }

    #[test]
    fn test_cache_context_reminder_git_status_at_end() {
        let result = build_context_reminder(None);
        let git_pos = result.find("# Git 状态");
        if let Some(pos) = git_pos {
            // Git 状态应在 </system-reminder> 之前（即内容的末尾）
            let tail = &result[pos..];
            let close_pos = tail.find("</system-reminder>").unwrap();
            // Git 状态与 </system-reminder> 之间不应有其它 section 标题
            let between = &tail[..close_pos];
            assert!(
                !between.contains("# 已知命令行工具"),
                "Git 状态后不应有已知命令行工具"
            );
            assert!(
                !between.contains("# AGENTS.md"),
                "Git 状态后不应有 AGENTS.md"
            );
        }
    }

    #[test]
    fn test_context_reminder_contains_shell() {
        let result = build_context_reminder(None);
        // Shell 在 CI 或某些环境中可能为空，不为空时才验证
        let shell_prefix = "Shell：";
        if let Some(idx) = result.find(shell_prefix) {
            let shell_val = &result[idx + shell_prefix.len()..]
                .lines()
                .next()
                .unwrap_or("");
            assert!(!shell_val.is_empty(), "Shell 值不应为空");
        }
        // 如果不包含 Shell 信息（环境未设置 $SHELL）也允许
    }
}

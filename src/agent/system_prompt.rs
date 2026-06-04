//! 系统提示词构建模块
//!
//! 集中管理系统提示词的构建逻辑，包括：
//! - 基础身份定义（`DEFAULT_SYSTEM_PROMPT`）
//! - 行为规范（`BEHAVIORAL_GUIDANCE`）
//! - 工具使用指引
//! - 上下文环境提醒（首条消息注入）

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
    - 工具调用前不要加冒号（如不要写「让我读取文件：」然后调用工具，直接说「让我读取文件」即可）。";

/// 系统提示词构建器
///
/// 管理基础系统提示词（身份定义 + 行为规范），
/// 并提供工具使用指引和上下文提醒的构建方法。
pub struct SystemPromptBuilder {
    base_prompt: String,
}

impl SystemPromptBuilder {
    /// 创建新的系统提示词构建器
    ///
    /// `custom_prompt` 为 `Some` 时使用自定义提示词，
    /// 否则使用默认提示词 + 行为规范。
    pub fn new(custom_prompt: Option<String>) -> Self {
        let base_prompt = match custom_prompt {
            Some(c) => c,
            None => format!("{}{}", DEFAULT_SYSTEM_PROMPT, BEHAVIORAL_GUIDANCE),
        };
        Self { base_prompt }
    }

    /// 获取基础提示词（不含工具使用指引）
    pub fn base_prompt(&self) -> &str {
        &self.base_prompt
    }

    /// 获取静态部分长度（用于提示词缓存拆分）
    ///
    /// 静态部分 = 基础提示词，可设置 `cache_control: ephemeral`；
    /// 动态部分 = 工具使用指引和工具定义，不缓存。
    pub fn static_prompt_len(&self) -> usize {
        self.base_prompt.len()
    }
}

/// 构建包含工具使用指引的完整系统提示词
///
/// * `base` — 基础系统提示词（身份 + 行为规范）
/// * `tool_names` — 已注册的工具名称列表
///
/// 根据已注册的工具动态生成对应的使用规则说明。
pub fn build_with_tool_guidance(base: &str, tool_names: &[&str]) -> String {
    let mut prompt = base.to_string();
    if tool_names.is_empty() {
        return prompt;
    }

    prompt.push_str("\n\n使用工具时请注意以下规则：\n");

    // 强调专用工具优先于 shell_exec
    if tool_names.contains(&"shell_exec") {
        prompt.push_str("注意：有专用工具的任务应使用专用工具，不要使用 shell_exec 替代。\n");
    }

    // 文件操作安全规则
    let has_file_tools = tool_names.contains(&"file_read")
        || tool_names.contains(&"file_edit")
        || tool_names.contains(&"file_write");
    if has_file_tools {
        prompt.push_str("文件操作前必须先通过 file_read 读取文件内容。\n");
    }

    prompt.push_str("使用工具时请注意安全。");

    // 任务执行策略
    let has_task_tools = tool_names.contains(&"task_create")
        || tool_names.contains(&"task_update")
        || tool_names.contains(&"task_list");
    if has_task_tools {
        prompt.push_str(
            "\n\n## 任务执行策略\n\
             当使用 task_create 创建任务后，请按以下步骤执行：\n\
             1. 调用 task_list 查看所有任务的依赖关系\n\
             2. 选择 blocked_by 为空且状态为 pending 的任务\n\
             3. 调用 task_update 将其标记为 in_progress\n\
             4. 使用 shell_exec、file_edit 等工具完成该任务\n\
             5. 调用 task_update 将其标记为 completed\n\
             6. 重复步骤 1-5 直到所有任务完成\n\
             注意：每次工具调用轮次只处理一个任务。完成后标记 completed \
             然后检查 task_list 找出下一个可用任务。\
             被 blocked 的任务跳过，等依赖任务完成后再处理。",
        );
    }

    prompt
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
    let date_str = now.format("%Y-%m-%d %H:%M").to_string();

    let mut parts = vec![
        format!("当前工作目录：{}", cwd),
        format!("当前日期：{}", date_str),
    ];

    // 操作系统信息
    let os = crate::env_info::os_info();
    if !os.is_empty() {
        parts.push(format!("操作系统：{}", os));
    }

    // Shell 信息
    let shell = crate::env_info::shell_name();
    if !shell.is_empty() {
        parts.push(format!("Shell：{}", shell));
    }

    // 语言/区域
    let locale = crate::env_info::locale_info();
    if !locale.is_empty() {
        parts.push(format!("语言/区域：{}", locale));
    }

    // Git 状态
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

    // 已知命令行工具
    let tools = crate::env_info::available_tools();
    if !tools.is_empty() {
        parts.push(format!("\n# 已知命令行工具\n{}", tools));
    }

    // AGENTS.md 内容
    if let Some(md) = agents_md {
        parts.push(format!(
            "\n# AGENTS.md\n以下是指令文件内容，模型必须严格遵守：\n\n{}",
            md
        ));
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
    }

    #[test]
    fn test_build_with_tool_guidance_no_tools() {
        let base = "test prompt";
        let result = build_with_tool_guidance(base, &[]);
        assert_eq!(result, base);
    }

    #[test]
    fn test_build_with_tool_guidance_shell_exec() {
        let base = "test prompt";
        let result = build_with_tool_guidance(base, &["shell_exec"]);
        assert!(result.contains("不要使用 shell_exec 替代"));
    }

    #[test]
    fn test_build_with_tool_guidance_file_tools() {
        let base = "test prompt";
        let result = build_with_tool_guidance(base, &["file_read", "file_edit"]);
        assert!(result.contains("文件操作前必须先通过 file_read 读取"));
    }

    #[test]
    fn test_build_with_tool_guidance_task_tools() {
        let base = "test prompt";
        let result = build_with_tool_guidance(base, &["task_create", "task_update", "task_list"]);
        assert!(result.contains("任务执行策略"));
    }

    #[test]
    fn test_build_with_tool_guidance_all_tools() {
        let base = "test prompt";
        let result = build_with_tool_guidance(
            base,
            &["shell_exec", "file_read", "file_edit", "task_create"],
        );
        assert!(result.contains("不要使用 shell_exec 替代"));
        assert!(result.contains("文件操作前必须先通过 file_read 读取"));
        assert!(result.contains("任务执行策略"));
    }

    #[test]
    fn test_static_prompt_len_custom() {
        let base = "hello world";
        let builder = SystemPromptBuilder::new(Some(base.to_string()));
        assert_eq!(builder.static_prompt_len(), base.len());
    }

    #[test]
    fn test_static_prompt_len_default() {
        let builder = SystemPromptBuilder::new(None);
        let expected_len = format!("{}{}", DEFAULT_SYSTEM_PROMPT, BEHAVIORAL_GUIDANCE).len();
        assert_eq!(builder.static_prompt_len(), expected_len);
    }
}

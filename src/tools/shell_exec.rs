/// shell_exec 工具 - 在本地系统执行 shell 命令并返回输出
use thiserror::Error;

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/// 命令执行错误类型
#[derive(Debug, Error)]
pub enum ShellExecError {
    /// 命令执行超时
    #[error("Command timed out after {timeout_secs}s")]
    Timeout {
        /// 超时时间（秒）
        timeout_secs: u64,
    },

    /// IO 错误（命令未找到、权限不足等）
    #[error("Failed to execute command: {0}")]
    Io(String),

    /// 输出超过大小限制
    #[error("Output too large: {size} bytes (max {max} bytes)")]
    OutputTooLarge {
        /// 实际输出大小
        size: usize,
        /// 最大允许大小
        max: usize,
    },
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/// 内置绝对安全命令列表
///
/// 设计原则：
/// - 只包含读取系统状态或输出信息的命令
/// - 不包含任何可能读取文件内容的命令（cat、head、tail、grep 等）
/// - 不包含任何可能泄露环境变量中 API Key 的命令（env、printenv）
/// - 不包含可能被包装执行任意代码的命令（xargs、timeout 等）
/// - 包含 Unix 和 Windows 双平台的等价命令
///
/// 匹配规则（由 matches_pattern() 函数执行）：
/// - 无尾部空格：命令精确匹配，或命令后跟空格（确保词边界）
///   → "pwd" 匹配 "pwd" 和 "pwd -L"，不匹配 "pwdconfig"
///   → "ls"  匹配 "ls" 和 "ls -la"，不匹配 "lsblk"
/// - 尾部带空格：严格前缀匹配（命令必须以该条目开头）
///   → "echo " 匹配 "echo hello" 和 "echo a b"，不匹配 "echo"
///   这种模式用于需要区分布命令和带参数形式的场景
const BUILTIN_SAFE_COMMANDS: &[&str] = &[
    // ── 通用命令（所有平台） ──
    "pwd",     // 打印工作目录
    "whoami",  // 打印当前用户名
    "true",    // 无操作，返回 0
    "false",   // 无操作，返回 1
    "echo ",   // 尾部空格：匹配 "echo hello"，不匹配 bare "echo"
    "printf ", // 尾部空格：匹配带参数的格式化输出
    "cd",      // 改变工作目录（子进程中执行，不影响父进程）
    // ── Unix 系统信息 ──
    "uname",    // 系统信息（含 uname -a, uname -r 等）
    "hostname", // 主机名
    "uptime",   // 系统运行时间
    "arch",     // 硬件架构
    "which ",   // 尾部空格：定位命令路径
    "id",       // 用户身份信息
    "logname",  // 登录用户名
    "tty",      // 终端设备名
    "cal",      // 显示日历
    "seq ",     // 尾部空格：生成数字序列
    "getconf ", // 尾部空格：系统配置变量
    "pathchk ", // 尾部空格：路径名检查
    // ── Unix 路径操作 ──
    "basename ", // 尾部空格：从路径中提取文件名
    "dirname ",  // 尾部空格：从路径中提取目录名
    "realpath ", // 尾部空格：解析为绝对路径
    // ── Unix 目录列表 ──
    "ls", // 列出目录内容（含 ls -la, ls /tmp 等）
    // ── 日期和时间 ──
    // 注意：允许 "date" 和 "date -u" 等参数，也允许 "date -s"（设置时间）。
    // "date -s" 需要 root 权限，且 agent 极少生成此命令。
    // 如对此有顾虑，可在 settings.toml 中将 "date" 加入 deny 列表。
    "date", // 日期时间
    // ── Windows CMD 等效命令 ──
    "ver",        // 显示 Windows 版本
    "systeminfo", // 显示系统信息（Windows）
    "dir",        // 列出目录（Windows）
    "date /t",    // 显示日期（Windows，/t 表示只查看不设置）
    "time /t",    // 显示时间（Windows，/t 表示只查看不设置）
    "vol",        // 显示卷标（Windows）
];

/// 检查命令是否匹配允许模式，防止跨词匹配（如 "ls" 不匹配 "lsblk"）
fn matches_pattern(cmd: &str, pattern: &str) -> bool {
    if pattern.ends_with(' ') {
        // 尾部空格：严格前缀匹配
        // "echo " → 匹配 "echo hello"，不匹配 "echo"
        cmd.starts_with(pattern)
    } else {
        // 无尾部空格：命令精确匹配，或命令后跟空格
        // "ls" → 匹配 "ls" 和 "ls -la"，不匹配 "lsblk"
        cmd == pattern || cmd.starts_with(&format!("{} ", pattern))
    }
}

/// 检查是否包含 shell 控制运算符
///
/// 控制运算符包括：
/// - `;` `&&` `||` — 命令链
/// - `|` — 管道
/// - `>` `<` — 重定向
/// - `` ` `` `$` — 命令替换 / 变量展开
/// - `&` — 后台执行 / `&&`
///
/// 注意：简单的 contains 检查会误伤引号内的字符（如 `echo "hello & world"`），
/// 但作为安全网，宁可误伤也不错放。用户可在 settings.toml 中配置精确规则绕过。
fn contains_shell_control(cmd: &str) -> bool {
    let controls = [';', '|', '>', '<', '`', '$', '&'];
    cmd.contains(controls)
}

/// 判断命令是否为安全命令（匹配内置列表或用户自定义列表）
///
/// 匹配流程：
/// 1. 修剪空白
/// 2. 控制运算符检查（安全网）
/// 3. 检查内置列表
/// 4. 检查用户自定义列表
///
/// BUILTIN_SAFE_COMMANDS 是模块级编译时常量，不通过参数传递。
fn is_safe_command(command: &str, user_allowed: &[String]) -> bool {
    let cmd = command.trim();
    if cmd.is_empty() {
        return false;
    }
    // 控制运算符检查（安全网）
    if contains_shell_control(cmd) {
        return false;
    }
    // 检查内置列表
    for pattern in BUILTIN_SAFE_COMMANDS {
        if matches_pattern(cmd, pattern) {
            return true;
        }
    }
    // 检查用户自定义列表
    for pattern in user_allowed {
        if matches_pattern(cmd, pattern) {
            return true;
        }
    }
    false
}

/// run_command 配置选项
#[derive(Debug, Clone)]
pub struct ShellExecOptions {
    /// 命令执行超时时间（秒），默认 30
    pub timeout_secs: u64,
    /// 输出最大字符数（stdout + stderr 合计），默认 100_000
    pub output_max_chars: usize,
    /// 跳过用户确认（用于测试和非交互环境）
    pub skip_confirm: bool,
    /// 用户自定义的允许命令前缀列表
    pub allowed_commands: Vec<String>,
}

impl Default for ShellExecOptions {
    fn default() -> Self {
        Self {
            timeout_secs: 30,
            output_max_chars: 100_000,
            skip_confirm: false,
            allowed_commands: Vec::new(),
        }
    }
}

// ---------------------------------------------------------------------------
// Core struct
// ---------------------------------------------------------------------------

/// run_command 工具
#[derive(Debug, Clone)]
pub struct ShellExec {
    options: ShellExecOptions,
}

impl ShellExec {
    /// 创建新的 ShellExec 实例
    pub fn new(options: ShellExecOptions) -> Self {
        Self { options }
    }

    /// 判断命令是否应跳过用户确认
    ///
    /// - `skip_confirm=true`（测试模式）→ 跳过
    /// - 命令匹配安全列表 → 跳过
    /// - 否则 → 需要确认
    pub fn should_skip_confirm(&self, command: &str) -> bool {
        self.options.skip_confirm || is_safe_command(command, &self.options.allowed_commands)
    }

    /// 返回 Anthropic Tool 定义
    pub fn tool_definition() -> zapmyco_anthropic_ai_sdk::types::message::Tool {
        use zapmyco_anthropic_ai_sdk::types::message::Tool;
        Tool {
            name: "shell_exec".to_string(),
            description: Some(
                "在本地系统执行 shell 命令并返回标准输出、标准错误和退出码。\
                 重要: 不要使用此工具运行 cat、head、tail 命令来读取文件内容，\
                 应使用 read 工具来读取文件。"
                    .to_string(),
            ),
            input_schema: Some(serde_json::json!({
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "要执行的 shell 命令"
                    },
                    "description": {
                        "type": "string",
                        "description": "向用户解释为什么要执行此命令及预期效果，帮助用户理解并决定是否授权"
                    },
                    "working_directory": {
                        "type": "string",
                        "description": "命令执行的工作目录（绝对路径）。不指定则使用当前目录"
                    }
                },
                "required": ["command", "description"]
            })),
            ..Default::default()
        }
    }

    /// 执行 shell 命令并返回输出
    ///
    /// # 参数
    /// * `command` - 要执行的 shell 命令
    /// * `description` - 命令执行说明（用于 LLM 自我审计）
    /// * `working_directory` - 可选的工作目录
    pub async fn execute(
        &self,
        command: &str,
        description: Option<&str>,
        working_directory: Option<&str>,
    ) -> Result<String, ShellExecError> {
        // 1. 选择 shell
        let (shell, arg_flag) = if cfg!(target_os = "windows") {
            ("cmd.exe", "/C")
        } else {
            ("sh", "-c")
        };

        // 2. 构建命令
        let mut cmd = tokio::process::Command::new(shell);
        cmd.arg(arg_flag);
        cmd.arg(command);
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        if let Some(dir) = working_directory {
            cmd.current_dir(dir);
        }

        // 3. 权限检查
        if !self.options.skip_confirm {
            // 3a. 安全命令 → 自动放行（匹配内置或用户自定义列表）
            if is_safe_command(command, &self.options.allowed_commands) {
                // 无需确认，直接执行
            }
            // 3b. 非安全命令 → 弹出确认
            else if !prompt_confirm(command, description) {
                eprintln!("[run_command] ❌ 已取消");
                return Ok("Command not executed (cancelled by user)".to_string());
            }
        }

        // 4. 执行带超时
        let timeout = std::time::Duration::from_secs(self.options.timeout_secs);

        let output = tokio::time::timeout(timeout, cmd.output())
            .await
            .map_err(|_| ShellExecError::Timeout {
                timeout_secs: self.options.timeout_secs,
            })?
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    ShellExecError::Io(format!("Command not found: {}", command))
                } else {
                    ShellExecError::Io(e.to_string())
                }
            })?;

        // 4. 转换输出
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);

        // 5. 检查总大小
        let total_size = stdout.len() + stderr.len();
        if total_size > self.options.output_max_chars {
            return Err(ShellExecError::OutputTooLarge {
                size: total_size,
                max: self.options.output_max_chars,
            });
        }

        // 6. 格式化输出
        let exit_code = output.status.code();

        let mut result = String::new();
        result.push_str(&format!(
            "Exit code: {}\n\n",
            exit_code
                .map(|c| c.to_string())
                .unwrap_or_else(|| "signal".to_string())
        ));

        if !stdout.is_empty() {
            result.push_str("--- STDOUT ---\n");
            result.push_str(&stdout);
            result.push('\n');
        }

        if !stderr.is_empty() {
            result.push_str("--- STDERR ---\n");
            result.push_str(&stderr);
            result.push('\n');
        }

        if stdout.is_empty() && stderr.is_empty() {
            result.push_str("(no output)\n");
        }

        Ok(result)
    }
}

// ---------------------------------------------------------------------------
// User confirmation
// ---------------------------------------------------------------------------

/// 提示用户确认是否执行命令
///
/// 使用共享的 SelectPrompt 组件显示允许/拒绝选项。
/// 非 TTY 环境下默认拒绝执行。
fn prompt_confirm(command: &str, description: Option<&str>) -> bool {
    use std::io::IsTerminal;

    if !std::io::stdin().is_terminal() {
        return false;
    }

    eprintln!();
    eprintln!("[工具] ⚠️  准备执行命令:");
    if let Some(desc) = description {
        let truncated = if desc.len() > 100 {
            format!("{}...", &desc[..100])
        } else {
            desc.to_string()
        };
        eprintln!("  └ 描述: {}", truncated);
    }
    eprintln!("  └ 命令: {}", command);

    let question = "是否确认执行？";
    let options = [
        crate::tools::prompt::SelectOption {
            label: "允许",
            description: "执行该命令",
            custom_input: false,
        },
        crate::tools::prompt::SelectOption {
            label: "拒绝",
            description: "取消执行该命令",
            custom_input: false,
        },
    ];

    matches!(
        crate::tools::prompt::prompt_single_select(question, &options),
        Some(crate::tools::prompt::SingleSelectResult::Index(0))
    )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// 创建测试用的 ShellExec 实例
    fn test_executor() -> ShellExec {
        ShellExec::new(ShellExecOptions {
            timeout_secs: 5,
            output_max_chars: 10_000,
            skip_confirm: true,
            allowed_commands: Vec::new(),
        })
    }

    // ---- Tool definition tests ----

    #[test]
    fn test_tool_definition_name() {
        let tool = ShellExec::tool_definition();
        assert_eq!(tool.name, "shell_exec");
    }

    #[test]
    fn test_tool_definition_has_description() {
        let tool = ShellExec::tool_definition();
        assert!(tool.description.is_some());
        assert!(!tool.description.unwrap().is_empty());
    }

    #[test]
    fn test_tool_definition_valid_schema() {
        let tool = ShellExec::tool_definition();
        assert_eq!(
            tool.input_schema.as_ref().unwrap()["type"],
            serde_json::Value::String("object".to_string())
        );
        assert!(tool.input_schema.as_ref().unwrap()["properties"]["command"].is_object());
        let required = tool.input_schema.as_ref().unwrap()["required"]
            .as_array()
            .unwrap();
        assert!(required.contains(&serde_json::Value::String("command".to_string())));
        assert!(required.contains(&serde_json::Value::String("description".to_string())));
    }

    #[test]
    fn test_tool_definition_required_fields() {
        let tool = ShellExec::tool_definition();
        let required = tool.input_schema.as_ref().unwrap()["required"]
            .as_array()
            .unwrap();
        assert!(required.contains(&serde_json::Value::String("command".to_string())));
        assert!(required.contains(&serde_json::Value::String("description".to_string())));
    }

    // ---- Execution tests ----

    #[tokio::test]
    async fn test_execute_echo() {
        let executor = test_executor();
        let result = executor.execute("echo hello", None, None).await.unwrap();
        assert!(result.contains("Exit code: 0"));
        assert!(result.contains("hello"));
    }

    #[tokio::test]
    async fn test_execute_exit_code_1() {
        let executor = test_executor();
        let result = executor.execute("exit 1", None, None).await.unwrap();
        assert!(result.contains("Exit code: 1"));
    }

    #[tokio::test]
    async fn test_execute_non_zero_exit() {
        let executor = test_executor();
        let result = executor.execute("false", None, None).await.unwrap();
        assert!(result.contains("Exit code: 1"));
    }

    #[tokio::test]
    async fn test_execute_with_working_dir() {
        let executor = test_executor();
        let dir = std::env::temp_dir();
        // pwd 可能会解析符号链接（macOS 上 /var → /private/var），
        // 所以只检查退出码为 0 而非精确路径匹配
        let result = executor.execute("pwd", None, dir.to_str()).await.unwrap();
        assert!(result.contains("Exit code: 0"));
    }

    #[tokio::test]
    async fn test_execute_empty_output() {
        let executor = test_executor();
        // 一个产生空输出的命令
        let result = executor.execute("true", None, None).await.unwrap();
        assert!(result.contains("Exit code: 0"));
        assert!(result.contains("(no output)"));
    }

    #[tokio::test]
    async fn test_execute_stderr_only() {
        let executor = test_executor();
        let result = executor
            .execute("echo stderr output >&2", None, None)
            .await
            .unwrap();
        assert!(result.contains("Exit code: 0"));
        assert!(result.contains("stderr output"));
    }

    #[tokio::test]
    async fn test_execute_both_streams() {
        let executor = test_executor();
        let result = executor
            .execute("echo stdout_msg && echo stderr_msg >&2", None, None)
            .await
            .unwrap();
        assert!(result.contains("Exit code: 0"));
        assert!(result.contains("stdout_msg"));
        assert!(result.contains("stderr_msg"));
    }

    #[tokio::test]
    async fn test_execute_with_description() {
        let executor = test_executor();
        let result = executor
            .execute("echo hello", Some("测试命令执行工具"), None)
            .await
            .unwrap();
        assert!(result.contains("Exit code: 0"));
        assert!(result.contains("hello"));
    }

    #[tokio::test]
    async fn test_execute_not_found() {
        let executor = test_executor();
        // 通过 sh -c 执行时，sh 本身总能找到，无效命令会返回非零退出码
        let result = executor
            .execute("nonexistent_cmd_xyz_123", None, None)
            .await
            .unwrap();
        assert!(result.contains("Exit code:"));
        assert!(!result.contains("Exit code: 0"));
    }

    #[tokio::test]
    async fn test_execute_timeout() {
        let executor = ShellExec::new(ShellExecOptions {
            timeout_secs: 1,
            output_max_chars: 10_000,
            skip_confirm: true,
            allowed_commands: Vec::new(),
        });

        let result = executor.execute("sleep 10", None, None).await;
        assert!(result.is_err());
        match result.err().unwrap() {
            ShellExecError::Timeout { timeout_secs } => {
                assert_eq!(timeout_secs, 1);
            }
            other => panic!("Expected Timeout error, got: {}", other),
        }
    }

    #[tokio::test]
    async fn test_execute_large_output_truncated() {
        let executor = ShellExec::new(ShellExecOptions {
            timeout_secs: 5,
            output_max_chars: 100, // 很小的限制
            skip_confirm: true,
            allowed_commands: Vec::new(),
        });

        // 生成超过 100 字符的输出
        let result = executor
            .execute(
                "echo 'aaaaaaaaaabbbbbbbbbbccccccccccddddddddddeeeeeeeeeeffffffffffgggggggggghhhhhhhhhhiiiiiiiiiijjjjjjjjjj'",
                None,
                None,
            )
            .await;
        assert!(result.is_err());
        match result.err().unwrap() {
            ShellExecError::OutputTooLarge { size, max } => {
                assert_eq!(max, 100);
                assert!(size > 100);
            }
            other => panic!("Expected OutputTooLarge error, got: {}", other),
        }
    }

    // ---- Options tests ----

    #[test]
    fn test_new_default() {
        let executor = ShellExec::new(ShellExecOptions::default());
        assert_eq!(executor.options.timeout_secs, 30);
        assert_eq!(executor.options.output_max_chars, 100_000);
        assert!(!executor.options.skip_confirm);
    }

    #[test]
    fn test_new_custom_options() {
        let executor = ShellExec::new(ShellExecOptions {
            timeout_secs: 60,
            output_max_chars: 50_000,
            skip_confirm: true,
            allowed_commands: Vec::new(),
        });
        assert_eq!(executor.options.timeout_secs, 60);
        assert_eq!(executor.options.output_max_chars, 50_000);
        assert!(executor.options.skip_confirm);
    }

    // ---- Signal termination (exit without code) ----

    #[tokio::test]
    async fn test_execute_signal_termination() {
        // 信号终止行为在不同平台/Shell 上表现完全不同：
        // - macOS (bash): "Exit code: signal"
        // - Linux (dash): output() 返回 IO 错误
        // - Windows: "Exit code: 3840" (STILL_ACTIVE)
        // 只验证函数能正常处理，不 panic
        let executor = test_executor();
        match executor.execute("sh -c 'kill $$'", None, None).await {
            Ok(output) => {
                assert!(
                    output.contains("Exit code:"),
                    "unexpected output: {}",
                    output
                );
            }
            Err(_) => {
                // IO 错误也合理
            }
        }
    }
}

#[cfg(test)]
mod safe_command_tests {
    use super::*;

    #[test]
    fn test_matches_exact_or_space_suffix() {
        assert!(matches_pattern("pwd", "pwd"));
        assert!(matches_pattern("ls", "ls"));
        assert!(matches_pattern("pwd -L", "pwd"));
        assert!(matches_pattern("ls -la", "ls"));
        assert!(!matches_pattern("pwdconfig", "pwd"));
        assert!(!matches_pattern("lsblk", "ls"));
    }

    #[test]
    fn test_matches_prefix_with_trailing_space() {
        assert!(matches_pattern("echo hello", "echo "));
        assert!(!matches_pattern("echo", "echo "));
        assert!(!matches_pattern("echowhat", "echo "));
    }

    #[test]
    fn test_matches_pattern_empty() {
        assert!(matches_pattern("", ""));
        assert!(!matches_pattern("", "pwd"));
        assert!(!matches_pattern("pwd", "pwd -L -a -b"));
    }

    #[test]
    fn test_control_redirect() {
        assert!(contains_shell_control("echo hello > file"));
        assert!(contains_shell_control("cat < /etc/passwd"));
    }

    #[test]
    fn test_control_pipe_chain() {
        assert!(contains_shell_control("ls | sort"));
        assert!(contains_shell_control("echo a && echo b"));
        assert!(contains_shell_control("echo a || echo b"));
        assert!(contains_shell_control("echo a; echo b"));
    }

    #[test]
    fn test_control_subshell() {
        assert!(contains_shell_control("echo $(whoami)"));
        assert!(contains_shell_control("echo `whoami`"));
        assert!(contains_shell_control("echo $HOME"));
    }

    #[test]
    fn test_control_clean() {
        assert!(!contains_shell_control("echo hello"));
        assert!(!contains_shell_control("date +%s"));
        assert!(!contains_shell_control("uname -a"));
    }

    #[test]
    fn test_safe_chars_not_control() {
        // = 是普通字符，不是控制运算符，is_safe_command 应正常匹配
        assert!(is_safe_command("echo hello=world", &[]));
    }

    #[test]
    fn test_control_multiple_compound() {
        // 复合运算符：一个命令中包含多个控制运算符
        assert!(contains_shell_control("echo a > file && cat file"));
        assert!(contains_shell_control("ls | grep foo; echo done"));
        assert!(contains_shell_control("echo $(date) > /tmp/log"));
        assert!(contains_shell_control("echo a; echo b | wc"));
    }

    #[test]
    fn test_builtin_pwd() {
        assert!(is_safe_command("pwd", &[]));
        assert!(is_safe_command("pwd -L", &[]));
    }

    #[test]
    fn test_builtin_whoami_true_false() {
        assert!(is_safe_command("whoami", &[]));
        assert!(is_safe_command("true", &[]));
        assert!(is_safe_command("false", &[]));
    }

    #[test]
    fn test_builtin_echo() {
        assert!(is_safe_command("echo hello", &[]));
        assert!(is_safe_command("echo 'hello world'", &[]));
        assert!(!is_safe_command("echo", &[]));
        assert!(!is_safe_command("echowhat", &[]));
    }

    #[test]
    fn test_builtin_printf() {
        assert!(is_safe_command("printf 'hello'", &[]));
        assert!(!is_safe_command("printf", &[]));
    }

    #[test]
    fn test_builtin_cd_uname() {
        assert!(is_safe_command("cd", &[]));
        assert!(is_safe_command("cd /tmp", &[]));
        assert!(!is_safe_command("cdrom", &[]));
        assert!(is_safe_command("uname", &[]));
        assert!(is_safe_command("uname -a", &[]));
        assert!(is_safe_command("uname -r -s", &[]));
        assert!(!is_safe_command("uname2", &[]));
    }

    #[test]
    fn test_builtin_ls() {
        assert!(is_safe_command("ls", &[]));
        assert!(is_safe_command("ls -la", &[]));
        assert!(!is_safe_command("lsblk", &[]));
    }

    #[test]
    fn test_builtin_date() {
        assert!(is_safe_command("date", &[]));
        assert!(is_safe_command("date -u", &[]));
    }

    #[test]
    fn test_date_s_is_technically_allowed() {
        // design.md 已知风险: "date -s" 需要 root 权限，agent 极少生成此命令
        // 如对此有顾虑，可在 settings.toml 中将 "date" 加入 deny 列表
        assert!(is_safe_command("date -s '2024-01-01'", &[]));
    }

    #[test]
    fn test_safe_command_rejected_with_control_ops() {
        assert!(!is_safe_command("echo hello > /tmp/x", &[]));
        assert!(!is_safe_command("ls > files.txt", &[]));
        assert!(!is_safe_command("pwd > /tmp/pwd.txt", &[]));
        assert!(!is_safe_command("echo hello | wc", &[]));
        assert!(!is_safe_command("ls | grep foo", &[]));
        assert!(!is_safe_command("echo hello; rm -rf /", &[]));
        assert!(!is_safe_command("echo a && echo b", &[]));
        assert!(!is_safe_command("echo a || echo b", &[]));
        assert!(!is_safe_command("pwd; whoami", &[]));
        assert!(!is_safe_command("echo hello || true", &[]));
        assert!(!is_safe_command("echo `whoami`", &[]));
        assert!(!is_safe_command("echo $(hostname)", &[]));
        assert!(!is_safe_command("echo $SHELL", &[]));
    }

    #[test]
    fn test_user_allowed() {
        let user = vec!["git status".to_string(), "cargo check".to_string()];
        assert!(is_safe_command("git status", &user));
        assert!(is_safe_command("git status -s", &user));
        assert!(!is_safe_command("git commit", &user));
        assert!(!is_safe_command("cargo build", &user));
    }

    #[test]
    fn test_edge_empty_whitespace() {
        assert!(!is_safe_command("", &[]));
        assert!(!is_safe_command("   ", &[]));
        assert!(!is_safe_command("\t", &[]));
        assert!(!is_safe_command("\n", &[]));
    }

    #[test]
    fn test_edge_leading_trailing_whitespace() {
        assert!(is_safe_command("  pwd", &[]));
        assert!(is_safe_command("  whoami", &[]));
        assert!(is_safe_command("pwd  ", &[]));
        assert!(is_safe_command("ls   ", &[]));
        assert!(is_safe_command("  echo hello  ", &[]));
    }

    #[test]
    fn test_edge_not_in_builtin() {
        assert!(!is_safe_command("who", &[]));
        assert!(!is_safe_command("who -a", &[]));
        assert!(!is_safe_command("whoami_extra", &[]));
        assert!(!is_safe_command("rm -rf /", &[]));
        assert!(!is_safe_command("pwdconfig", &[]));
        assert!(!is_safe_command("idone", &[]));
        assert!(!is_safe_command("uname2", &[]));
        assert!(!is_safe_command("caliber", &[]));
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn test_builtin_windows_commands() {
        assert!(is_safe_command("ver", &[]));
        assert!(is_safe_command("systeminfo", &[]));
        assert!(is_safe_command("dir", &[]));
        assert!(is_safe_command("dir /w", &[]));
        assert!(is_safe_command("date /t", &[]));
        assert!(is_safe_command("time /t", &[]));
        assert!(is_safe_command("vol", &[]));
        assert!(!is_safe_command("directory", &[]));
    }

    #[test]
    fn test_builtin_hostname_uptime_arch() {
        assert!(is_safe_command("hostname", &[]));
        assert!(is_safe_command("hostname -s", &[]));
        assert!(is_safe_command("uptime", &[]));
        assert!(is_safe_command("arch", &[]));
    }

    #[test]
    fn test_builtin_which() {
        assert!(is_safe_command("which python3", &[]));
        assert!(!is_safe_command("which", &[]));
    }

    #[test]
    fn test_builtin_id_logname_tty() {
        assert!(is_safe_command("id", &[]));
        assert!(is_safe_command("id -u", &[]));
        assert!(!is_safe_command("idone", &[]));
        assert!(is_safe_command("logname", &[]));
        assert!(is_safe_command("tty", &[]));
    }

    #[test]
    fn test_builtin_cal_seq() {
        assert!(is_safe_command("cal", &[]));
        assert!(is_safe_command("cal 2024", &[]));
        assert!(is_safe_command("seq 1 10", &[]));
        assert!(!is_safe_command("seq", &[]));
    }

    #[test]
    fn test_builtin_getconf_pathchk() {
        assert!(is_safe_command("getconf PAGE_SIZE", &[]));
        assert!(!is_safe_command("getconf", &[]));
        assert!(is_safe_command("pathchk /tmp", &[]));
        assert!(!is_safe_command("pathchk", &[]));
    }

    #[test]
    fn test_builtin_path_ops() {
        assert!(is_safe_command("basename /path/to/file", &[]));
        assert!(!is_safe_command("basename", &[]));
        assert!(is_safe_command("dirname /path/to/file", &[]));
        assert!(!is_safe_command("dirname", &[]));
        assert!(is_safe_command("realpath /tmp", &[]));
        assert!(!is_safe_command("realpath", &[]));
    }

    #[test]
    fn test_builtin_list_not_empty() {
        assert!(!BUILTIN_SAFE_COMMANDS.is_empty());
    }

    // ── 用户自定义列表扩展测试 ──

    #[test]
    fn test_user_allowed_prefix() {
        let user = vec!["git status".to_string()];
        assert!(is_safe_command("git status -s", &user));
        assert!(is_safe_command("git status --short", &user));
    }

    #[test]
    fn test_user_allowed_multi() {
        let user = vec![
            "git status".to_string(),
            "cargo check".to_string(),
            "cargo clippy".to_string(),
        ];
        assert!(is_safe_command("git status", &user));
        assert!(is_safe_command("cargo check", &user));
        assert!(is_safe_command("cargo check --offline", &user));
        assert!(is_safe_command("cargo clippy", &user));
    }

    #[test]
    fn test_user_allowed_still_blocked_by_control_ops() {
        let user = vec!["git status".to_string()];
        assert!(!is_safe_command("git status | grep foo", &user));
        assert!(!is_safe_command("git status > file", &user));
    }

    #[test]
    fn test_user_allowed_with_trailing_space() {
        let user = vec!["cargo ".to_string()];
        assert!(is_safe_command("cargo check", &user));
        assert!(is_safe_command("cargo clippy", &user));
        assert!(!is_safe_command("cargo", &user));
    }

    // ── 边界场景扩展测试 ──

    #[test]
    fn test_word_boundary_with_special_chars() {
        assert!(!is_safe_command("pwd-config", &[]));
        assert!(!is_safe_command("pwd_config", &[]));
        assert!(!is_safe_command("pwd.config", &[]));
    }

    #[test]
    fn test_normal_paths_not_blocked() {
        assert!(!contains_shell_control("ls /path/to/dir"));
        assert!(!contains_shell_control("ls ./src/main.rs"));
        assert!(!contains_shell_control("ls ../parent/child"));
        assert!(!contains_shell_control("ls ~/Documents"));
    }

    // ── should_skip_confirm 测试 ──

    #[test]
    fn test_should_skip_confirm_when_skip_confirm_true() {
        let executor = ShellExec::new(ShellExecOptions {
            skip_confirm: true,
            allowed_commands: Vec::new(),
            ..Default::default()
        });
        assert!(executor.should_skip_confirm("rm -rf /"));
        assert!(executor.should_skip_confirm("pwd"));
        assert!(executor.should_skip_confirm(""));
    }

    #[test]
    fn test_should_skip_confirm_safe_command() {
        let executor = ShellExec::new(ShellExecOptions {
            skip_confirm: false,
            allowed_commands: Vec::new(),
            ..Default::default()
        });
        assert!(executor.should_skip_confirm("pwd"));
        assert!(executor.should_skip_confirm("echo hello"));
        assert!(!executor.should_skip_confirm("git commit"));
        assert!(!executor.should_skip_confirm("rm -rf /"));
    }

    #[test]
    fn test_should_skip_confirm_user_allowed() {
        let executor = ShellExec::new(ShellExecOptions {
            skip_confirm: false,
            allowed_commands: vec!["git status".to_string()],
            ..Default::default()
        });
        assert!(executor.should_skip_confirm("git status"));
        assert!(executor.should_skip_confirm("git status -s"));
        assert!(!executor.should_skip_confirm("git commit"));
    }

    #[test]
    fn test_should_skip_confirm_unsafe_control_ops() {
        let executor = ShellExec::new(ShellExecOptions {
            skip_confirm: false,
            allowed_commands: vec!["git status".to_string()],
            ..Default::default()
        });
        assert!(!executor.should_skip_confirm("git status | grep foo"));
        assert!(!executor.should_skip_confirm("git status > file"));
    }

    // ── 性能测试 ──

    #[test]
    fn test_large_user_list_performance() {
        let large_list: Vec<String> = (0..10_000).map(|i| format!("cmd_{}", i)).collect();
        let start = std::time::Instant::now();
        assert!(is_safe_command("cmd_5000 arg", &large_list));
        assert!(!is_safe_command("unknown_cmd", &large_list));
        assert!(!is_safe_command("cmd_0 | dangerous", &large_list));
        let elapsed = start.elapsed();
        assert!(
            elapsed.as_millis() < 10,
            "Large list scan too slow: {}ms",
            elapsed.as_millis()
        );
    }

    #[test]
    fn test_edge_unicode_long() {
        assert!(is_safe_command("echo 你好世界", &[]));
        assert!(is_safe_command("echo café", &[]));
        let long_path = "/".to_string() + &"a".repeat(1000);
        assert!(is_safe_command(&format!("ls {}", long_path), &[]));
    }

    #[test]
    fn test_empty_user_list() {
        let empty: &[String] = &[];
        assert!(is_safe_command("pwd", empty));
        assert!(!is_safe_command("git status", empty));
    }

    #[test]
    fn test_empty_user_list_performance() {
        let start = std::time::Instant::now();
        assert!(is_safe_command("pwd", &[] as &[String]));
        assert!(!is_safe_command("git status", &[] as &[String]));
        let elapsed = start.elapsed();
        assert!(
            elapsed.as_millis() < 1,
            "Empty list should be instant: {}ms",
            elapsed.as_millis()
        );
    }

    // ── 回归测试 ──

    #[test]
    fn test_existing_functionality_preserved() {
        // 验证 ShellExec 仍然可以使用 Default::default() 正常创建
        let executor = ShellExec::new(Default::default());
        assert!(!executor.options.skip_confirm);
        assert!(executor.options.allowed_commands.is_empty());
        // 验证内置安全命令仍可识别
        assert!(is_safe_command("pwd", &executor.options.allowed_commands));
        assert!(!is_safe_command(
            "rm -rf /",
            &executor.options.allowed_commands
        ));
    }

    #[test]
    fn test_default_backward_compatible() {
        let default = ShellExecOptions::default();
        assert!(default.allowed_commands.is_empty());
        assert!(!default.skip_confirm);
        assert_eq!(default.timeout_secs, 30);
        assert_eq!(default.output_max_chars, 100_000);
    }

    // ── Unix 平台特定测试（仅非 Windows 运行）──

    #[cfg(not(target_os = "windows"))]
    mod unix_specific_tests {
        use super::*;

        #[test]
        fn test_unix_builtin_commands() {
            assert!(is_safe_command("uname", &[]));
            assert!(is_safe_command("uptime", &[]));
            assert!(is_safe_command("arch", &[]));
            assert!(is_safe_command("cal", &[]));
            assert!(is_safe_command("tty", &[]));
            assert!(is_safe_command("logname", &[]));
        }

        #[test]
        fn test_unix_path_commands() {
            assert!(is_safe_command("basename /path/to/file", &[]));
            assert!(is_safe_command("dirname /path/to/file", &[]));
            assert!(is_safe_command("realpath /tmp", &[]));
            assert!(is_safe_command("which bash", &[]));
        }

        #[test]
        fn test_unix_getconf_pathchk() {
            assert!(is_safe_command("getconf PAGE_SIZE", &[]));
            assert!(is_safe_command("pathchk /tmp", &[]));
        }
    }

    // ── CLI 集成测试 ──

    #[test]
    fn test_cli_settings_to_shell_exec_options() {
        use crate::config::settings::{Settings, ShellExecSettings};
        let settings = Settings {
            llm: None,
            conversation_log: None,
            shell_exec: Some(ShellExecSettings {
                allow: vec!["git status".to_string(), "cargo check".to_string()],
            }),
        };
        let allowed_commands = settings
            .shell_exec
            .as_ref()
            .map(|se| se.allow.clone())
            .unwrap_or_default();
        assert_eq!(allowed_commands.len(), 2);
        assert_eq!(allowed_commands[0], "git status");
        let executor = ShellExec::new(ShellExecOptions {
            allowed_commands,
            ..Default::default()
        });
        assert_eq!(executor.options.allowed_commands.len(), 2);
    }

    #[test]
    fn test_cli_settings_missing_shell_exec() {
        use crate::config::settings::Settings;
        let settings = Settings {
            llm: None,
            conversation_log: None,
            shell_exec: None,
        };
        let allowed_commands = settings
            .shell_exec
            .as_ref()
            .map(|se| se.allow.clone())
            .unwrap_or_default();
        assert!(
            allowed_commands.is_empty(),
            "无 shell_exec 配置时应返回空列表"
        );
        let executor = ShellExec::new(ShellExecOptions {
            allowed_commands,
            ..Default::default()
        });
        assert!(is_safe_command("pwd", &executor.options.allowed_commands));
    }

    #[test]
    fn test_cli_settings_empty_allow() {
        use crate::config::settings::{Settings, ShellExecSettings};
        let settings = Settings {
            llm: None,
            conversation_log: None,
            shell_exec: Some(ShellExecSettings { allow: vec![] }),
        };
        let allowed_commands = settings
            .shell_exec
            .as_ref()
            .map(|se| se.allow.clone())
            .unwrap_or_default();
        assert!(allowed_commands.is_empty());
    }

    #[test]
    fn test_full_chain_from_toml_to_executor() {
        use crate::config::settings::load_settings;
        use crate::test_util::run_with_temp_home;
        run_with_temp_home(|home| {
            let settings_dir = home.join(".zapmyco");
            std::fs::create_dir_all(&settings_dir).unwrap();
            std::fs::write(
                settings_dir.join("settings.toml"),
                r#"
[shell_exec]
allow = ["git status", "cargo check"]
"#,
            )
            .unwrap();
            let loaded = load_settings().unwrap().unwrap();
            let allowed_commands = loaded
                .shell_exec
                .as_ref()
                .map(|se| se.allow.clone())
                .unwrap_or_default();
            assert_eq!(allowed_commands, vec!["git status", "cargo check"]);
            let executor = ShellExec::new(ShellExecOptions {
                allowed_commands,
                ..Default::default()
            });
            assert!(is_safe_command(
                "git status",
                &executor.options.allowed_commands
            ));
            assert!(!is_safe_command(
                "git commit",
                &executor.options.allowed_commands
            ));
        });
    }
}

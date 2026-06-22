/// shell_exec 工具 - 在本地系统执行 shell 命令并返回输出
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use thiserror::Error;

use crate::output::{self, Message};

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
// Command splitter — 将复合 shell 命令拆分为独立子命令
// ---------------------------------------------------------------------------

/// 子命令片段的危险特征标记
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct CommandFlags {
    /// 包含文件重定向（> < >> >& &> << <& <> >|）
    pub has_redirect: bool,
    /// 包含命令替换（$() `...`）— 可以执行嵌入代码
    pub has_substitution: bool,
}

/// 拆分出的子命令片段
#[derive(Debug)]
pub(crate) struct CommandPart<'a> {
    /// 子命令文本（trimmed）
    pub text: &'a str,
    /// 在原字符串中的位置
    pub range: std::ops::Range<usize>,
    /// 危险特征标记
    pub flags: CommandFlags,
}

/// 命令拆分结果
#[derive(Debug)]
pub(crate) struct SplitResult<'a> {
    /// 拆分出的子命令片段
    pub parts: Vec<CommandPart<'a>>,
}

/// split_commands 状态机状态
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SplitState {
    Normal,
    SingleQuote,
    DoubleQuote,
    CommandSubst, // $()
    ParamSubst,   // ${}
    Backtick,     // `...`
    Escape,       // \x
}

/// 将复合命令拆分为独立子命令，同时标记每个子命令的危险特征。
///
/// 状态机逐字符扫描，在顶层控制运算符（&& || ; | &）处拆分，
/// 同时正确跳过引号内、$() 内、${} 内、反引号内的运算符。
///
/// # 示例
///
/// ```ignore
/// // 此函数是 crate 内部函数，在单元测试中使用
/// let r = split_commands("git status && cargo build");
/// assert_eq!(r.parts.len(), 2);
/// ```
pub(crate) fn split_commands(cmd: &str) -> SplitResult<'_> {
    let chars: Vec<char> = cmd.chars().collect();
    let mut parts: Vec<CommandPart<'_>> = Vec::new();
    let mut part_start = 0;
    let mut state = SplitState::Normal;

    let mut cur_redirect = false;
    let mut cur_subst = false;

    let mut paren_depth = 0;
    let mut brace_depth = 0;

    let mut i = 0;
    while i < chars.len() {
        match state {
            SplitState::Normal => {
                if chars[i] == '\'' {
                    state = SplitState::SingleQuote;
                    i += 1;
                } else if chars[i] == '"' {
                    state = SplitState::DoubleQuote;
                    i += 1;
                } else if chars[i] == '\\' {
                    state = SplitState::Escape;
                    i += 1;
                } else if chars[i] == '`' {
                    cur_subst = true;
                    state = SplitState::Backtick;
                    i += 1;
                } else if chars[i] == '$' && i + 1 < chars.len() {
                    match chars[i + 1] {
                        '(' => {
                            cur_subst = true;
                            paren_depth = 1;
                            state = SplitState::CommandSubst;
                            i += 2;
                        }
                        '{' => {
                            brace_depth = 1;
                            state = SplitState::ParamSubst;
                            i += 2;
                        }
                        _ => {
                            i += 1;
                        }
                    }
                } else if chars[i] == ';' {
                    let end = i + 1;
                    push_part(cmd, &mut parts, part_start, i, cur_redirect, cur_subst);
                    cur_redirect = false;
                    cur_subst = false;
                    part_start = end;
                    i = end;
                } else if chars[i] == '|' {
                    let end = if i + 1 < chars.len() && matches!(chars[i + 1], '|' | '&') {
                        i + 2
                    } else {
                        i + 1
                    };
                    push_part(cmd, &mut parts, part_start, i, cur_redirect, cur_subst);
                    cur_redirect = false;
                    cur_subst = false;
                    part_start = end;
                    i = end;
                } else if chars[i] == '&' {
                    if i + 1 < chars.len() && chars[i + 1] == '>' {
                        // &> 是重定向（stdout+stderr 到文件）
                        cur_redirect = true;
                        i += 2;
                    } else if i + 1 < chars.len() && chars[i + 1] == '&' {
                        let end = i + 2;
                        push_part(cmd, &mut parts, part_start, i, cur_redirect, cur_subst);
                        cur_redirect = false;
                        cur_subst = false;
                        part_start = end;
                        i = end;
                    } else {
                        // & 是后台执行运算符
                        let end = i + 1;
                        push_part(cmd, &mut parts, part_start, i, cur_redirect, cur_subst);
                        cur_redirect = false;
                        cur_subst = false;
                        part_start = end;
                        i = end;
                    }
                } else if chars[i] == '>' || chars[i] == '<' {
                    cur_redirect = true;
                    i += 1;
                    while i < chars.len() && matches!(chars[i], '>' | '<' | '&' | '|') {
                        i += 1;
                    }
                } else {
                    i += 1;
                }
            }

            SplitState::SingleQuote => {
                if chars[i] == '\'' {
                    state = SplitState::Normal;
                }
                i += 1;
            }

            SplitState::DoubleQuote => {
                if chars[i] == '"' {
                    state = SplitState::Normal;
                    i += 1;
                } else if chars[i] == '\\' {
                    i += 2;
                } else if chars[i] == '$' && i + 1 < chars.len() && chars[i + 1] == '(' {
                    cur_subst = true;
                    paren_depth = 1;
                    state = SplitState::CommandSubst;
                    i += 2;
                } else if chars[i] == '`' {
                    cur_subst = true;
                    state = SplitState::Backtick;
                    i += 1;
                } else {
                    i += 1;
                }
            }

            SplitState::CommandSubst => {
                if chars[i] == '(' {
                    paren_depth += 1;
                } else if chars[i] == ')' {
                    paren_depth -= 1;
                    if paren_depth == 0 {
                        state = SplitState::Normal;
                    }
                } else if chars[i] == '\'' {
                    state = SplitState::SingleQuote;
                } else if chars[i] == '"' {
                    state = SplitState::DoubleQuote;
                } else if chars[i] == '\\' {
                    i += 1;
                }
                i += 1;
            }

            SplitState::ParamSubst => {
                if chars[i] == '{' {
                    brace_depth += 1;
                } else if chars[i] == '}' {
                    brace_depth -= 1;
                    if brace_depth == 0 {
                        state = SplitState::Normal;
                    }
                } else if chars[i] == '\'' {
                    state = SplitState::SingleQuote;
                } else if chars[i] == '"' {
                    state = SplitState::DoubleQuote;
                } else if chars[i] == '\\' {
                    i += 1;
                }
                i += 1;
            }

            SplitState::Backtick => {
                if chars[i] == '`' {
                    state = SplitState::Normal;
                } else if chars[i] == '\\' {
                    i += 1;
                }
                i += 1;
            }

            SplitState::Escape => {
                state = SplitState::Normal;
                i += 1;
            }
        }
    }

    // 最后一段
    push_part(
        cmd,
        &mut parts,
        part_start,
        cmd.len(),
        cur_redirect,
        cur_subst,
    );

    SplitResult { parts }
}

/// 如果区间内有非空白内容，则加入 parts，携带当前累积的危险特征
fn push_part<'a>(
    cmd: &'a str,
    parts: &mut Vec<CommandPart<'a>>,
    start: usize,
    end: usize,
    has_redirect: bool,
    has_substitution: bool,
) {
    let text = cmd[start..end].trim();
    if !text.is_empty() {
        parts.push(CommandPart {
            text,
            range: start..end,
            flags: CommandFlags {
                has_redirect,
                has_substitution,
            },
        });
    }
}

// ---------------------------------------------------------------------------
// CWD tracking helpers
// ---------------------------------------------------------------------------

/// 原子计数器，确保并发安全的临时文件路径
static ZMD_COUNTER: AtomicU64 = AtomicU64::new(0);

/// 生成唯一临时目录路径（自动创建目录）
fn zmd_temp_dir() -> PathBuf {
    let pid = std::process::id();
    let n = ZMD_COUNTER.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("zmd-{}-{}", pid, n));
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// 临时目录清理守卫（Drop 时自动删除）
struct ZmdTempGuard {
    path: Option<PathBuf>,
}

impl ZmdTempGuard {
    fn new(path: PathBuf) -> Self {
        Self { path: Some(path) }
    }
}

impl Drop for ZmdTempGuard {
    fn drop(&mut self) {
        if let Some(ref path) = self.path {
            let _ = std::fs::remove_dir_all(path);
        }
    }
}

/// 读取 CWD 文件，失败时回退到 working_directory
fn read_cwd_file(cwd_file: &Path, working_directory: Option<&str>) -> String {
    std::fs::read_to_string(cwd_file)
        .map(|s| s.trim().to_string())
        .ok()
        .filter(|s| !s.is_empty())
        .or_else(|| working_directory.map(|s| s.to_string()))
        .unwrap_or_else(|| "unknown".to_string())
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
    "date", // 日期时间
    // ── Windows CMD 等效命令 ──
    "ver",        // 显示 Windows 版本
    "systeminfo", // 显示系统信息（Windows）
    "dir",        // 列出目录（Windows）
    "date /t",    // 显示日期（Windows，/t 表示只查看不设置）
    "time /t",    // 显示时间（Windows，/t 表示只查看不设置）
    "vol",        // 显示卷标（Windows）
];

/// 用户选择"始终允许"时禁止自动加入白名单的危险命令
///
/// 这些命令如果被误加入白名单，可能导致严重的安全问题。
/// 用户仍然可以手动编辑 settings.toml 添加，但在交互式"始终允许"时被阻止。
const DANGEROUS_ALWAYS_ALLOW_COMMANDS: &[&str] = &[
    "rm",      // 删除文件/目录
    "sudo",    // 提权执行
    "dd",      // 直接磁盘操作
    "chmod",   // 修改权限
    "chown",   // 修改所有者
    "mv",      // 移动/重命名（可覆盖文件）
    "cp",      // 复制（可覆盖文件）
    "python",  // Python 解释器（可执行任意代码）
    "python3", // Python3 解释器
    "node",    // Node.js 解释器
    "ruby",    // Ruby 解释器
    "perl",    // Perl 解释器
    "php",     // PHP 解释器
    "bash",    // 子 shell（可执行任意命令）
    "sh",      // 子 shell
    "zsh",     // 子 shell
    "eval",    // 评估执行
    "exec",    // 替换进程
    "env",     // 环境变量操作
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

/// 返回内置安全命令列表的副本，供 ReadOnly 模式等场景使用。
pub(crate) fn builtin_safe_commands() -> Vec<String> {
    BUILTIN_SAFE_COMMANDS
        .iter()
        .map(|s| s.to_string())
        .collect()
}

/// 只读模式下的拒绝原因
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ReadonlyDenyReason {
    /// 命令中包含 shell 控制运算符（; | > < ` $ &）
    ControlOperator,
    /// 被用户 deny 列表匹配
    DeniedByUser(String),
    /// 不在内置安全列表中
    NotInSafeList,
}

/// 面向只读模式的统一安全检查，返回 Ok(()) 或具体拒绝原因。
///
/// 与 is_safe_command 不同：
/// - 不检查 user_allowed 列表（readonly 模式忽略用户 allow）
/// - 返回具体原因而非 bool，供拒绝消息直接使用
/// - 检查顺序：空命令 → 控制运算符 → 用户 deny → BUILTIN_SAFE_COMMANDS
pub(crate) fn classify_readonly_command(
    command: &str,
    denied: &[String],
) -> Result<(), ReadonlyDenyReason> {
    let cmd = command.trim();
    if cmd.is_empty() {
        return Err(ReadonlyDenyReason::NotInSafeList);
    }
    if contains_shell_control(cmd) {
        return Err(ReadonlyDenyReason::ControlOperator);
    }
    for pattern in denied {
        if matches_pattern(cmd, pattern) {
            return Err(ReadonlyDenyReason::DeniedByUser(pattern.to_string()));
        }
    }
    for pattern in BUILTIN_SAFE_COMMANDS {
        if matches_pattern(cmd, pattern) {
            return Ok(());
        }
    }
    Err(ReadonlyDenyReason::NotInSafeList)
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
fn is_safe_command(command: &str, user_allowed: &[String], user_denied: &[String]) -> bool {
    let cmd = command.trim();
    if cmd.is_empty() {
        return false;
    }
    // 控制运算符检查（安全网）
    if contains_shell_control(cmd) {
        return false;
    }
    // 先检查 deny 列表（黑名单优先）
    for pattern in user_denied {
        if matches_pattern(cmd, pattern) {
            return false;
        }
    }
    // 再检查内置列表
    for pattern in BUILTIN_SAFE_COMMANDS {
        if matches_pattern(cmd, pattern) {
            return true;
        }
    }
    // 最后检查用户 allow 列表
    for pattern in user_allowed {
        if matches_pattern(cmd, pattern) {
            return true;
        }
    }
    false
}

// ── 分层审批决策辅助函数 ──

/// 判断子命令是否匹配用户拒绝列表
fn is_denied(cmd: &str, denied: &[String]) -> bool {
    for p in denied {
        if matches_pattern(cmd, p) {
            return true;
        }
    }
    false
}

/// 判断子命令是否匹配内置安全列表（只读命令）
fn is_builtin_safe(cmd: &str) -> bool {
    for p in BUILTIN_SAFE_COMMANDS {
        if matches_pattern(cmd, p) {
            return true;
        }
    }
    false
}

/// 判断子命令是否匹配用户白名单
fn is_user_allowed(cmd: &str, allowed: &[String]) -> bool {
    for p in allowed {
        if matches_pattern(cmd, p) {
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
    /// 用户自定义的拒绝命令前缀列表（优先于 allowed_commands）
    pub denied_commands: Vec<String>,
    /// 只读模式标记
    ///
    /// 启用后：
    /// - 仅允许 BUILTIN_SAFE_COMMANDS 中的命令（受 denied_commands 约束）
    /// - 不匹配的命令直接返回拒绝消息，不弹确认框
    /// - allowed_commands 在此模式下被忽略
    pub readonly_mode: bool,
    /// 确认后端（默认 Terminal）
    pub confirm_backend: crate::tools::confirm::ConfirmBackend,
}

impl Default for ShellExecOptions {
    fn default() -> Self {
        Self {
            timeout_secs: 30,
            output_max_chars: 100_000,
            skip_confirm: false,
            allowed_commands: Vec::new(),
            denied_commands: Vec::new(),
            readonly_mode: false,
            confirm_backend: crate::tools::confirm::ConfirmBackend::default(),
        }
    }
}

// ---------------------------------------------------------------------------
// Core struct
// ---------------------------------------------------------------------------

/// run_command 工具
#[derive(Debug)]
pub struct ShellExec {
    options: ShellExecOptions,
    /// 运行时动态白名单 = 启动时从 settings 加载的 + 用户交互式添加的
    /// 使用 Mutex 因为并发执行路径需要 Send
    allowed_commands_runtime: std::sync::Mutex<Vec<String>>,
}

impl Clone for ShellExec {
    fn clone(&self) -> Self {
        Self {
            allowed_commands_runtime: std::sync::Mutex::new(
                self.allowed_commands_runtime.lock().unwrap().clone(),
            ),
            options: self.options.clone(),
        }
    }
}

impl ShellExec {
    /// 创建新的 ShellExec 实例
    pub fn new(options: ShellExecOptions) -> Self {
        Self {
            allowed_commands_runtime: std::sync::Mutex::new(options.allowed_commands.clone()),
            options,
        }
    }

    /// 判断命令是否应跳过用户确认
    ///
    /// - `skip_confirm=true`（测试模式）→ 跳过
    /// - 命令匹配安全列表 → 跳过
    /// - 否则 → 需要确认
    pub fn should_skip_confirm(&self, command: &str) -> bool {
        self.options.skip_confirm
            || is_safe_command(
                command,
                &self.allowed_commands_runtime.lock().unwrap(),
                &self.options.denied_commands,
            )
    }

    /// 返回 Anthropic Tool 定义
    pub fn tool_definition() -> zapmyco_anthropic_ai_sdk::types::message::Tool {
        use zapmyco_anthropic_ai_sdk::types::message::Tool;
        Tool {
            name: "shell_exec".to_string(),
            description: Some(
                "在本地系统执行 shell 命令并返回标准输出、标准错误和退出码。\
                 工作目录会自动跨命令保持并显示在结果中。\
                 不要在 command 中写 cd 来切换目录，请使用 working_directory 参数。\
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
                        "description": "命令执行的工作目录（绝对路径）。切换目录请使用此参数，不要在 command 前加 cd。不指定则自动使用上次执行后的工作目录"
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
    ///
    /// 返回格式（与重构前不同，首行为工作目录）：
    /// ```text
    /// Working directory: /path
    ///
    /// Exit code: 0
    ///
    /// --- STDOUT ---
    /// ...
    /// ```
    pub async fn execute(
        &self,
        command: &str,
        description: Option<&str>,
        working_directory: Option<&str>,
    ) -> Result<String, ShellExecError> {
        // 1. 权限检查
        if self.options.readonly_mode {
            match classify_readonly_command(command, &self.options.denied_commands) {
                Ok(()) => {}
                Err(reason) => {
                    let msg = match reason {
                        ReadonlyDenyReason::ControlOperator => format!(
                            "[ReadOnly] 命令被拒绝: '{}'\n\
                             原因: 命令包含 shell 控制运算符（; | > < ` $ &），\
                             ReadOnly 模式禁止所有写入、管道、链式操作。\n\n\
                             如需读取文件请使用 file_read 或 file_search 工具。",
                            command
                        ),
                        ReadonlyDenyReason::DeniedByUser(pattern) => format!(
                            "[ReadOnly] 命令被拒绝: '{}'\n\
                             原因: 该命令已被用户在设置中配置为禁止（匹配规则: {}）。",
                            command, pattern
                        ),
                        ReadonlyDenyReason::NotInSafeList => format!(
                            "[ReadOnly] 命令被拒绝: '{}'\n\
                             原因: 当前为 ReadOnly 模式，仅允许执行认证的安全只读命令。\n\n\
                             允许的命令分类:\n\
                               通用: pwd, whoami, echo, printf, cd\n\
                               系统信息: uname, hostname, uptime, arch, which, id, logname, tty, cal\n\
                               路径信息: basename, dirname, realpath, ls, date\n\
                               Windows: ver, systeminfo, dir, date /t, time /t, vol\n\n\
                             替代方案:\
                             - 读取文件内容 → file_read\n\
                             - 搜索文件内容 → file_search\n\
                             - 查找文件名 → file_find\n\
                             - 搜索网络 → web_search\n\
                             - 获取网页 → web_fetch",
                            command
                        ),
                    };
                    output::send(&Message::warning(msg.clone()));
                    return Ok(msg);
                }
            }
        } else if !self.options.skip_confirm {
            let split = split_commands(command);

            // 阶段 1：在 Mutex 作用域内完成权限检查（锁不跨越 await）
            let (all_pending, should_use_parts): (Vec<CommandPart>, bool) = {
                let allowed = self.allowed_commands_runtime.lock().unwrap();

                let mut pending_indices: Vec<usize> = Vec::new();
                let mut deny_hit = false;

                for (idx, part) in split.parts.iter().enumerate() {
                    if is_denied(part.text, &self.options.denied_commands) {
                        let msg =
                            format!("[run_command] ❌ 命令被拒绝: `{}` 已在黑名单中", part.text);
                        output::send(&Message::warning(msg.clone()));
                        deny_hit = true;
                        // 需要继续持有 allowed 直到返回，所以先 break
                        // 但不能在持有锁时 return，所以标记后跳出
                        break;
                    }

                    let should_prompt = if part.flags.has_substitution {
                        true
                    } else if part.flags.has_redirect {
                        !is_user_allowed(part.text, &allowed)
                    } else {
                        !is_builtin_safe(part.text) && !is_user_allowed(part.text, &allowed)
                    };

                    if should_prompt {
                        pending_indices.push(idx);
                    }
                }

                if deny_hit {
                    return Ok("Command not executed: command is in deny list".to_string());
                }

                let all_pending = pending_indices
                    .iter()
                    .map(|&idx| CommandPart {
                        text: split.parts[idx].text,
                        range: split.parts[idx].range.clone(),
                        flags: split.parts[idx].flags,
                    })
                    .collect::<Vec<_>>();

                let should_use_parts =
                    !pending_indices.is_empty() && pending_indices.len() < split.parts.len();

                (all_pending, should_use_parts)
            }; // 锁在这里释放

            // 阶段 2：异步确认（无锁状态）
            if all_pending.is_empty() {
                // 全部已准入，直接执行
            } else {
                let decision = if should_use_parts {
                    prompt_confirm_parts(
                        command,
                        &all_pending.iter().collect::<Vec<_>>(),
                        description,
                        &self.options.confirm_backend,
                    )
                    .await
                } else {
                    prompt_confirm(command, description, &self.options.confirm_backend).await
                };

                match decision {
                    ConfirmAction::Deny => {
                        output::send(&Message::info("[run_command] ❌ 已取消".to_string()));
                        return Ok("Command not executed (cancelled by user)".to_string());
                    }
                    ConfirmAction::AlwaysAllow => {
                        let mut runtime = self.allowed_commands_runtime.lock().unwrap();
                        for part in &all_pending {
                            let first_word =
                                part.text.split_whitespace().next().unwrap_or(part.text);
                            add_to_allowlist_inner(first_word, &mut runtime);
                        }
                    }
                    ConfirmAction::Allow => {}
                }
            }
        }

        // 2. CWD 跟踪：创建临时目录（Guard 自动清理）
        let cwd_dir = zmd_temp_dir();
        let _guard = ZmdTempGuard::new(cwd_dir.clone());
        let cwd_file = cwd_dir.join("cwd");

        // 3. 构建并执行命令（平台相关）
        let timeout = std::time::Duration::from_secs(self.options.timeout_secs);

        let output = if cfg!(target_os = "windows") {
            // Windows：写入临时 bat 文件后执行
            let bat_file = cwd_dir.join("run.bat");
            let bat_content = format!(
                "@echo off\r\n\
                 {}\r\n\
                 set _ZMD_RC=%ERRORLEVEL%\r\n\
                 cd >\"{}\"\r\n\
                 exit /b %_ZMD_RC%\r\n",
                command,
                cwd_file.display()
            );
            std::fs::write(&bat_file, bat_content)
                .map_err(|e| ShellExecError::Io(format!("写入临时脚本失败: {}", e)))?;

            let mut cmd = tokio::process::Command::new("cmd.exe");
            cmd.arg("/d").arg("/c");
            cmd.arg(bat_file.as_os_str());
            if let Some(dir) = working_directory {
                cmd.current_dir(dir);
            }
            cmd.stdout(std::process::Stdio::piped());
            cmd.stderr(std::process::Stdio::piped());

            tokio::time::timeout(timeout, cmd.output())
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
                })?
        } else {
            // Unix：注入 pwd -P 到命令中
            let tracked_cmd = format!(
                "{}; _ZMD_RC=$?; pwd -P > {}; exit $_ZMD_RC",
                command,
                cwd_file.display()
            );

            let mut cmd = tokio::process::Command::new("sh");
            cmd.arg("-c");
            cmd.arg(&tracked_cmd);
            if let Some(dir) = working_directory {
                cmd.current_dir(dir);
            }
            cmd.stdout(std::process::Stdio::piped());
            cmd.stderr(std::process::Stdio::piped());

            tokio::time::timeout(timeout, cmd.output())
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
                })?
        };

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

        // 6. 读取实际工作目录
        let actual_cwd = read_cwd_file(&cwd_file, working_directory);

        // 7. 格式化输出（首行为工作目录）
        let exit_code = output.status.code();

        let mut result = format!("Working directory: {}\n\n", actual_cwd);
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

/// 用户确认结果
enum ConfirmAction {
    /// 允许执行（单次）
    Allow,
    /// 始终允许（加入白名单后执行）
    AlwaysAllow,
    /// 拒绝执行
    Deny,
}

/// 提示用户确认是否执行命令
///
/// 根据 `backend` 配置决定确认方式：
/// - `Terminal`：使用共享的 SelectPrompt 组件（现有行为）
/// - `AlwaysAllow`：直接允许
/// - `Channel`：通过 PendingApprovals 等待 HTTP 请求注入结果
async fn prompt_confirm(
    command: &str,
    description: Option<&str>,
    backend: &crate::tools::confirm::ConfirmBackend,
) -> ConfirmAction {
    match backend {
        crate::tools::confirm::ConfirmBackend::AlwaysAllow => ConfirmAction::Allow,
        crate::tools::confirm::ConfirmBackend::Channel(approvals) => {
            let id = uuid::Uuid::new_v4().to_string();
            let rx = approvals.register(id, "shell_exec", command, description);
            match rx.await {
                Ok(decision) => {
                    if decision.approved {
                        ConfirmAction::Allow
                    } else {
                        ConfirmAction::Deny
                    }
                }
                Err(_) => ConfirmAction::Deny,
            }
        }
        crate::tools::confirm::ConfirmBackend::Terminal => {
            use std::io::IsTerminal;

            if !std::io::stdin().is_terminal() {
                return ConfirmAction::Deny;
            }

            output::send(&Message::info(String::new()));
            output::send(&Message::info("[工具] ⚠️  准备执行命令:".to_string()));
            if let Some(desc) = description {
                let truncated = if desc.len() > 100 {
                    format!("{}...", &desc[..100])
                } else {
                    desc.to_string()
                };
                output::send(&Message::info(format!("  └ 描述: {}", truncated)));
            }
            output::send(&Message::info(format!("  └ 命令: {}", command)));

            let question = "是否确认执行？";
            let options = [
                crate::tools::prompt::SelectOption {
                    label: "允许",
                    description: "执行该命令",
                    custom_input: false,
                },
                crate::tools::prompt::SelectOption {
                    label: "始终允许",
                    description: "将该命令加入白名单并自动执行",
                    custom_input: false,
                },
                crate::tools::prompt::SelectOption {
                    label: "拒绝",
                    description: "取消执行该命令",
                    custom_input: false,
                },
            ];

            match crate::tools::prompt::prompt_single_select(question, &options) {
                Some(crate::tools::prompt::SingleSelectResult::Index(0)) => ConfirmAction::Allow,
                Some(crate::tools::prompt::SingleSelectResult::Index(1)) => {
                    ConfirmAction::AlwaysAllow
                }
                _ => ConfirmAction::Deny,
            }
        }
    }
}

/// add_to_allowlist_inner 将命令加入白名单（运行时内存列表 + settings 持久化）
///
/// 提取自 execute() 中的 AlwaysAllow 逻辑，避免重复代码。
fn add_to_allowlist_inner(first_word: &str, runtime_allowed: &mut Vec<String>) {
    if DANGEROUS_ALWAYS_ALLOW_COMMANDS.contains(&first_word) {
        output::send(&Message::warning(format!(
            "⚠️ `{}` 是危险命令，不允许加入白名单（命令仍会执行）",
            first_word
        )));
    } else if let Err(e) = crate::config::settings::add_to_command_allowlist(first_word) {
        output::send(&Message::warning(format!(
            "⚠️  无法保存到白名单: {}，但命令将继续执行",
            e
        )));
    } else {
        output::send(&Message::info(format!(
            "✅ 已加入白名单: `{}` 命令将自动执行",
            first_word
        )));
    }
    if !DANGEROUS_ALWAYS_ALLOW_COMMANDS.contains(&first_word) {
        runtime_allowed.push(first_word.to_string());
    }
}

/// 提示用户确认部分需要审批的子命令（拆分场景）
async fn prompt_confirm_parts(
    command: &str,
    pending: &[&CommandPart<'_>],
    description: Option<&str>,
    backend: &crate::tools::confirm::ConfirmBackend,
) -> ConfirmAction {
    match backend {
        crate::tools::confirm::ConfirmBackend::AlwaysAllow => ConfirmAction::Allow,
        crate::tools::confirm::ConfirmBackend::Channel(approvals) => {
            let id = uuid::Uuid::new_v4().to_string();
            let rx = approvals.register(id, "shell_exec", command, description);
            match rx.await {
                Ok(decision) => {
                    if decision.approved {
                        ConfirmAction::Allow
                    } else {
                        ConfirmAction::Deny
                    }
                }
                Err(_) => ConfirmAction::Deny,
            }
        }
        crate::tools::confirm::ConfirmBackend::Terminal => {
            use std::io::IsTerminal;
            if !std::io::stdin().is_terminal() {
                return ConfirmAction::Deny;
            }

            output::send(&Message::info(String::new()));
            output::send(&Message::info("[工具] ⚠️  准备执行命令:".to_string()));
            if let Some(desc) = description {
                let truncated = if desc.len() > 100 {
                    format!("{}...", &desc[..100])
                } else {
                    desc.to_string()
                };
                output::send(&Message::info(format!("  └ 描述: {}", truncated)));
            }
            output::send(&Message::info(format!("  └ 完整命令: {}", command)));
            output::send(&Message::info(String::new()));

            output::send(&Message::info("以下命令需要授权:".to_string()));
            for part in pending {
                let extra = if part.flags.has_substitution {
                    " (包含命令替换)"
                } else if part.flags.has_redirect {
                    " (包含文件重定向)"
                } else {
                    ""
                };
                output::send(&Message::info(format!("  ▢ {}{}", part.text, extra)));
            }

            let question = "是否确认执行？";
            let options = [
                crate::tools::prompt::SelectOption {
                    label: "允许",
                    description: "执行该命令",
                    custom_input: false,
                },
                crate::tools::prompt::SelectOption {
                    label: "始终允许",
                    description: "将未授权的命令加入白名单并自动执行",
                    custom_input: false,
                },
                crate::tools::prompt::SelectOption {
                    label: "拒绝",
                    description: "取消执行该命令",
                    custom_input: false,
                },
            ];

            match crate::tools::prompt::prompt_single_select(question, &options) {
                Some(crate::tools::prompt::SingleSelectResult::Index(0)) => ConfirmAction::Allow,
                Some(crate::tools::prompt::SingleSelectResult::Index(1)) => {
                    ConfirmAction::AlwaysAllow
                }
                _ => ConfirmAction::Deny,
            }
        }
    }
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
            denied_commands: vec![],
            allowed_commands: Vec::new(),
            readonly_mode: false,
            confirm_backend: Default::default(),
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
            denied_commands: vec![],
            allowed_commands: Vec::new(),
            readonly_mode: false,
            confirm_backend: Default::default(),
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
            denied_commands: vec![],
            allowed_commands: Vec::new(),
            readonly_mode: false,
            confirm_backend: Default::default(),
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
            denied_commands: vec![],
            allowed_commands: Vec::new(),
            readonly_mode: false,
            confirm_backend: Default::default(),
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

    // ---- Working directory tracking tests ----

    #[tokio::test]
    async fn test_execute_result_starts_with_working_dir() {
        let executor = test_executor();
        let result = executor.execute("echo hello", None, None).await.unwrap();
        assert!(
            result.starts_with("Working directory: "),
            "结果应以 Working directory: 开头，实际为: {}",
            result
        );
        assert!(result.contains("Exit code: 0"));
        assert!(result.contains("hello"));
    }

    #[cfg(not(target_os = "windows"))]
    #[tokio::test]
    async fn test_execute_working_dir_tracks_inline_cd() {
        let executor = test_executor();
        // 在 Unix 上，cd /tmp 后续 pwd -P 应捕获到 /tmp
        let result = executor
            .execute("cd /tmp && pwd", None, None)
            .await
            .unwrap();
        assert!(result.contains("Exit code: 0"), "结果:\n{}", result);
        // Working directory 应包含 /tmp（pwd -P 解析真实路径，忽略符号链接）
        assert!(
            result.contains("Working directory: /private/tmp")
                || result.contains("Working directory: /tmp"),
            "Working directory 应指向 /tmp，实际: {}",
            result
        );
    }

    #[cfg(target_os = "windows")]
    #[tokio::test]
    async fn test_execute_working_dir_tracks_inline_cd() {
        let executor = test_executor();
        // Windows 上用 C:\（所有 Windows 系统都有 C 盘）
        let result = executor
            .execute("cd /d C:\\ && pwd", None, None)
            .await
            .unwrap();
        assert!(result.contains("Exit code: 0"), "结果:\n{}", result);
        // Working directory 应指向 C:\（不区分大小写）
        assert!(
            result.starts_with("Working directory: C:\\")
                || result.starts_with("Working directory: c:\\"),
            "Working directory 应指向 C:\\，实际: {}",
            result
        );
    }

    #[tokio::test]
    async fn test_execute_working_dir_with_exit() {
        let executor = test_executor();
        // exit 终止 shell，pwd 不运行 → fallback 到 unknown
        let result = executor.execute("exit 42", None, None).await.unwrap();
        assert!(result.contains("Exit code: 42"), "结果:\n{}", result);
        assert!(
            result.starts_with("Working directory: "),
            "结果应以 Working directory: 开头: {}",
            result
        );
    }

    #[tokio::test]
    async fn test_execute_working_dir_false_then_pwd() {
        let executor = test_executor();
        // false 失败，但 ; 后的 pwd -P 应仍运行
        let result = executor.execute("false", None, None).await.unwrap();
        assert!(result.contains("Exit code: 1"), "结果:\n{}", result);
        assert!(
            result.starts_with("Working directory: "),
            "结果应以 Working directory: 开头: {}",
            result
        );
    }

    #[tokio::test]
    async fn test_execute_working_dir_respects_param() {
        let executor = test_executor();
        let tmp = std::env::temp_dir();
        let result = executor.execute("pwd", None, tmp.to_str()).await.unwrap();
        assert!(result.contains("Exit code: 0"));
        // 由于 pwd -P 可能解析符号链接（/var → /private/var），
        // 不精确匹配，只验证包含 Working directory:
        assert!(
            result.starts_with("Working directory: "),
            "结果应以 Working directory: 开头: {}",
            result
        );
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
        assert!(is_safe_command("echo hello=world", &[], &[]));
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
        assert!(is_safe_command("pwd", &[], &[]));
        assert!(is_safe_command("pwd -L", &[], &[]));
    }

    #[test]
    fn test_builtin_whoami_true_false() {
        assert!(is_safe_command("whoami", &[], &[]));
        assert!(is_safe_command("true", &[], &[]));
        assert!(is_safe_command("false", &[], &[]));
    }

    #[test]
    fn test_builtin_echo() {
        assert!(is_safe_command("echo hello", &[], &[]));
        assert!(is_safe_command("echo 'hello world'", &[], &[]));
        assert!(!is_safe_command("echo", &[], &[]));
        assert!(!is_safe_command("echowhat", &[], &[]));
    }

    #[test]
    fn test_builtin_printf() {
        assert!(is_safe_command("printf 'hello'", &[], &[]));
        assert!(!is_safe_command("printf", &[], &[]));
    }

    #[test]
    fn test_builtin_cd_uname() {
        assert!(is_safe_command("cd", &[], &[]));
        assert!(is_safe_command("cd /tmp", &[], &[]));
        assert!(!is_safe_command("cdrom", &[], &[]));
        assert!(is_safe_command("uname", &[], &[]));
        assert!(is_safe_command("uname -a", &[], &[]));
        assert!(is_safe_command("uname -r -s", &[], &[]));
        assert!(!is_safe_command("uname2", &[], &[]));
    }

    #[test]
    fn test_builtin_ls() {
        assert!(is_safe_command("ls", &[], &[]));
        assert!(is_safe_command("ls -la", &[], &[]));
        assert!(!is_safe_command("lsblk", &[], &[]));
    }

    #[test]
    fn test_builtin_date() {
        assert!(is_safe_command("date", &[], &[]));
        assert!(is_safe_command("date -u", &[], &[]));
    }

    #[test]
    fn test_date_s_is_technically_allowed() {
        // design.md 已知风险: "date -s" 需要 root 权限，agent 极少生成此命令
        // 如对此有顾虑，可在 settings.toml 中将 "date" 加入 deny 列表
        assert!(is_safe_command("date -s '2024-01-01'", &[], &[]));
    }

    #[test]
    fn test_safe_command_rejected_with_control_ops() {
        assert!(!is_safe_command("echo hello > /tmp/x", &[], &[]));
        assert!(!is_safe_command("ls > files.txt", &[], &[]));
        assert!(!is_safe_command("pwd > /tmp/pwd.txt", &[], &[]));
        assert!(!is_safe_command("echo hello | wc", &[], &[]));
        assert!(!is_safe_command("ls | grep foo", &[], &[]));
        assert!(!is_safe_command("echo hello; rm -rf /", &[], &[]));
        assert!(!is_safe_command("echo a && echo b", &[], &[]));
        assert!(!is_safe_command("echo a || echo b", &[], &[]));
        assert!(!is_safe_command("pwd; whoami", &[], &[]));
        assert!(!is_safe_command("echo hello || true", &[], &[]));
        assert!(!is_safe_command("echo `whoami`", &[], &[]));
        assert!(!is_safe_command("echo $(hostname)", &[], &[]));
        assert!(!is_safe_command("echo $SHELL", &[], &[]));
    }

    #[test]
    fn test_user_allowed() {
        let user = vec!["git status".to_string(), "cargo check".to_string()];
        assert!(is_safe_command("git status", &user, &[]));
        assert!(is_safe_command("git status -s", &user, &[]));
        assert!(!is_safe_command("git commit", &user, &[]));
        assert!(!is_safe_command("cargo build", &user, &[]));
    }

    #[test]
    fn test_edge_empty_whitespace() {
        assert!(!is_safe_command("", &[], &[]));
        assert!(!is_safe_command("   ", &[], &[]));
        assert!(!is_safe_command("\t", &[], &[]));
        assert!(!is_safe_command("\n", &[], &[]));
    }

    #[test]
    fn test_edge_leading_trailing_whitespace() {
        assert!(is_safe_command("  pwd", &[], &[]));
        assert!(is_safe_command("  whoami", &[], &[]));
        assert!(is_safe_command("pwd  ", &[], &[]));
        assert!(is_safe_command("ls   ", &[], &[]));
        assert!(is_safe_command("  echo hello  ", &[], &[]));
    }

    #[test]
    fn test_edge_not_in_builtin() {
        assert!(!is_safe_command("who", &[], &[]));
        assert!(!is_safe_command("who -a", &[], &[]));
        assert!(!is_safe_command("whoami_extra", &[], &[]));
        assert!(!is_safe_command("rm -rf /", &[], &[]));
        assert!(!is_safe_command("pwdconfig", &[], &[]));
        assert!(!is_safe_command("idone", &[], &[]));
        assert!(!is_safe_command("uname2", &[], &[]));
        assert!(!is_safe_command("caliber", &[], &[]));
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn test_builtin_windows_commands() {
        assert!(is_safe_command("ver", &[], &[]));
        assert!(is_safe_command("systeminfo", &[], &[]));
        assert!(is_safe_command("dir", &[], &[]));
        assert!(is_safe_command("dir /w", &[], &[]));
        assert!(is_safe_command("date /t", &[], &[]));
        assert!(is_safe_command("time /t", &[], &[]));
        assert!(is_safe_command("vol", &[], &[]));
        assert!(!is_safe_command("directory", &[], &[]));
    }

    #[test]
    fn test_builtin_hostname_uptime_arch() {
        assert!(is_safe_command("hostname", &[], &[]));
        assert!(is_safe_command("hostname -s", &[], &[]));
        assert!(is_safe_command("uptime", &[], &[]));
        assert!(is_safe_command("arch", &[], &[]));
    }

    #[test]
    fn test_builtin_which() {
        assert!(is_safe_command("which python3", &[], &[]));
        assert!(!is_safe_command("which", &[], &[]));
    }

    #[test]
    fn test_builtin_id_logname_tty() {
        assert!(is_safe_command("id", &[], &[]));
        assert!(is_safe_command("id -u", &[], &[]));
        assert!(!is_safe_command("idone", &[], &[]));
        assert!(is_safe_command("logname", &[], &[]));
        assert!(is_safe_command("tty", &[], &[]));
    }

    #[test]
    fn test_builtin_cal_seq() {
        assert!(is_safe_command("cal", &[], &[]));
        assert!(is_safe_command("cal 2024", &[], &[]));
        assert!(is_safe_command("seq 1 10", &[], &[]));
        assert!(!is_safe_command("seq", &[], &[]));
    }

    #[test]
    fn test_builtin_getconf_pathchk() {
        assert!(is_safe_command("getconf PAGE_SIZE", &[], &[]));
        assert!(!is_safe_command("getconf", &[], &[]));
        assert!(is_safe_command("pathchk /tmp", &[], &[]));
        assert!(!is_safe_command("pathchk", &[], &[]));
    }

    #[test]
    fn test_builtin_path_ops() {
        assert!(is_safe_command("basename /path/to/file", &[], &[]));
        assert!(!is_safe_command("basename", &[], &[]));
        assert!(is_safe_command("dirname /path/to/file", &[], &[]));
        assert!(!is_safe_command("dirname", &[], &[]));
        assert!(is_safe_command("realpath /tmp", &[], &[]));
        assert!(!is_safe_command("realpath", &[], &[]));
    }

    #[test]
    fn test_builtin_list_not_empty() {
        assert!(!BUILTIN_SAFE_COMMANDS.is_empty());
    }

    // ── 用户自定义列表扩展测试 ──

    #[test]
    fn test_user_allowed_prefix() {
        let user = vec!["git status".to_string()];
        assert!(is_safe_command("git status -s", &user, &[]));
        assert!(is_safe_command("git status --short", &user, &[]));
    }

    #[test]
    fn test_user_allowed_multi() {
        let user = vec![
            "git status".to_string(),
            "cargo check".to_string(),
            "cargo clippy".to_string(),
        ];
        assert!(is_safe_command("git status", &user, &[]));
        assert!(is_safe_command("cargo check", &user, &[]));
        assert!(is_safe_command("cargo check --offline", &user, &[]));
        assert!(is_safe_command("cargo clippy", &user, &[]));
    }

    #[test]
    fn test_user_allowed_still_blocked_by_control_ops() {
        let user = vec!["git status".to_string()];
        assert!(!is_safe_command("git status | grep foo", &user, &[]));
        assert!(!is_safe_command("git status > file", &user, &[]));
    }

    #[test]
    fn test_user_allowed_with_trailing_space() {
        let user = vec!["cargo ".to_string()];
        assert!(is_safe_command("cargo check", &user, &[]));
        assert!(is_safe_command("cargo clippy", &user, &[]));
        assert!(!is_safe_command("cargo", &user, &[]));
    }

    // ── 用户自定义拒绝列表测试 ──

    #[test]
    fn test_user_deny_blocks_command() {
        let deny = vec!["rm -rf".to_string()];
        // deny 列表中的命令应被拦截
        assert!(!is_safe_command("rm -rf /", &[], &deny));
        assert!(!is_safe_command("rm -rf /tmp", &[], &deny));
    }

    #[test]
    fn test_user_deny_overrides_allow() {
        let allow = vec!["git status".to_string()];
        let deny = vec!["git status".to_string()];
        // 同时命中 allow 和 deny 时，deny 优先生效
        assert!(!is_safe_command("git status", &allow, &deny));
        assert!(!is_safe_command("git status -s", &allow, &deny));
    }

    #[test]
    fn test_user_deny_prefix_matching() {
        let deny = vec!["sudo ".to_string()];
        // deny 使用与 allow 相同的前缀匹配规则
        assert!(!is_safe_command("sudo rm -rf /", &[], &deny));
        assert!(!is_safe_command("sudo apt install", &[], &deny));
        // "sudo" 本身（不带参数）不应匹配尾部带空格的 "sudo "
        // 但 sudo 不在内置安全列表中，所以 is_safe_command 仍然返回 false
        assert!(!is_safe_command("sudo", &[], &deny));
    }

    #[test]
    fn test_user_deny_does_not_affect_builtin() {
        let deny = vec!["sudo".to_string()];
        // deny 不应影响内置安全命令
        assert!(is_safe_command("pwd", &[], &deny));
        assert!(is_safe_command("ls", &[], &deny));
        assert!(is_safe_command("echo hello", &[], &deny));
    }

    #[test]
    fn test_user_deny_still_blocked_by_control_ops() {
        let deny = vec!["echo".to_string()];
        // 控制运算符检查在 deny 之前，所以普通命令仍然被控制运算符拦截
        // 但这里 echo 被 deny 了，所以无论如何都是 false
        assert!(!is_safe_command("echo hello > file", &[], &deny));
    }

    #[test]
    fn test_user_deny_empty_list_allows_all() {
        // 空 deny 列表不应影响正常判断
        assert!(is_safe_command("pwd", &[], &[]));
        assert!(!is_safe_command("rm -rf", &["git".to_string()], &[]));
    }

    #[test]
    fn test_user_deny_word_boundary() {
        let deny = vec!["ls".to_string()];
        // deny 也使用词边界匹配，"ls" 匹配 "ls" 和 "ls -la"
        assert!(!is_safe_command("ls", &[], &deny));
        assert!(!is_safe_command("ls -la", &[], &deny));
        // deny 不应影响不相关的内置安全命令
        assert!(is_safe_command("pwd", &[], &deny));
        assert!(is_safe_command("date", &[], &deny));
    }

    // ── 边界场景扩展测试 ──

    #[test]
    fn test_word_boundary_with_special_chars() {
        assert!(!is_safe_command("pwd-config", &[], &[]));
        assert!(!is_safe_command("pwd_config", &[], &[]));
        assert!(!is_safe_command("pwd.config", &[], &[]));
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
        assert!(is_safe_command("cmd_5000 arg", &large_list, &[]));
        assert!(!is_safe_command("unknown_cmd", &large_list, &[]));
        assert!(!is_safe_command("cmd_0 | dangerous", &large_list, &[]));
        let elapsed = start.elapsed();
        assert!(
            elapsed.as_millis() < 10,
            "Large list scan too slow: {}ms",
            elapsed.as_millis()
        );
    }

    #[test]
    fn test_edge_unicode_long() {
        assert!(is_safe_command("echo 你好世界", &[], &[]));
        assert!(is_safe_command("echo café", &[], &[]));
        let long_path = "/".to_string() + &"a".repeat(1000);
        assert!(is_safe_command(&format!("ls {}", long_path), &[], &[]));
    }

    #[test]
    fn test_empty_user_list() {
        let empty: &[String] = &[];
        assert!(is_safe_command("pwd", empty, &[]));
        assert!(!is_safe_command("git status", empty, &[]));
    }

    #[test]
    fn test_empty_user_list_performance() {
        let start = std::time::Instant::now();
        assert!(is_safe_command("pwd", &[] as &[String], &[]));
        assert!(!is_safe_command("git status", &[] as &[String], &[]));
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
        assert!(is_safe_command(
            "pwd",
            &executor.options.allowed_commands,
            &executor.options.denied_commands
        ));
        assert!(!is_safe_command(
            "rm -rf /",
            &executor.options.allowed_commands,
            &executor.options.denied_commands,
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
            assert!(is_safe_command("uname", &[], &[]));
            assert!(is_safe_command("uptime", &[], &[]));
            assert!(is_safe_command("arch", &[], &[]));
            assert!(is_safe_command("cal", &[], &[]));
            assert!(is_safe_command("tty", &[], &[]));
            assert!(is_safe_command("logname", &[], &[]));
        }

        #[test]
        fn test_unix_path_commands() {
            assert!(is_safe_command("basename /path/to/file", &[], &[]));
            assert!(is_safe_command("dirname /path/to/file", &[], &[]));
            assert!(is_safe_command("realpath /tmp", &[], &[]));
            assert!(is_safe_command("which bash", &[], &[]));
        }

        #[test]
        fn test_unix_getconf_pathchk() {
            assert!(is_safe_command("getconf PAGE_SIZE", &[], &[]));
            assert!(is_safe_command("pathchk /tmp", &[], &[]));
        }
    }

    // ── CLI 集成测试 ──

    #[test]
    fn test_cli_settings_to_shell_exec_options() {
        use crate::config::settings::{CommandPermissions, Permissions, Settings};
        let settings = Settings {
            llm: None,
            session_log: None,
            permissions: Some(Permissions {
                commands: CommandPermissions {
                    allow: vec!["git status".to_string(), "cargo check".to_string()],
                    deny: vec![],
                },
            }),
        };
        let allowed_commands = settings
            .permissions
            .as_ref()
            .map(|p| p.commands.allow.clone())
            .unwrap_or_default();
        assert_eq!(allowed_commands.len(), 2);
        assert_eq!(allowed_commands[0], "git status");
        let executor = ShellExec::new(ShellExecOptions {
            allowed_commands,
            denied_commands: vec![],
            ..Default::default()
        });
        assert_eq!(executor.options.allowed_commands.len(), 2);
    }

    #[test]
    fn test_cli_settings_missing_permissions() {
        use crate::config::settings::Settings;
        let settings = Settings {
            llm: None,
            session_log: None,
            permissions: None,
        };
        let allowed_commands = settings
            .permissions
            .as_ref()
            .map(|p| p.commands.allow.clone())
            .unwrap_or_default();
        assert!(
            allowed_commands.is_empty(),
            "无 permissions 配置时应返回空列表"
        );
        let executor = ShellExec::new(ShellExecOptions {
            allowed_commands,
            denied_commands: vec![],
            ..Default::default()
        });
        assert!(is_safe_command(
            "pwd",
            &executor.options.allowed_commands,
            &executor.options.denied_commands
        ));
    }

    #[test]
    fn test_cli_settings_empty_allow() {
        use crate::config::settings::{CommandPermissions, Permissions, Settings};
        let settings = Settings {
            llm: None,
            session_log: None,
            permissions: Some(Permissions {
                commands: CommandPermissions {
                    allow: vec![],
                    deny: vec![],
                },
            }),
        };
        let allowed_commands = settings
            .permissions
            .as_ref()
            .map(|p| p.commands.allow.clone())
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
[permissions.commands]
allow = ["git status", "cargo check"]
"#,
            )
            .unwrap();
            let loaded = load_settings().unwrap().unwrap();
            let allowed_commands = loaded
                .permissions
                .as_ref()
                .map(|p| p.commands.allow.clone())
                .unwrap_or_default();
            assert_eq!(allowed_commands, vec!["git status", "cargo check"]);
            let executor = ShellExec::new(ShellExecOptions {
                allowed_commands,
                denied_commands: vec![],
                ..Default::default()
            });
            assert!(is_safe_command(
                "git status",
                &executor.options.allowed_commands,
                &executor.options.denied_commands,
            ));
            assert!(!is_safe_command(
                "git commit",
                &executor.options.allowed_commands,
                &executor.options.denied_commands,
            ));
        });
    }
}

#[cfg(test)]
mod always_allow_tests {
    use super::*;

    // ── allowed_commands_runtime 初始化 ──

    #[test]
    fn test_allowed_commands_runtime_initialized_from_options() {
        let executor = ShellExec::new(ShellExecOptions {
            allowed_commands: vec!["git status".to_string(), "cargo check".to_string()],
            ..Default::default()
        });
        let allowed = executor.allowed_commands_runtime.lock().unwrap();
        assert_eq!(allowed.len(), 2);
        assert!(allowed.contains(&"git status".to_string()));
        assert!(allowed.contains(&"cargo check".to_string()));
    }

    #[test]
    fn test_allowed_commands_runtime_empty_by_default() {
        let executor = ShellExec::new(Default::default());
        let allowed = executor.allowed_commands_runtime.lock().unwrap();
        assert!(allowed.is_empty());
    }

    #[test]
    fn test_allowed_commands_runtime_combined_with_options() {
        let executor = ShellExec::new(ShellExecOptions {
            allowed_commands: vec!["git status".to_string()],
            ..Default::default()
        });
        // 初始时仅含 options 中的条目
        {
            let allowed = executor.allowed_commands_runtime.lock().unwrap();
            assert_eq!(allowed.len(), 1);
            assert!(allowed.contains(&"git status".to_string()));
        }
        // 运行时添加新条目
        executor
            .allowed_commands_runtime
            .lock()
            .unwrap()
            .push("cargo check".to_string());

        // 两者都应在运行时列表中
        {
            let allowed = executor.allowed_commands_runtime.lock().unwrap();
            assert_eq!(allowed.len(), 2);
            assert!(allowed.contains(&"git status".to_string()));
            assert!(allowed.contains(&"cargo check".to_string()));
        }
        // options.allowed_commands 应保持不变（有效隔离）
        assert_eq!(executor.options.allowed_commands.len(), 1);
        assert_eq!(executor.options.allowed_commands[0], "git status");
    }

    #[test]
    fn test_allowed_commands_runtime_cleared_options_unaffected() {
        let executor = ShellExec::new(ShellExecOptions {
            allowed_commands: vec!["git status".to_string()],
            ..Default::default()
        });
        executor.allowed_commands_runtime.lock().unwrap().clear();

        let allowed = executor.allowed_commands_runtime.lock().unwrap();
        assert!(allowed.is_empty());
        assert_eq!(executor.options.allowed_commands.len(), 1);
    }

    // ── should_skip_confirm 使用运行时列表 ──

    #[test]
    fn test_should_skip_confirm_runtime_allowed() {
        let executor = ShellExec::new(ShellExecOptions {
            skip_confirm: false,
            allowed_commands: Vec::new(),
            ..Default::default()
        });
        assert!(!executor.should_skip_confirm("git status"));

        executor
            .allowed_commands_runtime
            .lock()
            .unwrap()
            .push("git status".to_string());

        assert!(executor.should_skip_confirm("git status"));
        assert!(executor.should_skip_confirm("git status -s"));
    }

    #[test]
    fn test_should_skip_confirm_runtime_does_not_affect_builtin() {
        let executor = ShellExec::new(ShellExecOptions {
            skip_confirm: false,
            ..Default::default()
        });
        assert!(executor.should_skip_confirm("pwd"));
        assert!(executor.should_skip_confirm("echo hello"));

        executor.allowed_commands_runtime.lock().unwrap().clear();

        assert!(executor.should_skip_confirm("pwd"));
    }

    #[test]
    fn test_should_skip_confirm_runtime_trimmed_matching() {
        let executor = ShellExec::new(ShellExecOptions {
            skip_confirm: false,
            allowed_commands: Vec::new(),
            ..Default::default()
        });
        executor
            .allowed_commands_runtime
            .lock()
            .unwrap()
            .push("git status".to_string());

        assert!(executor.should_skip_confirm("  git status  "));
    }

    #[test]
    fn test_should_skip_confirm_runtime_case_sensitive() {
        let executor = ShellExec::new(ShellExecOptions {
            skip_confirm: false,
            allowed_commands: Vec::new(),
            ..Default::default()
        });

        // 仅添加大写 GIT STATUS
        executor
            .allowed_commands_runtime
            .lock()
            .unwrap()
            .push("GIT STATUS".to_string());

        // 大写匹配
        assert!(executor.should_skip_confirm("GIT STATUS"));
        assert!(executor.should_skip_confirm("GIT STATUS -s"));
        // 小写不应匹配（大小写敏感）
        assert!(!executor.should_skip_confirm("git status"));
        // 混合大小写不应匹配
        assert!(!executor.should_skip_confirm("GIT status"));

        // 反向验证：添加小写后，小写匹配，大写仍不匹配小写条目
        executor
            .allowed_commands_runtime
            .lock()
            .unwrap()
            .push("git status".to_string());
        assert!(executor.should_skip_confirm("git status"));
        assert!(executor.should_skip_confirm("GIT STATUS"));
    }

    // ── 非 TTY 下 prompt_confirm 行为 ──

    #[tokio::test]
    async fn test_prompt_confirm_non_tty_returns_deny() {
        let backend = crate::tools::confirm::ConfirmBackend::Terminal;
        let result = prompt_confirm("echo hello", None, &backend).await;
        assert!(matches!(result, ConfirmAction::Deny));
    }

    #[tokio::test]
    async fn test_prompt_confirm_non_tty_with_description() {
        let backend = crate::tools::confirm::ConfirmBackend::Terminal;
        let result = prompt_confirm("echo hello", Some("测试命令"), &backend).await;
        assert!(matches!(result, ConfirmAction::Deny));
    }

    // ── ConfirmAction 枚举 ──

    #[test]
    fn test_confirm_action_variants() {
        match ConfirmAction::Allow {
            ConfirmAction::Allow => {}
            _ => panic!("expected Allow"),
        }
        match ConfirmAction::AlwaysAllow {
            ConfirmAction::AlwaysAllow => {}
            _ => panic!("expected AlwaysAllow"),
        }
        match ConfirmAction::Deny {
            ConfirmAction::Deny => {}
            _ => panic!("expected Deny"),
        }
    }

    // ── DANGEROUS_ALWAYS_ALLOW_COMMANDS 验证 ──

    #[test]
    fn test_dangerous_commands_list_not_empty() {
        assert!(!DANGEROUS_ALWAYS_ALLOW_COMMANDS.is_empty());
    }

    #[test]
    fn test_dangerous_commands_includes_rm_sudo() {
        assert!(DANGEROUS_ALWAYS_ALLOW_COMMANDS.contains(&"rm"));
        assert!(DANGEROUS_ALWAYS_ALLOW_COMMANDS.contains(&"sudo"));
        assert!(DANGEROUS_ALWAYS_ALLOW_COMMANDS.contains(&"python"));
    }

    #[test]
    fn test_safe_commands_not_in_dangerous_list() {
        // 常用安全命令不应出现在危险列表中
        assert!(!DANGEROUS_ALWAYS_ALLOW_COMMANDS.contains(&"git"));
        assert!(!DANGEROUS_ALWAYS_ALLOW_COMMANDS.contains(&"cargo"));
        assert!(!DANGEROUS_ALWAYS_ALLOW_COMMANDS.contains(&"touch"));
        assert!(!DANGEROUS_ALWAYS_ALLOW_COMMANDS.contains(&"echo"));
        assert!(!DANGEROUS_ALWAYS_ALLOW_COMMANDS.contains(&"ls"));
    }

    // ── execute 运行时白名单集成 ──

    #[tokio::test]
    async fn test_execute_respects_runtime_allowlist() {
        let executor = ShellExec::new(ShellExecOptions {
            skip_confirm: false,
            allowed_commands: Vec::new(),
            denied_commands: vec![],
            timeout_secs: 5,
            output_max_chars: 10_000,
            readonly_mode: false,
            confirm_backend: Default::default(),
        });

        executor
            .allowed_commands_runtime
            .lock()
            .unwrap()
            .push("echo ".to_string());

        let result = executor
            .execute("echo runtime_allow", None, None)
            .await
            .unwrap();
        assert!(result.contains("Exit code: 0"));
        assert!(result.contains("runtime_allow"));
    }

    #[tokio::test]
    async fn test_execute_runtime_prefix_matching() {
        let executor = ShellExec::new(ShellExecOptions {
            skip_confirm: false,
            allowed_commands: Vec::new(),
            denied_commands: vec![],
            timeout_secs: 5,
            output_max_chars: 10_000,
            readonly_mode: false,
            confirm_backend: Default::default(),
        });

        executor
            .allowed_commands_runtime
            .lock()
            .unwrap()
            .push("echo ".to_string());

        let result = executor
            .execute("echo hello world", None, None)
            .await
            .unwrap();
        assert!(result.contains("Exit code: 0"));
        assert!(result.contains("hello world"));
    }

    // ── 回归：skip_confirm=true 不受影响 ──

    #[tokio::test]
    async fn test_execute_skip_confirm_still_works() {
        let executor = ShellExec::new(ShellExecOptions {
            skip_confirm: true,
            ..Default::default()
        });
        let result = executor
            .execute("echo skip_confirm_test", None, None)
            .await
            .unwrap();
        assert!(result.contains("Exit code: 0"));
        assert!(result.contains("skip_confirm_test"));
    }

    #[tokio::test]
    async fn test_execute_skip_confirm_allows_unsafe() {
        // skip_confirm=true 时即使"危险"命令也执行（测试模式）
        let executor = ShellExec::new(ShellExecOptions {
            skip_confirm: true,
            ..Default::default()
        });
        let result = executor
            .execute("echo dangerous_but_skipped", None, None)
            .await
            .unwrap();
        assert!(result.contains("Exit code: 0"));
        assert!(result.contains("dangerous_but_skipped"));
    }

    // ── 回归：deny 列表仍优先 ──

    #[tokio::test]
    async fn test_deny_list_still_overrides_allow() {
        let executor = ShellExec::new(ShellExecOptions {
            skip_confirm: false,
            allowed_commands: vec!["git status".to_string()],
            denied_commands: vec!["git status".to_string()],
            timeout_secs: 5,
            output_max_chars: 10_000,
            readonly_mode: false,
            confirm_backend: Default::default(),
        });

        // deny 优先 → is_safe_command 返回 false → 非 TTY 下 prompt_confirm 返回 Deny
        let r = executor.execute("git status", None, None).await.unwrap();
        assert!(r.contains("not executed") || r.contains("已取消"));
    }

    // ── 回归：运行时白名单不影响控制运算符安全网 ──

    #[tokio::test]
    async fn test_runtime_allowlist_does_not_bypass_control_ops() {
        let executor = ShellExec::new(ShellExecOptions {
            skip_confirm: false,
            allowed_commands: Vec::new(),
            denied_commands: vec![],
            timeout_secs: 5,
            output_max_chars: 10_000,
            readonly_mode: false,
            confirm_backend: Default::default(),
        });

        executor
            .allowed_commands_runtime
            .lock()
            .unwrap()
            .push("echo hello | cat".to_string());

        assert!(!executor.should_skip_confirm("echo hello | cat"));

        let r = executor
            .execute("echo hello | cat", None, None)
            .await
            .unwrap();
        assert!(r.contains("not executed") || r.contains("已取消"));
    }

    // ── 回归：readonly 模式不受影响 ──

    #[tokio::test]
    async fn test_readonly_still_rejects_unsafe() {
        let executor = ShellExec::new(ShellExecOptions {
            readonly_mode: true,
            allowed_commands: builtin_safe_commands(),
            denied_commands: vec![],
            skip_confirm: true,
            timeout_secs: 5,
            output_max_chars: 10_000,
            ..Default::default()
        });
        let r = executor.execute("git status", None, None).await.unwrap();
        assert!(r.contains("[ReadOnly] 命令被拒绝"));
    }

    #[tokio::test]
    async fn test_readonly_safe_still_works() {
        let executor = ShellExec::new(ShellExecOptions {
            readonly_mode: true,
            allowed_commands: builtin_safe_commands(),
            denied_commands: vec![],
            skip_confirm: true,
            timeout_secs: 5,
            output_max_chars: 10_000,
            ..Default::default()
        });
        let r = executor.execute("pwd", None, None).await.unwrap();
        assert!(r.contains("Exit code: 0"));
    }
}

#[cfg(test)]
mod classify_readonly_tests {
    use super::*;

    #[test]
    fn test_classify_pwd() {
        assert!(classify_readonly_command("pwd", &[]).is_ok());
    }

    #[test]
    fn test_classify_ls_with_args() {
        assert!(classify_readonly_command("ls -la /tmp", &[]).is_ok());
    }

    #[test]
    fn test_classify_echo_with_text() {
        assert!(classify_readonly_command("echo hello", &[]).is_ok());
    }

    #[test]
    fn test_classify_cd_with_path() {
        assert!(classify_readonly_command("cd /tmp", &[]).is_ok());
    }

    #[test]
    fn test_classify_all_builtin_commands() {
        for pattern in BUILTIN_SAFE_COMMANDS {
            if pattern.ends_with(' ') {
                let test_cmd = format!("{}arg", pattern);
                assert!(
                    classify_readonly_command(&test_cmd, &[]).is_ok(),
                    "BUILTIN '{}' 应匹配 '{}'",
                    pattern,
                    test_cmd
                );
            } else {
                assert!(
                    classify_readonly_command(pattern, &[]).is_ok(),
                    "BUILTIN '{}' 应为安全",
                    pattern
                );
            }
        }
    }

    #[test]
    fn test_classify_rejects_redirect() {
        let r = classify_readonly_command("echo hello > file", &[]);
        assert!(matches!(r, Err(ReadonlyDenyReason::ControlOperator)));
    }

    #[test]
    fn test_classify_rejects_pipe() {
        let r = classify_readonly_command("ls | grep foo", &[]);
        assert!(matches!(r, Err(ReadonlyDenyReason::ControlOperator)));
    }

    #[test]
    fn test_classify_rejects_chain_and_or() {
        assert!(matches!(
            classify_readonly_command("echo a && echo b", &[]),
            Err(ReadonlyDenyReason::ControlOperator)
        ));
        assert!(matches!(
            classify_readonly_command("echo a || echo b", &[]),
            Err(ReadonlyDenyReason::ControlOperator)
        ));
        assert!(matches!(
            classify_readonly_command("echo a; rm -rf /", &[]),
            Err(ReadonlyDenyReason::ControlOperator)
        ));
    }

    #[test]
    fn test_classify_rejects_subshell_backtick() {
        assert!(matches!(
            classify_readonly_command("echo $(whoami)", &[]),
            Err(ReadonlyDenyReason::ControlOperator)
        ));
        assert!(matches!(
            classify_readonly_command("echo `whoami`", &[]),
            Err(ReadonlyDenyReason::ControlOperator)
        ));
    }

    #[test]
    fn test_classify_rejects_bare_var_expansion() {
        assert!(matches!(
            classify_readonly_command("echo $HOME", &[]),
            Err(ReadonlyDenyReason::ControlOperator)
        ));
        assert!(matches!(
            classify_readonly_command("echo $PATH", &[]),
            Err(ReadonlyDenyReason::ControlOperator)
        ));
    }

    #[test]
    fn test_classify_rejects_background_ampersand() {
        assert!(matches!(
            classify_readonly_command("sleep 5 &", &[]),
            Err(ReadonlyDenyReason::ControlOperator)
        ));
        assert!(matches!(
            classify_readonly_command("echo hello & echo world", &[]),
            Err(ReadonlyDenyReason::ControlOperator)
        ));
    }

    #[test]
    fn test_classify_rejects_input_redirect() {
        assert!(matches!(
            classify_readonly_command("cat < /etc/passwd", &[]),
            Err(ReadonlyDenyReason::ControlOperator)
        ));
        assert!(matches!(
            classify_readonly_command("sort < input.txt", &[]),
            Err(ReadonlyDenyReason::ControlOperator)
        ));
    }

    #[test]
    fn test_classify_denied_command() {
        let denied = vec!["git".to_string()];
        let r = classify_readonly_command("git status", &denied);
        assert!(matches!(r, Err(ReadonlyDenyReason::DeniedByUser(_))));
        if let Err(ReadonlyDenyReason::DeniedByUser(p)) = r {
            assert_eq!(p, "git");
        }
    }

    #[test]
    fn test_classify_deny_overrides_builtin() {
        let denied = vec!["ls".to_string()];
        let r = classify_readonly_command("ls -la", &denied);
        assert!(matches!(r, Err(ReadonlyDenyReason::DeniedByUser(_))));
    }

    #[test]
    fn test_classify_deny_trailing_space() {
        let denied = vec!["git ".to_string()];
        // "git"（裸）不应被 "git " 匹配，但 "git" 也不在安全列表中
        let r = classify_readonly_command("git", &denied);
        assert!(
            matches!(r, Err(ReadonlyDenyReason::NotInSafeList)),
            "bare 'git' 不应被 'git ' deny 规则匹配"
        );
        // "git status" 应被 "git " deny 规则匹配
        let r = classify_readonly_command("git status", &denied);
        assert!(matches!(r, Err(ReadonlyDenyReason::DeniedByUser(_))));
    }

    #[test]
    fn test_classify_unknown_and_dangerous() {
        assert!(matches!(
            classify_readonly_command("git status", &[]),
            Err(ReadonlyDenyReason::NotInSafeList)
        ));
        assert!(matches!(
            classify_readonly_command("rm -rf /", &[]),
            Err(ReadonlyDenyReason::NotInSafeList)
        ));
    }

    #[test]
    fn test_classify_empty_and_whitespace() {
        assert!(matches!(
            classify_readonly_command("", &[]),
            Err(ReadonlyDenyReason::NotInSafeList)
        ));
        assert!(matches!(
            classify_readonly_command("   ", &[]),
            Err(ReadonlyDenyReason::NotInSafeList)
        ));
    }

    #[test]
    fn test_classify_bare_echo_rejected() {
        let r = classify_readonly_command("echo", &[]);
        assert!(matches!(r, Err(ReadonlyDenyReason::NotInSafeList)));
    }

    #[test]
    fn test_classify_no_cross_word() {
        assert!(matches!(
            classify_readonly_command("lsblk", &[]),
            Err(ReadonlyDenyReason::NotInSafeList)
        ));
        assert!(matches!(
            classify_readonly_command("hostnamectl", &[]),
            Err(ReadonlyDenyReason::NotInSafeList)
        ));
        assert!(matches!(
            classify_readonly_command("idone", &[]),
            Err(ReadonlyDenyReason::NotInSafeList)
        ));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_classify_windows_commands() {
        assert!(classify_readonly_command("ver", &[]).is_ok());
        assert!(classify_readonly_command("systeminfo", &[]).is_ok());
        assert!(classify_readonly_command("dir", &[]).is_ok());
        assert!(classify_readonly_command("date /t", &[]).is_ok());
        assert!(classify_readonly_command("time /t", &[]).is_ok());
        assert!(classify_readonly_command("vol", &[]).is_ok());
    }
}

#[cfg(test)]
mod readonly_execute_tests {
    use super::*;

    fn readonly_executor() -> ShellExec {
        ShellExec::new(ShellExecOptions {
            readonly_mode: true,
            allowed_commands: builtin_safe_commands(),
            denied_commands: vec![],
            skip_confirm: true,
            timeout_secs: 5,
            output_max_chars: 10_000,
            ..Default::default()
        })
    }

    #[tokio::test]
    async fn test_execute_pwd() {
        let r = readonly_executor()
            .execute("pwd", None, None)
            .await
            .unwrap();
        assert!(r.contains("Exit code: 0"));
    }

    #[tokio::test]
    async fn test_execute_ls() {
        let r = readonly_executor().execute("ls", None, None).await.unwrap();
        assert!(r.contains("Exit code: 0"));
    }

    #[tokio::test]
    async fn test_execute_echo() {
        let r = readonly_executor()
            .execute("echo hello_world", None, None)
            .await
            .unwrap();
        assert!(r.contains("Exit code: 0"));
        assert!(r.contains("hello_world"));
    }

    #[tokio::test]
    async fn test_execute_with_working_dir() {
        let tmp = std::env::temp_dir();
        let r = readonly_executor()
            .execute("pwd", None, tmp.to_str())
            .await
            .unwrap();
        assert!(r.contains("Exit code: 0"));
    }

    #[tokio::test]
    async fn test_execute_rejects_unsafe() {
        let r = readonly_executor()
            .execute("rm -rf /", None, None)
            .await
            .unwrap();
        assert!(r.contains("[ReadOnly] 命令被拒绝"));
        assert!(r.contains("file_read"), "应有替代指引: {}", r);
    }

    #[tokio::test]
    async fn test_execute_rejects_git() {
        let r = readonly_executor()
            .execute("git status", None, None)
            .await
            .unwrap();
        assert!(r.contains("[ReadOnly] 命令被拒绝"));
        assert!(
            r.contains("pwd") || r.contains("通用"),
            "应列出允许命令: {}",
            r
        );
    }

    #[tokio::test]
    async fn test_execute_rejects_redirect() {
        let r = readonly_executor()
            .execute("echo hello > /tmp/x", None, None)
            .await
            .unwrap();
        assert!(r.contains("[ReadOnly] 命令被拒绝"));
        assert!(r.contains("控制运算符"), "应指明控制运算符: {}", r);
    }

    #[tokio::test]
    async fn test_execute_rejects_pipe() {
        let r = readonly_executor()
            .execute("ls | sort", None, None)
            .await
            .unwrap();
        assert!(r.contains("[ReadOnly] 命令被拒绝"));
        assert!(r.contains("控制运算符"));
    }

    #[tokio::test]
    async fn test_execute_respects_user_deny() {
        let executor = ShellExec::new(ShellExecOptions {
            readonly_mode: true,
            allowed_commands: builtin_safe_commands(),
            denied_commands: vec!["ls".to_string()],
            skip_confirm: true,
            timeout_secs: 5,
            output_max_chars: 10_000,
            ..Default::default()
        });
        let r = executor.execute("ls -la", None, None).await.unwrap();
        assert!(r.contains("[ReadOnly] 命令被拒绝"));
        assert!(r.contains("禁止"), "应指明用户 deny: {}", r);
    }

    #[tokio::test]
    async fn test_execute_readonly_overrides_skip_confirm() {
        let executor = ShellExec::new(ShellExecOptions {
            readonly_mode: true,
            allowed_commands: builtin_safe_commands(),
            denied_commands: vec![],
            skip_confirm: true,
            timeout_secs: 5,
            output_max_chars: 10_000,
            ..Default::default()
        });
        let r = executor.execute("rm -rf /", None, None).await.unwrap();
        assert!(
            r.contains("[ReadOnly] 命令被拒绝"),
            "skip_confirm=true 不应绕过 readonly"
        );
    }

    #[tokio::test]
    async fn test_execute_bare_echo_rejected() {
        let r = readonly_executor()
            .execute("echo", None, None)
            .await
            .unwrap();
        assert!(r.contains("[ReadOnly] 命令被拒绝"), "bare echo 应被拒绝");
    }

    #[tokio::test]
    async fn test_normal_mode_still_works() {
        let executor = ShellExec::new(ShellExecOptions {
            readonly_mode: false,
            allowed_commands: builtin_safe_commands(),
            denied_commands: vec![],
            skip_confirm: true,
            timeout_secs: 5,
            output_max_chars: 10_000,
            ..Default::default()
        });
        let r = executor.execute("pwd", None, None).await.unwrap();
        assert!(
            r.contains("Exit code: 0"),
            "正常模式下 pwd 仍应可执行: {}",
            r
        );
    }

    #[tokio::test]
    async fn test_readonly_with_skip_confirm_false() {
        let executor = ShellExec::new(ShellExecOptions {
            readonly_mode: true,
            allowed_commands: builtin_safe_commands(),
            denied_commands: vec![],
            skip_confirm: false,
            timeout_secs: 5,
            output_max_chars: 10_000,
            ..Default::default()
        });
        let r = executor.execute("rm -rf /", None, None).await.unwrap();
        assert!(
            r.contains("[ReadOnly] 命令被拒绝"),
            "readonly_mode=true 时 skip_confirm=false 也应拒绝"
        );
    }
}

// ── split_commands 单元测试 ──

#[cfg(test)]
mod split_commands_tests {
    use super::*;

    fn assert_split(cmd: &str, expected: &[&str]) {
        let result = split_commands(cmd);
        let texts: Vec<&str> = result.parts.iter().map(|p| p.text).collect();
        assert_eq!(
            texts, expected,
            "split_commands({:?})\n  expected: {:?}\n  actual:   {:?}",
            cmd, expected, texts
        );
    }

    fn assert_split_with_flags(cmd: &str, expected: &[(&str, bool, bool)]) {
        let result = split_commands(cmd);
        assert_eq!(
            result.parts.len(),
            expected.len(),
            "split_commands({:?}): part count mismatch",
            cmd
        );
        for (i, (text, has_redirect, has_substitution)) in expected.iter().enumerate() {
            assert_eq!(
                result.parts[i].text, *text,
                "split_commands({:?})[{}].text",
                cmd, i
            );
            assert_eq!(
                result.parts[i].flags.has_redirect, *has_redirect,
                "split_commands({:?})[{}].flags.has_redirect",
                cmd, i
            );
            assert_eq!(
                result.parts[i].flags.has_substitution, *has_substitution,
                "split_commands({:?})[{}].flags.has_substitution",
                cmd, i
            );
        }
    }

    // ── 分组 1：基础拆分 ──

    #[test]
    fn test_single_command() {
        assert_split("pwd", &["pwd"]);
    }

    #[test]
    fn test_and_chain() {
        assert_split("git status && cargo build", &["git status", "cargo build"]);
    }

    #[test]
    fn test_triple_and() {
        assert_split(
            "echo a && echo b && echo c",
            &["echo a", "echo b", "echo c"],
        );
    }

    #[test]
    fn test_or() {
        assert_split("cmd1 || cmd2", &["cmd1", "cmd2"]);
    }

    #[test]
    fn test_semicolon() {
        assert_split("cmd1; cmd2", &["cmd1", "cmd2"]);
    }

    #[test]
    fn test_pipe() {
        assert_split("cmd1 | cmd2", &["cmd1", "cmd2"]);
    }

    #[test]
    fn test_background() {
        assert_split("sleep 5 &", &["sleep 5"]);
    }

    #[test]
    fn test_mixed_operators() {
        assert_split("a && b || c; d | e", &["a", "b", "c", "d", "e"]);
    }

    // ── 分组 2：引号内运算符跳过 ──

    #[test]
    fn test_double_quote_and() {
        assert_split(r#"echo "a && b""#, &[r#"echo "a && b""#]);
    }

    #[test]
    fn test_single_quote_and() {
        assert_split(r#"echo 'a && b'"#, &[r#"echo 'a && b'"#]);
    }

    #[test]
    fn test_mixed_quotes() {
        assert_split(
            r#"foo && bar "x || y" 'a && b'"#,
            &["foo", r#"bar "x || y" 'a && b'"#],
        );
    }

    #[test]
    fn test_simple_quotes() {
        assert_split(r#"echo "hello""#, &[r#"echo "hello""#]);
    }

    #[test]
    fn test_escaped_double_quote() {
        let cmd = "echo \"escaped \\\"quote\\\"\"";
        assert_split(cmd, &[cmd]);
    }

    // ── 分组 3：命令替换 / 参数展开 ──

    #[test]
    fn test_command_subst_and() {
        assert_split_with_flags("echo $(foo && bar)", &[("echo $(foo && bar)", false, true)]);
    }

    #[test]
    fn test_command_subst_with_inner_quotes() {
        assert_split_with_flags(
            r#"echo $(foo "a && b")"#,
            &[(r#"echo $(foo "a && b")"#, false, true)],
        );
    }

    #[test]
    fn test_arith_expansion() {
        assert_split_with_flags("echo $((1 + 2))", &[("echo $((1 + 2))", false, true)]);
    }

    #[test]
    fn test_param_expansion_clean() {
        assert_split_with_flags("echo ${VAR:-foo}", &[("echo ${VAR:-foo}", false, false)]);
    }

    #[test]
    fn test_backtick() {
        assert_split_with_flags("echo `whoami`", &[("echo `whoami`", false, true)]);
    }

    #[test]
    fn test_nested_command_subst() {
        assert_split_with_flags(
            "echo $(a $(b && c) d)",
            &[("echo $(a $(b && c) d)", false, true)],
        );
    }

    #[test]
    fn test_escaped_dollar() {
        assert_split(r"a && echo \$(b)", &["a", r"echo \$(b)"]);
    }

    #[test]
    fn test_command_subst_in_double_quote() {
        assert_split_with_flags(
            r#"echo "$(foo && bar)""#,
            &[(r#"echo "$(foo && bar)""#, false, true)],
        );
    }

    #[test]
    fn test_backtick_in_double_quote() {
        assert_split_with_flags("echo \"`whoami`\"", &[("echo \"`whoami`\"", false, true)]);
    }

    // ── 分组 4：重定向运算符 ──

    #[test]
    fn test_redirect_output() {
        assert_split_with_flags(
            "echo hello > /tmp/file",
            &[("echo hello > /tmp/file", true, false)],
        );
    }

    #[test]
    fn test_redirect_append() {
        assert_split_with_flags(
            "echo hello >> /tmp/log",
            &[("echo hello >> /tmp/log", true, false)],
        );
    }

    #[test]
    fn test_redirect_fd() {
        assert_split_with_flags("echo 2>&1", &[("echo 2>&1", true, false)]);
    }

    #[test]
    fn test_redirect_ampersand() {
        assert_split_with_flags(
            "echo foo &> /dev/null",
            &[("echo foo &> /dev/null", true, false)],
        );
    }

    #[test]
    fn test_redirect_input() {
        assert_split_with_flags("cat < input.txt", &[("cat < input.txt", true, false)]);
    }

    #[test]
    fn test_heredoc() {
        assert_split_with_flags("cat << EOF", &[("cat << EOF", true, false)]);
    }

    #[test]
    fn test_herestring() {
        assert_split_with_flags(
            r#"cat <<< "hello world""#,
            &[(r#"cat <<< "hello world""#, true, false)],
        );
    }

    #[test]
    fn test_redirect_readwrite() {
        assert_split_with_flags("exec 3<> /dev/tcp", &[("exec 3<> /dev/tcp", true, false)]);
    }

    #[test]
    fn test_chain_with_redirect() {
        assert_split_with_flags(
            "cmd1 && echo done > /tmp/out",
            &[
                ("cmd1", false, false),
                ("echo done > /tmp/out", true, false),
            ],
        );
    }

    // ── 分组 5：转义字符 ──

    #[test]
    fn test_escaped_ampersand() {
        assert_split(r"echo a \& b", &[r"echo a \& b"]);
    }

    #[test]
    fn test_escaped_pipe() {
        assert_split(r"echo a \| b", &[r"echo a \| b"]);
    }

    #[test]
    fn test_escaped_semicolon() {
        assert_split(r"echo a \; b", &[r"echo a \; b"]);
    }

    // ── 分组 6：复杂混合 ──

    #[test]
    fn test_build_with_redirect_and_echo() {
        assert_split_with_flags(
            "cargo build > /tmp/log && echo done",
            &[
                ("cargo build > /tmp/log", true, false),
                ("echo done", false, false),
            ],
        );
    }

    #[test]
    fn test_pipe_ampersand() {
        assert_split("cmd1 |& cmd2", &["cmd1", "cmd2"]);
    }

    #[test]
    fn test_mixed_redirect_and_or() {
        assert_split_with_flags(
            "a && b > x || c",
            &[
                ("a", false, false),
                ("b > x", true, false),
                ("c", false, false),
            ],
        );
    }

    #[test]
    fn test_substitution_and_chain() {
        assert_split_with_flags(
            "echo $(whoami) && echo done",
            &[("echo $(whoami)", false, true), ("echo done", false, false)],
        );
    }

    #[test]
    fn test_substitution_and_redirect_together() {
        assert_split_with_flags(
            "echo $(whoami) > /tmp/log",
            &[("echo $(whoami) > /tmp/log", true, true)],
        );
    }

    // ── 分组 7：边缘情况 ──

    #[test]
    fn test_empty_string() {
        let r = split_commands("");
        assert!(r.parts.is_empty());
    }

    #[test]
    fn test_whitespace_only() {
        let r = split_commands("   ");
        assert!(r.parts.is_empty());
    }

    #[test]
    fn test_trailing_operator() {
        assert_split("cmd &&", &["cmd"]);
    }

    #[test]
    fn test_leading_operator() {
        assert_split("&& cmd", &["cmd"]);
    }

    #[test]
    fn test_empty_middle_part() {
        assert_split("foo &&   && bar", &["foo", "bar"]);
    }

    #[test]
    fn test_unclosed_command_subst() {
        let r = split_commands("echo $(unclosed");
        assert_eq!(r.parts.len(), 1);
    }

    #[test]
    fn test_unclosed_param_subst() {
        let r = split_commands("echo ${unclosed");
        assert_eq!(r.parts.len(), 1);
    }

    #[test]
    fn test_unclosed_single_quote() {
        let r = split_commands("echo 'unclosed &&");
        assert_eq!(r.parts.len(), 1);
    }

    #[test]
    fn test_unclosed_double_quote() {
        let r = split_commands("echo \"unclosed &&");
        assert_eq!(r.parts.len(), 1);
    }

    #[test]
    fn test_unclosed_backtick() {
        let r = split_commands("echo `unclosed");
        assert_eq!(r.parts.len(), 1);
    }

    // ── 分组 8：Unicode ──

    #[test]
    fn test_unicode_chinese() {
        assert_split("echo 你好世界", &["echo 你好世界"]);
    }

    #[test]
    fn test_unicode_accent() {
        assert_split("echo café", &["echo café"]);
    }

    #[test]
    fn test_unicode_with_operator() {
        assert_split("git status && echo 你好", &["git status", "echo 你好"]);
    }

    // ── 验证 CommandFlags ──

    #[test]
    fn test_flags_clean() {
        assert_split_with_flags("pwd", &[("pwd", false, false)]);
    }
}

// ── 权限决策单元测试 ──

#[cfg(test)]
mod permission_decision_tests {
    use super::*;

    // ── 分组 9：基础检查函数 ──

    #[test]
    fn test_builtin_safe_pwd() {
        assert!(is_builtin_safe("pwd"));
    }

    #[test]
    fn test_builtin_safe_echo_with_text() {
        assert!(is_builtin_safe("echo hello"));
    }

    #[test]
    fn test_builtin_safe_git_status() {
        assert!(!is_builtin_safe("git status"));
    }

    #[test]
    fn test_builtin_safe_word_boundary() {
        assert!(!is_builtin_safe("pwdconfig"));
    }

    #[test]
    fn test_user_allowed_match() {
        assert!(is_user_allowed("git status", &["git status".to_string()]));
    }

    #[test]
    fn test_user_allowed_no_match() {
        assert!(!is_user_allowed("git commit", &["git status".to_string()]));
    }

    #[test]
    fn test_denied_match() {
        assert!(is_denied("rm -rf /", &["rm".to_string()]));
    }

    #[test]
    fn test_denied_no_match() {
        assert!(!is_denied("git status", &["rm".to_string()]));
    }

    // ── 分组 10：审批决策验证 ──

    fn should_prompt(part: &CommandPart, allowed: &[String]) -> bool {
        if part.flags.has_substitution {
            return true;
        }
        if part.flags.has_redirect {
            return !is_user_allowed(part.text, allowed);
        }
        !is_builtin_safe(part.text) && !is_user_allowed(part.text, allowed)
    }

    #[test]
    fn test_decision_clean_builtin() {
        let part = CommandPart {
            text: "pwd",
            range: 0..3,
            flags: CommandFlags {
                has_redirect: false,
                has_substitution: false,
            },
        };
        assert!(!should_prompt(&part, &[]));
    }

    #[test]
    fn test_decision_clean_builtin_echo() {
        let part = CommandPart {
            text: "echo hello",
            range: 0..10,
            flags: CommandFlags {
                has_redirect: false,
                has_substitution: false,
            },
        };
        assert!(!should_prompt(&part, &[]));
    }

    #[test]
    fn test_decision_clean_user_allowed() {
        let part = CommandPart {
            text: "git status",
            range: 0..10,
            flags: CommandFlags {
                has_redirect: false,
                has_substitution: false,
            },
        };
        assert!(!should_prompt(&part, &["git status".to_string()]));
    }

    #[test]
    fn test_decision_clean_not_allowed() {
        let part = CommandPart {
            text: "rm -rf /",
            range: 0..8,
            flags: CommandFlags {
                has_redirect: false,
                has_substitution: false,
            },
        };
        assert!(should_prompt(&part, &[]));
    }

    #[test]
    fn test_decision_redirect_builtin_not_allowed() {
        let part = CommandPart {
            text: "echo hello > /tmp/file",
            range: 0..22,
            flags: CommandFlags {
                has_redirect: true,
                has_substitution: false,
            },
        };
        assert!(should_prompt(&part, &[]));
    }

    #[test]
    fn test_decision_redirect_user_allowed() {
        let part = CommandPart {
            text: "echo hello > /tmp/file",
            range: 0..22,
            flags: CommandFlags {
                has_redirect: true,
                has_substitution: false,
            },
        };
        assert!(!should_prompt(&part, &["echo ".to_string()]));
    }

    #[test]
    fn test_decision_redirect_not_allowed() {
        let part = CommandPart {
            text: "cargo build > /tmp/log",
            range: 0..23,
            flags: CommandFlags {
                has_redirect: true,
                has_substitution: false,
            },
        };
        assert!(should_prompt(&part, &[]));
    }

    #[test]
    fn test_decision_redirect_user_allowed_cargo() {
        let part = CommandPart {
            text: "cargo build > /tmp/log",
            range: 0..23,
            flags: CommandFlags {
                has_redirect: true,
                has_substitution: false,
            },
        };
        assert!(!should_prompt(&part, &["cargo ".to_string()]));
    }

    #[test]
    fn test_decision_substitution_always_prompt() {
        let part = CommandPart {
            text: "echo $(whoami)",
            range: 0..15,
            flags: CommandFlags {
                has_redirect: false,
                has_substitution: true,
            },
        };
        assert!(should_prompt(&part, &["echo ".to_string()]));
        assert!(should_prompt(&part, &[]));
    }

    #[test]
    fn test_decision_redirect_and_substitution() {
        let part = CommandPart {
            text: "echo $(whoami) > /tmp/log",
            range: 0..27,
            flags: CommandFlags {
                has_redirect: true,
                has_substitution: true,
            },
        };
        assert!(should_prompt(&part, &["echo ".to_string()]));
        assert!(should_prompt(&part, &[]));
    }

    // ── 分组 11：deny 优先 ──

    #[test]
    fn test_deny_overrides_clean() {
        let part = CommandPart {
            text: "rm -rf /",
            range: 0..8,
            flags: CommandFlags {
                has_redirect: false,
                has_substitution: false,
            },
        };
        assert!(is_denied(part.text, &["rm".to_string()]));
    }

    #[test]
    fn test_deny_overrides_builtin() {
        assert!(is_denied("pwd", &["pwd".to_string()]));
    }

    #[test]
    fn test_deny_overrides_allow() {
        assert!(is_denied("git status", &["git status".to_string()]));
    }

    #[test]
    fn test_deny_overrides_redirect() {
        assert!(is_denied("echo hello > file", &["echo".to_string()]));
    }
}

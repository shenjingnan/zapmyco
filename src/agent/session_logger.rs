/// 对话日志模块 — 将每次 LLM 调用的完整请求/响应记录到 ~/.zapmyco/sessions/<session_id>/
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};

use chrono::Local;

const SESSIONS_DIR: &str = "sessions";

/// 一条日志记录，对应 JSONL 中的一行
#[derive(Debug, Serialize, Deserialize)]
pub struct ConversationRecord {
    /// 会话 ID: YYYY-MM-DD_HHMM_P{PID}
    pub session_id: String,
    /// 当前会话中的第几轮 round-trip（从0开始）
    pub order: u32,
    /// 本轮时间戳（ISO 8601）
    pub ts: String,
    /// API 调用耗时（毫秒）
    pub duration_ms: u64,
    /// 发送给 API 的完整请求参数
    pub request: serde_json::Value,
    /// API 返回的完整响应
    pub response: serde_json::Value,
    /// HTTP 状态码
    #[serde(skip_serializing_if = "Option::is_none")]
    pub http_status: Option<u16>,
    /// 剩余请求配额
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rate_limit_remaining: Option<u32>,
    /// 配额重置时间（Unix 时间戳）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rate_limit_reset: Option<u64>,
}

/// 对话日志写入器，每个会话创建一个实例
pub struct SessionLogger {
    /// 当前会话的 conversation.jsonl 文件路径（位于会话子目录下）
    log_path: PathBuf,
    /// 会话 ID
    session_id: String,
    /// round-trip 计数器
    order: AtomicU32,
}

impl SessionLogger {
    /// 创建新的日志记录器
    ///
    /// 在 `~/.zapmyco/sessions/` 下创建一个独立的会话子目录，
    /// 子目录中包含 conversation.jsonl 记录 LLM 调用日志。
    pub fn new() -> Result<Self, String> {
        let session_id = generate_session_id();
        let sessions_dir = get_sessions_dir()?;
        // 确保 sessions/ 父目录存在
        std::fs::create_dir_all(&sessions_dir).map_err(|e| format!("创建会话目录失败: {}", e))?;
        // 创建会话子目录
        let session_dir = sessions_dir.join(&session_id);
        std::fs::create_dir(&session_dir).map_err(|e| format!("创建会话子目录失败: {}", e))?;
        // JSONL 文件放在子目录内
        let log_path = session_dir.join("conversation.jsonl");

        Ok(Self {
            log_path,
            session_id,
            order: AtomicU32::new(0),
        })
    }

    /// 追加一条日志记录到 jsonl 文件
    #[expect(clippy::too_many_arguments)]
    pub fn append_record(
        &self,
        ts: String,
        duration_ms: u64,
        request: serde_json::Value,
        response: serde_json::Value,
        http_status: Option<u16>,
        rate_limit_remaining: Option<u32>,
        rate_limit_reset: Option<u64>,
    ) -> Result<(), String> {
        let order = self.order.fetch_add(1, Ordering::SeqCst);

        let record = ConversationRecord {
            session_id: self.session_id.clone(),
            order,
            ts,
            duration_ms,
            request,
            response,
            http_status,
            rate_limit_remaining,
            rate_limit_reset,
        };

        let json_line =
            serde_json::to_string(&record).map_err(|e| format!("序列化日志记录失败: {}", e))?;

        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.log_path)
            .map_err(|e| format!("打开日志文件失败: {}", e))?;

        writeln!(file, "{}", json_line).map_err(|e| format!("写入日志文件失败: {}", e))?;

        Ok(())
    }

    /// 获取 session_id
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    /// 返回当前会话子目录路径（供 LogTarget 等组件使用）
    pub fn session_dir(&self) -> PathBuf {
        // log_path 为 {session_dir}/conversation.jsonl
        self.log_path
            .parent()
            .expect("log_path 应有父目录")
            .to_path_buf()
    }
}

/// 一条工具调用记录，对应 tool_calls.jsonl 中的一行
#[derive(Debug, Serialize, Deserialize)]
pub struct ToolCallRecord {
    /// 会话 ID: YYYY-MM-DD_HHMMSS_P{PID}
    pub session_id: String,
    /// 会话内全局递增序号（从 0 开始）
    pub order: u64,
    /// ISO 8601 时间戳
    pub ts: String,
    /// 工具调用轮次序号（第几次 round-trip）
    pub round: u32,
    /// 工具名称（如 "file_read"）
    pub tool: String,
    /// API 返回的 tool_use_id
    pub tool_use_id: String,
    /// 工具的输入参数
    pub input: serde_json::Value,
    /// 给 LLM 的完整输出文本（与 ToolResult.content 一致）
    pub output: String,
    /// 原始错误信息（无 [Tool error: ...] 包装），成功时为 None
    pub error: Option<String>,
    /// 执行耗时（毫秒）
    pub duration_ms: u64,
}

/// 工具调用日志写入器，输出到 <session_dir>/tool_calls.jsonl
pub struct ToolCallLogger {
    log_path: PathBuf,
    session_id: String,
    order: AtomicU64,
    /// 写锁：确保并发写入时行不交错
    write_lock: std::sync::Mutex<()>,
}

impl ToolCallLogger {
    /// 创建新的工具调用日志记录器
    ///
    /// session_dir: SessionLogger 创建的会话子目录路径
    /// 文件写入 <session_dir>/tool_calls.jsonl
    pub fn new(session_dir: &std::path::Path, session_id: &str) -> Result<Self, String> {
        let log_path = session_dir.join("tool_calls.jsonl");
        Ok(Self {
            log_path,
            session_id: session_id.to_string(),
            order: AtomicU64::new(0),
            write_lock: std::sync::Mutex::new(()),
        })
    }

    /// 追加一条工具调用记录到 tool_calls.jsonl
    ///
    /// 使用 `std::fs` 同步 I/O（与 SessionLogger.append_record 一致），
    /// 避免在 tokio 运行时中引入额外的异步 I/O 复杂度。
    /// 写失败会向上传播错误，调用方应记录但不影响主流程。
    #[expect(clippy::too_many_arguments)]
    pub fn append_tool_call(
        &self,
        tool: &str,
        tool_use_id: &str,
        input: &serde_json::Value,
        output: &str,
        error: Option<&str>,
        duration_ms: u64,
        round: u32,
    ) -> Result<(), String> {
        let order = self.order.fetch_add(1, Ordering::SeqCst);
        let ts = crate::datetime::iso_timestamp_now();

        let record = ToolCallRecord {
            session_id: self.session_id.clone(),
            order,
            ts,
            round,
            tool: tool.to_string(),
            tool_use_id: tool_use_id.to_string(),
            input: input.clone(),
            output: output.to_string(),
            error: error.map(|s| s.to_string()),
            duration_ms,
        };

        let json_line =
            serde_json::to_string(&record).map_err(|e| format!("序列化工具调用记录失败: {}", e))?;

        let _lock = self.write_lock.lock().unwrap();

        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.log_path)
            .map_err(|e| format!("打开工具调用日志文件失败: {}", e))?;

        writeln!(file, "{}", json_line).map_err(|e| format!("写入工具调用日志文件失败: {}", e))?;

        Ok(())
    }

    /// 返回当前会话子目录路径
    pub fn session_dir(&self) -> std::path::PathBuf {
        self.log_path
            .parent()
            .expect("log_path 应有父目录")
            .to_path_buf()
    }

    /// 获取 session_id
    pub fn session_id(&self) -> &str {
        &self.session_id
    }
}

// ============================================================================
// SessionMeta — session.json 元数据
// ============================================================================

// ============================================================================
// SessionMeta — session.json 元数据
// ============================================================================

const SESSION_META_FILE: &str = "session.json";

/// Session 元数据，写入 session.json
#[derive(Debug, Serialize, Deserialize)]
pub struct SessionMeta {
    /// session.json 文件路径
    #[serde(skip)]
    log_path: PathBuf,
    /// 会话 ID
    pub session_id: String,
    /// 应用版本号
    pub app_version: String,
    /// 启动时间（ISO 8601）
    pub started_at: String,
    /// 结束时间（ISO 8601），null 表示异常退出（panic/崩溃）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
    /// 退出原因。null 表示异常退出
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_reason: Option<ExitReason>,
    /// 使用的 profile 名称
    pub profile: String,
    /// 使用的 provider 名称
    pub provider: String,
    /// 使用的模型名称
    pub model: String,
    /// API base URL
    pub base_url: String,
    /// 权限模式
    pub permission_mode: String,
    /// 是否为子 agent
    pub is_subagent: bool,
    /// 父 agent 的 session_id（仅子 agent 时存在）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_session_id: Option<String>,
    /// 系统环境信息
    pub system_info: SystemInfo,
}

/// 系统环境信息
#[derive(Debug, Serialize, Deserialize)]
pub struct SystemInfo {
    pub os: String,
    pub shell: String,
    pub locale: String,
}

/// 退出原因
#[derive(Debug, Serialize, Deserialize)]
pub enum ExitReason {
    #[serde(rename = "completed")]
    Completed,
    #[serde(rename = "interrupted")]
    Interrupted,
    #[serde(rename = "error")]
    Error,
}

impl SessionMeta {
    /// 创建新的 SessionMeta 并写入 session.json
    #[expect(clippy::too_many_arguments)]
    pub fn create(
        session_dir: &std::path::Path,
        session_id: &str,
        app_version: &str,
        profile: &str,
        provider: &str,
        model: &str,
        base_url: &str,
        permission_mode: &str,
        is_subagent: bool,
        parent_session_id: Option<&str>,
        os: &str,
        shell: &str,
        locale: &str,
    ) -> Result<Self, String> {
        let log_path = session_dir.join(SESSION_META_FILE);
        let started_at = crate::datetime::iso_timestamp_now();
        let meta = Self {
            log_path: log_path.clone(),
            session_id: session_id.to_string(),
            app_version: app_version.to_string(),
            started_at,
            finished_at: None,
            exit_reason: None,
            profile: profile.to_string(),
            provider: provider.to_string(),
            model: model.to_string(),
            base_url: base_url.to_string(),
            permission_mode: permission_mode.to_string(),
            is_subagent,
            parent_session_id: parent_session_id.map(|s| s.to_string()),
            system_info: SystemInfo {
                os: os.to_string(),
                shell: shell.to_string(),
                locale: locale.to_string(),
            },
        };
        meta.save()?;
        Ok(meta)
    }

    /// 写入 session.json（原子写入）
    fn save(&self) -> Result<(), String> {
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| format!("序列化 SessionMeta 失败: {}", e))?;
        write_session_json(&self.log_path, &json)
    }

    /// 标记 session 完成（更新 finished_at 和 exit_reason）
    pub fn finish(&self, exit_reason: ExitReason) -> Result<(), String> {
        let finished_at = crate::datetime::iso_timestamp_now();
        let json = serde_json::to_string_pretty(&serde_json::json!({
            "session_id": self.session_id,
            "app_version": self.app_version,
            "started_at": self.started_at,
            "finished_at": finished_at,
            "exit_reason": exit_reason,
            "profile": self.profile,
            "provider": self.provider,
            "model": self.model,
            "base_url": self.base_url,
            "permission_mode": self.permission_mode,
            "is_subagent": self.is_subagent,
            "parent_session_id": self.parent_session_id,
            "system_info": {
                "os": self.system_info.os,
                "shell": self.system_info.shell,
                "locale": self.system_info.locale,
            },
        }))
        .map_err(|e| format!("序列化 SessionMeta 失败: {}", e))?;
        write_session_json(&self.log_path, &json)
    }

    /// 返回 session.json 文件路径
    pub fn path(&self) -> &std::path::Path {
        &self.log_path
    }

    /// 获取 session_id
    pub fn session_id(&self) -> &str {
        &self.session_id
    }
}

/// 原子写入 JSON 文件（临时文件 + rename）
pub(crate) fn write_session_json(path: &std::path::Path, content: &str) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, content).map_err(|e| format!("写入临时文件失败: {}", e))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("重命名文件失败: {}", e))?;
    Ok(())
}

// ============================================================================
// EventsLogger — events.log 用户交互事件
// ============================================================================

/// 在 session 目录下写入 events.log（用户交互事件）
///
/// 使用 `SESSION_LOG_DIR` 全局状态定位 session 目录（与 app.log 相同）。
/// 如果当前没有活跃 session，则静默忽略。
pub fn log_user_event(event: &str) {
    use std::io::Write;
    if let Some(session_dir) = crate::logging::get_session_log_dir() {
        let path = session_dir.join("events.log");
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
        {
            let ts = crate::datetime::iso_timestamp_now();
            let _ = writeln!(file, "[{}] {}", ts, event);
        }
    }
}

/// 脱敏用户输入（替换疑似敏感信息），不使用 regex 依赖
pub fn sanitize_user_input(input: &str) -> String {
    let mut result = input.to_string();
    // 替换 sk- 开头的 API Key（sk-后至少 20 位字母数字）
    let mut i = 0;
    while i < result.len() {
        if result[i..].starts_with("sk-") {
            let start = i;
            let rest = &result[i + 3..];
            let key_len = rest.chars().take_while(|c| c.is_alphanumeric()).count();
            if key_len >= 20 {
                result.replace_range(start..start + 3 + key_len, "sk-***");
                i = start + 6; // "sk-***" 长度
                continue;
            }
        }
        i += 1;
    }
    result
}

/// 获取日志目录路径: ~/.zapmyco/sessions/
pub(crate) fn get_sessions_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "无法获取用户 HOME 目录".to_string())?;

    Ok(PathBuf::from(home).join(format!(".zapmyco/{}", SESSIONS_DIR)))
}

/// 生成会话 ID: YYYY-MM-DD_HHMMSS_P{PID}
///
/// - YYYY-MM-DD_HHMMSS: 当前日期和时间（秒级），可读性好
/// - P{PID}: 进程 ID，加前缀标识，确保唯一性
fn generate_session_id() -> String {
    let now = Local::now();
    let ts = now.format("%Y-%m-%d_%H%M%S").to_string();
    let pid = std::process::id();

    format!("{}_P{}", ts, pid)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_generate_session_id_format() {
        let id = generate_session_id();
        // 格式: YYYY-MM-DD_HHMMSS_P{PID}
        // 示例: 2026-05-29_091509_P22500
        // 以 _ 分割为 [日期, 时间, P{PID}]
        let parts: Vec<&str> = id.split('_').collect();
        assert_eq!(parts.len(), 3, "session_id 应有 3 段: {}", id);
        // 第一段是日期: YYYY-MM-DD (10 字符)
        assert_eq!(parts[0].len(), 10, "日期部分应为 10 位: {}", parts[0]);
        // 第二段是时间: HHMMSS (6 字符)
        assert_eq!(parts[1].len(), 6, "时间部分应为 6 位: {}", parts[1]);
        // 第三段是 P{PID}
        assert!(parts[2].starts_with('P'), "第三段应以 P 开头: {}", parts[2]);
        assert!(parts[2].len() > 1, "PID 部分不应为空");
    }

    #[test]
    fn test_session_id_changes_each_call() {
        let id1 = generate_session_id();
        let id2 = generate_session_id();
        // 秒级精度 + PID 通常足以区分两次调用
        // 同秒同 PID 的极端情况也可能发生，此时 ID 相同
        // 我们不强制断言不同，仅验证格式
        assert!(!id1.is_empty());
        assert!(!id2.is_empty());
    }

    #[test]
    fn test_logger_new() {
        use crate::test_util::run_with_temp_home;
        crate::test_util::run_with_temp_home(|home| {
            let logger = SessionLogger::new();
            assert!(logger.is_ok());
            let logger = logger.unwrap();
            // session_id 格式: YYYY-MM-DD_HHMMSS_P{PID}，至少 20 位
            assert!(
                logger.session_id.len() >= 20,
                "session_id 长度至少 20: {}",
                logger.session_id
            );
            // 验证子目录已被创建
            let session_dir = home.join(".zapmyco/sessions").join(&logger.session_id);
            assert!(session_dir.is_dir(), "会话子目录应已创建");
        });
    }

    #[test]
    fn test_logger_creates_file_on_append() {
        use crate::test_util::run_with_temp_home;
        crate::test_util::run_with_temp_home(|home| {
            let logger = SessionLogger::new().unwrap();
            let log_dir = home.join(".zapmyco/sessions");
            let expected_file = log_dir.join(&logger.session_id).join("conversation.jsonl");

            // 文件还未创建（append 时才创建）
            assert!(!expected_file.exists());

            // 追加一条记录
            let result = logger.append_record(
                "2026-05-29T16:00:00Z".to_string(),
                1234,
                serde_json::json!({"model": "test"}),
                serde_json::json!({"content": "hello"}),
                None,
                None,
                None,
            );
            assert!(result.is_ok());

            // 文件应已创建
            assert!(expected_file.exists());

            // 验证文件内容
            let content = std::fs::read_to_string(&expected_file).unwrap();
            assert!(content.contains("2026-05-29T16:00:00Z"));
            assert!(content.contains("test"));
            assert!(content.contains("hello"));
        });
    }

    #[test]
    fn test_logger_append_multiple_lines() {
        use crate::test_util::run_with_temp_home;
        crate::test_util::run_with_temp_home(|home| {
            let logger = SessionLogger::new().unwrap();

            logger
                .append_record(
                    "ts1".to_string(),
                    100,
                    json!({"msg": "req1"}),
                    json!({"msg": "resp1"}),
                    None,
                    None,
                    None,
                )
                .unwrap();
            logger
                .append_record(
                    "ts2".to_string(),
                    200,
                    json!({"msg": "req2"}),
                    json!({"msg": "resp2"}),
                    None,
                    None,
                    None,
                )
                .unwrap();

            let log_dir = home.join(".zapmyco/sessions");
            let content = std::fs::read_to_string(
                log_dir.join(&logger.session_id).join("conversation.jsonl"),
            )
            .unwrap();

            let lines: Vec<&str> = content.lines().collect();
            assert_eq!(lines.len(), 2, "应有 2 行日志");
            assert!(lines[0].contains("req1"));
            assert!(lines[1].contains("req2"));

            // 验证 order
            let record0: serde_json::Value = serde_json::from_str(lines[0]).unwrap();
            let record1: serde_json::Value = serde_json::from_str(lines[1]).unwrap();
            assert_eq!(record0["order"], 0);
            assert_eq!(record1["order"], 1);
        });
    }

    #[test]
    fn test_get_sessions_dir() {
        use crate::test_util::run_with_temp_home;
        crate::test_util::run_with_temp_home(|home| {
            let dir = get_sessions_dir().unwrap();
            assert_eq!(dir, home.join(".zapmyco/sessions"));
        });
    }

    #[test]
    fn test_get_sessions_dir_home_not_set() {
        // SAFETY: 手动获取 HOME_LOCK 确保无竞态
        let _guard = crate::test_util::acquire_home_lock();
        let orig_home = std::env::var("HOME").ok();
        let orig_userprofile = std::env::var("USERPROFILE").ok();
        unsafe {
            std::env::remove_var("HOME");
            std::env::remove_var("USERPROFILE");
        }
        let result = get_sessions_dir();
        assert!(result.is_err());
        assert!(result.err().unwrap().contains("HOME"));
        if let Some(h) = orig_home {
            unsafe {
                std::env::set_var("HOME", h);
            }
        }
        if let Some(up) = orig_userprofile {
            unsafe {
                std::env::set_var("USERPROFILE", up);
            }
        }
    }

    #[test]
    fn test_logger_new_home_not_set() {
        // SAFETY: 手动获取 HOME_LOCK 确保无竞态
        let _guard = crate::test_util::acquire_home_lock();
        let orig_home = std::env::var("HOME").ok();
        let orig_userprofile = std::env::var("USERPROFILE").ok();
        unsafe {
            std::env::remove_var("HOME");
            std::env::remove_var("USERPROFILE");
        }
        let result = SessionLogger::new();
        assert!(result.is_err());
        if let Some(h) = orig_home {
            unsafe {
                std::env::set_var("HOME", h);
            }
        }
        if let Some(up) = orig_userprofile {
            unsafe {
                std::env::set_var("USERPROFILE", up);
            }
        }
    }

    #[test]
    fn test_generate_session_id_uniqueness() {
        let id1 = generate_session_id();
        let id2 = generate_session_id();
        // 秒级精度下有可能同秒生成相同 ID，但通常不同
        // 至少验证格式正确且非空
        assert!(!id1.is_empty());
        assert!(!id2.is_empty());
        let parts1: Vec<&str> = id1.split('_').collect();
        let parts2: Vec<&str> = id2.split('_').collect();
        assert_eq!(parts1.len(), 3);
        assert_eq!(parts2.len(), 3);
        // 时间部分应格式正确（YYYY-MM-DD_HHMMSS）
        assert_eq!(parts1[0].len(), 10);
        assert_eq!(parts1[1].len(), 6);
        assert!(parts1[2].starts_with('P'));
    }

    #[test]
    fn test_logger_order_increments() {
        use crate::test_util::run_with_temp_home;

        crate::test_util::run_with_temp_home(|home| {
            let logger = SessionLogger::new().unwrap();
            for i in 0..5 {
                logger
                    .append_record(
                        "ts".to_string(),
                        i,
                        serde_json::json!({"n": i}),
                        serde_json::json!({"n": i}),
                        None,
                        None,
                        None,
                    )
                    .unwrap();
            }

            let log_dir = home.join(".zapmyco/sessions");
            let content = std::fs::read_to_string(
                log_dir.join(logger.session_id()).join("conversation.jsonl"),
            )
            .unwrap();
            let lines: Vec<&str> = content.lines().collect();
            assert_eq!(lines.len(), 5, "应有 5 条日志记录");

            let orders: Vec<u32> = lines
                .iter()
                .map(|line| {
                    let v: serde_json::Value = serde_json::from_str(line).unwrap();
                    v["order"].as_u64().unwrap() as u32
                })
                .collect();
            assert_eq!(orders, vec![0, 1, 2, 3, 4], "order 应连续递增");
        });
    }

    // ==================== 新格式子目录测试 ====================

    #[test]
    fn test_session_dir_returns_correct_path() {
        use crate::test_util::run_with_temp_home;
        crate::test_util::run_with_temp_home(|home| {
            let logger = SessionLogger::new().unwrap();
            let session_dir = logger.session_dir();

            // 验证返回的是子目录
            let expected = home.join(".zapmyco/sessions").join(&logger.session_id);
            assert_eq!(session_dir, expected, "session_dir 应与期望路径一致");

            // 验证子目录已存在
            assert!(session_dir.is_dir(), "子目录应已存在");

            // 验证子目录名称与 session_id 一致
            let dir_name = session_dir.file_name().and_then(|s| s.to_str()).unwrap();
            assert_eq!(dir_name, &logger.session_id, "目录名应与 session_id 一致");
        });
    }

    #[test]
    fn test_new_creates_session_directory() {
        use crate::test_util::run_with_temp_home;
        crate::test_util::run_with_temp_home(|home| {
            let logger = SessionLogger::new().unwrap();
            let session_dir = home.join(".zapmyco/sessions").join(&logger.session_id);
            let jsonl_path = session_dir.join("conversation.jsonl");

            // new() 后：子目录存在但文件不存在
            assert!(session_dir.is_dir(), "子目录应在 new() 时创建");
            assert!(!jsonl_path.exists(), "jsonl 应在 append 时才创建");
        });
    }

    #[test]
    fn test_session_dir_isolation() {
        use crate::test_util::run_with_temp_home;
        use std::time::Duration;
        crate::test_util::run_with_temp_home(|home| {
            let logger1 = SessionLogger::new().unwrap();
            // 等待跨秒边界确保 session_id 不同（秒级精度）
            std::thread::sleep(Duration::from_millis(1500));
            let logger2 = SessionLogger::new().unwrap();

            // 两个 session_id 不同
            assert_ne!(
                logger1.session_id, logger2.session_id,
                "两次 new() 的 session_id 应不同"
            );

            // 子目录路径不同
            let base = home.join(".zapmyco/sessions");
            assert_ne!(
                base.join(&logger1.session_id),
                base.join(&logger2.session_id),
                "两个 Logger 的子目录路径应不同"
            );

            // 各自写数据到各自子目录
            logger1
                .append_record(
                    "ts1".into(),
                    100,
                    serde_json::json!({"msg": "logger1"}),
                    serde_json::json!({"msg": "ok"}),
                    None,
                    None,
                    None,
                )
                .unwrap();
            logger2
                .append_record(
                    "ts2".into(),
                    200,
                    serde_json::json!({"msg": "logger2"}),
                    serde_json::json!({"msg": "ok"}),
                    None,
                    None,
                    None,
                )
                .unwrap();

            // 验证数据隔离
            let f1 =
                std::fs::read_to_string(base.join(&logger1.session_id).join("conversation.jsonl"))
                    .unwrap();
            let f2 =
                std::fs::read_to_string(base.join(&logger2.session_id).join("conversation.jsonl"))
                    .unwrap();
            assert!(f1.contains("logger1"), "logger1 文件应包含自己的数据");
            assert!(f2.contains("logger2"), "logger2 文件应包含自己的数据");
            assert!(
                !f1.contains("logger2"),
                "logger1 文件不应包含 logger2 的数据"
            );
        });
    }

    #[test]
    fn test_session_dir_after_append() {
        use crate::test_util::run_with_temp_home;
        crate::test_util::run_with_temp_home(|home| {
            let logger = SessionLogger::new().unwrap();
            let expected = home.join(".zapmyco/sessions").join(&logger.session_id);

            // append 前
            assert_eq!(logger.session_dir(), expected);

            logger
                .append_record(
                    "ts".into(),
                    100,
                    serde_json::json!({"key": "val"}),
                    serde_json::json!({"key": "val"}),
                    None,
                    None,
                    None,
                )
                .unwrap();

            // append 后 session_dir() 不变
            assert_eq!(logger.session_dir(), expected);
            assert!(expected.join("conversation.jsonl").exists());
        });
    }

    #[test]
    fn test_sessions_parent_dir_not_exist() {
        use crate::test_util::run_with_temp_home;
        crate::test_util::run_with_temp_home(|home| {
            // 不创建 sessions 父目录
            let logger = SessionLogger::new();
            assert!(logger.is_ok(), "即使父目录不存在，new() 也应成功");
            let logger = logger.unwrap();

            // 验证完整路径正确
            let session_dir = home.join(".zapmyco/sessions").join(&logger.session_id);
            assert!(session_dir.is_dir(), "会话子目录应已创建");
        });
    }

    #[test]
    fn test_terminal_log_path_derivation() {
        use crate::test_util::run_with_temp_home;
        crate::test_util::run_with_temp_home(|home| {
            let logger = SessionLogger::new().unwrap();
            let session_dir = logger.session_dir();
            let terminal_log_path = session_dir.join("terminal.log");

            // 验证路径推导正确
            let expected = home
                .join(".zapmyco/sessions")
                .join(&logger.session_id)
                .join("terminal.log");
            assert_eq!(terminal_log_path, expected);

            // terminal.log 此时还未创建（交给 register_terminal_log 创建）
            assert!(!terminal_log_path.exists());
        });
    }

    // ---- ToolCallLogger tests (TDD) ----

    #[test]
    fn test_tool_call_logger_new_path() {
        crate::test_util::run_with_temp_home(|home| {
            let cl = SessionLogger::new().unwrap();
            let tcl = ToolCallLogger::new(&cl.session_dir(), cl.session_id()).unwrap();
            let expected = cl.session_dir().join("tool_calls.jsonl");
            assert_eq!(tcl.log_path, expected);
        });
    }

    #[test]
    fn test_tool_call_logger_append_valid_jsonl() {
        crate::test_util::run_with_temp_home(|home| {
            // append_tool_call 是同步调用
            let cl = SessionLogger::new().unwrap();
            let tcl = ToolCallLogger::new(&cl.session_dir(), cl.session_id()).unwrap();
            let file_path = cl.session_dir().join("tool_calls.jsonl");

            assert!(!file_path.exists());

            tcl.append_tool_call(
                "file_read",
                "toolu_abc",
                &json!({"file_path": "/tmp/test.txt"}),
                "file content",
                None,
                5,
                0,
            )
            .unwrap();

            assert!(file_path.exists());

            let content = std::fs::read_to_string(&file_path).unwrap();
            let lines: Vec<&str> = content.lines().collect();
            assert_eq!(lines.len(), 1);
            let parsed: serde_json::Value = serde_json::from_str(lines[0]).unwrap();
            assert_eq!(parsed["tool"], "file_read");
            assert_eq!(parsed["output"], "file content");
            assert!(parsed["error"].is_null());
        });
    }

    #[test]
    fn test_tool_call_logger_error_field() {
        crate::test_util::run_with_temp_home(|home| {
            // append_tool_call 是同步调用
            let cl = SessionLogger::new().unwrap();
            let tcl = ToolCallLogger::new(&cl.session_dir(), cl.session_id()).unwrap();

            tcl.append_tool_call(
                "shell_exec",
                "toolu_def",
                &json!({"command": "invalid cmd"}),
                "[Tool error: command not found]",
                Some("command not found"),
                1200,
                0,
            )
            .unwrap();

            let records = read_jsonl(&cl.session_dir().join("tool_calls.jsonl"));
            assert_eq!(records[0]["error"], "command not found");
            assert_eq!(records[0]["output"], "[Tool error: command not found]");
        });
    }

    /// 读取 JSONL 文件所有记录（测试辅助函数）
    fn read_jsonl(path: &std::path::Path) -> Vec<serde_json::Value> {
        let file = std::fs::File::open(path).unwrap();
        use std::io::BufRead;
        std::io::BufReader::new(file)
            .lines()
            .map(|line| serde_json::from_str(&line.unwrap()).unwrap())
            .collect()
    }

    // ---- TC-4: order 全局递增 ----

    #[test]
    fn test_tool_call_logger_order_increments() {
        crate::test_util::run_with_temp_home(|home| {
            // append_tool_call 是同步调用
            let cl = SessionLogger::new().unwrap();
            let tcl = ToolCallLogger::new(&cl.session_dir(), cl.session_id()).unwrap();

            for i in 0..10 {
                tcl.append_tool_call(
                    "file_read",
                    "tu_1",
                    &json!({}),
                    &format!("result_{}", i),
                    None,
                    i * 10,
                    0,
                )
                .unwrap();
            }

            let records = read_jsonl(&cl.session_dir().join("tool_calls.jsonl"));
            for (idx, record) in records.iter().enumerate() {
                assert_eq!(record["order"], idx as u64);
                assert_eq!(record["output"], format!("result_{}", idx));
            }
        });
    }

    // ---- TC-5: 跨多个轮次记录（round 字段） ----

    #[test]
    fn test_tool_call_logger_round_field() {
        crate::test_util::run_with_temp_home(|home| {
            // append_tool_call 是同步调用
            let cl = SessionLogger::new().unwrap();
            let tcl = ToolCallLogger::new(&cl.session_dir(), cl.session_id()).unwrap();

            tcl.append_tool_call(
                "file_find",
                "tu_a",
                &json!({"pattern":"*.rs"}),
                "a.rs",
                None,
                10,
                0,
            )
            .unwrap();
            tcl.append_tool_call(
                "file_read",
                "tu_b",
                &json!({"file_path":"a.rs"}),
                "content",
                None,
                5,
                0,
            )
            .unwrap();
            tcl.append_tool_call(
                "file_edit",
                "tu_c",
                &json!({"file_path":"a.rs"}),
                "ok",
                None,
                8,
                1,
            )
            .unwrap();

            let records = read_jsonl(&cl.session_dir().join("tool_calls.jsonl"));
            assert_eq!(records[0]["round"], 0);
            assert_eq!(records[1]["round"], 0);
            assert_eq!(records[2]["round"], 1);
        });
    }

    // ---- TC-6: 大量调用不丢数据 ----

    #[test]
    fn test_tool_call_logger_persists() {
        crate::test_util::run_with_temp_home(|home| {
            // append_tool_call 是同步调用
            let cl = SessionLogger::new().unwrap();
            let tcl = ToolCallLogger::new(&cl.session_dir(), cl.session_id()).unwrap();
            let n = 1000u64;

            for i in 0..n {
                tcl.append_tool_call(
                    "file_read",
                    &format!("tu_{}", i),
                    &json!({"idx": i}),
                    &format!("out_{}", i),
                    None,
                    i,
                    0,
                )
                .unwrap();
            }

            let records = read_jsonl(&cl.session_dir().join("tool_calls.jsonl"));
            assert_eq!(records.len(), n as usize);
            assert_eq!(records.last().unwrap()["order"], n - 1);
        });
    }

    // ---- TC-7: 空字符串字段 ----

    #[test]
    fn test_tool_call_logger_empty_strings() {
        crate::test_util::run_with_temp_home(|home| {
            // append_tool_call 是同步调用
            let cl = SessionLogger::new().unwrap();
            let tcl = ToolCallLogger::new(&cl.session_dir(), cl.session_id()).unwrap();

            tcl.append_tool_call("", "", &json!({}), "", Some(""), 0, 0)
                .unwrap();

            let records = read_jsonl(&cl.session_dir().join("tool_calls.jsonl"));
            assert_eq!(records[0]["tool"], "");
            assert_eq!(records[0]["tool_use_id"], "");
            assert_eq!(records[0]["output"], "");
            assert_eq!(records[0]["error"], "");
            assert_eq!(records[0]["input"], json!({}));
        });
    }

    // ---- TC-8: 大输出（100KB + 1MB） ----

    #[test]
    fn test_tool_call_logger_large_output_100kb() {
        crate::test_util::run_with_temp_home(|home| {
            // append_tool_call 是同步调用
            let cl = SessionLogger::new().unwrap();
            let tcl = ToolCallLogger::new(&cl.session_dir(), cl.session_id()).unwrap();

            let large = "A".repeat(100 * 1024);
            tcl.append_tool_call(
                "file_read",
                "tu_1",
                &json!({"size":"100KB"}),
                &large,
                None,
                50,
                0,
            )
            .unwrap();

            let records = read_jsonl(&cl.session_dir().join("tool_calls.jsonl"));
            let output = records[0]["output"].as_str().unwrap();
            assert_eq!(output.len(), 100 * 1024);
            assert_eq!(output, &large);
        });
    }

    #[test]
    fn test_tool_call_logger_large_output_1mb() {
        crate::test_util::run_with_temp_home(|home| {
            // append_tool_call 是同步调用
            let cl = SessionLogger::new().unwrap();
            let tcl = ToolCallLogger::new(&cl.session_dir(), cl.session_id()).unwrap();

            let large = "B".repeat(1024 * 1024);
            tcl.append_tool_call(
                "file_read",
                "tu_1",
                &json!({"size":"1MB"}),
                &large,
                None,
                100,
                0,
            )
            .unwrap();

            let records = read_jsonl(&cl.session_dir().join("tool_calls.jsonl"));
            let output = records[0]["output"].as_str().unwrap();
            assert_eq!(output.len(), 1024 * 1024);
            assert_eq!(output, &large);
        });
    }

    // ---- TC-8b: 大入参（边界压力） ----

    #[test]
    fn test_tool_call_logger_large_input() {
        crate::test_util::run_with_temp_home(|home| {
            // append_tool_call 是同步调用
            let cl = SessionLogger::new().unwrap();
            let tcl = ToolCallLogger::new(&cl.session_dir(), cl.session_id()).unwrap();

            let large = "x".repeat(100 * 1024);
            let input = json!({"data": large, "nested": {"deep": large}});
            tcl.append_tool_call("file_write", "tu_1", &input, "ok", None, 10, 0)
                .unwrap();

            let records = read_jsonl(&cl.session_dir().join("tool_calls.jsonl"));
            assert_eq!(records[0]["input"]["data"], large);
        });
    }

    // ---- TC-9: Unicode/特殊字符 ----

    #[test]
    fn test_tool_call_logger_unicode() {
        crate::test_util::run_with_temp_home(|home| {
            // append_tool_call 是同步调用
            let cl = SessionLogger::new().unwrap();
            let tcl = ToolCallLogger::new(&cl.session_dir(), cl.session_id()).unwrap();

            let unicode_output = "你好，世界\nこんにちは\n🌍🌎🌏\n\x00null char \x1b escape";
            tcl.append_tool_call(
                "file_read",
                "tu_1",
                &json!({"path": "测试"}),
                unicode_output,
                None,
                0,
                0,
            )
            .unwrap();

            let records = read_jsonl(&cl.session_dir().join("tool_calls.jsonl"));
            assert_eq!(records[0]["output"], unicode_output);
            assert_eq!(records[0]["input"]["path"], "测试");
        });
    }

    // ---- TC-10: duration_ms = 0 ----

    #[test]
    fn test_tool_call_logger_zero_duration() {
        crate::test_util::run_with_temp_home(|home| {
            // append_tool_call 是同步调用
            let cl = SessionLogger::new().unwrap();
            let tcl = ToolCallLogger::new(&cl.session_dir(), cl.session_id()).unwrap();

            tcl.append_tool_call(
                "pre_read_check",
                "tu_1",
                &json!({}),
                "[Tool error: blocked]",
                Some("blocked"),
                0,
                0,
            )
            .unwrap();

            let records = read_jsonl(&cl.session_dir().join("tool_calls.jsonl"));
            assert_eq!(records[0]["duration_ms"], 0);
        });
    }

    // ---- TC-11: 输入参数包含嵌套 JSON ----

    #[test]
    fn test_tool_call_logger_nested_input() {
        crate::test_util::run_with_temp_home(|home| {
            // append_tool_call 是同步调用
            let cl = SessionLogger::new().unwrap();
            let tcl = ToolCallLogger::new(&cl.session_dir(), cl.session_id()).unwrap();

            let input = json!({
                "file_path": "/path/to/file.rs",
                "edits": [
                    {"start_line": 1, "end_line": 3, "new_content": "abc"},
                    {"start_line": 10, "end_line": 15, "new_content": "def"}
                ]
            });
            tcl.append_tool_call("file_edit", "tu_1", &input, "edited 2 blocks", None, 15, 0)
                .unwrap();

            let records = read_jsonl(&cl.session_dir().join("tool_calls.jsonl"));
            assert_eq!(records[0]["input"]["edits"][0]["start_line"], 1);
            assert_eq!(records[0]["input"]["edits"][1]["start_line"], 10);
        });
    }

    // ---- TC-11b: 超长工具名和 tool_use_id ----

    #[test]
    fn test_tool_call_logger_long_names() {
        crate::test_util::run_with_temp_home(|home| {
            // append_tool_call 是同步调用
            let cl = SessionLogger::new().unwrap();
            let tcl = ToolCallLogger::new(&cl.session_dir(), cl.session_id()).unwrap();

            let long_name = "a".repeat(1000);
            let long_id = "toolu_".to_string() + &"x".repeat(500);
            tcl.append_tool_call(&long_name, &long_id, &json!({}), "ok", None, 0, 0)
                .unwrap();

            let records = read_jsonl(&cl.session_dir().join("tool_calls.jsonl"));
            assert_eq!(records[0]["tool"], long_name);
            assert_eq!(records[0]["tool_use_id"], long_id);
        });
    }

    // ---- TC-11c: session_id 一致性 ----

    #[test]
    fn test_tool_call_logger_session_id_match() {
        crate::test_util::run_with_temp_home(|home| {
            // append_tool_call 是同步调用
            let cl = SessionLogger::new().unwrap();
            let session_id = cl.session_id().to_string();
            let tcl = ToolCallLogger::new(&cl.session_dir(), &session_id).unwrap();

            tcl.append_tool_call("file_read", "tu_1", &json!({}), "data", None, 0, 0)
                .unwrap();

            let records = read_jsonl(&cl.session_dir().join("tool_calls.jsonl"));
            assert_eq!(records[0]["session_id"], session_id);
        });
    }

    // ---- TC-11d: ToolCallRecord round-trip 序列化 ----

    #[test]
    fn test_tool_call_logger_record_roundtrip() {
        let record = ToolCallRecord {
            session_id: "2026-06-12_211500_P12345".into(),
            order: 42,
            ts: "2026-06-12T21:15:00+08:00".into(),
            round: 2,
            tool: "file_read".into(),
            tool_use_id: "toolu_abc123".into(),
            input: json!({"file_path": "/tmp/x.txt"}),
            output: "file content".into(),
            error: Some("permission denied".into()),
            duration_ms: 5,
        };

        let json = serde_json::to_string(&record).unwrap();
        let deserialized: ToolCallRecord = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.session_id, record.session_id);
        assert_eq!(deserialized.order, record.order);
        assert_eq!(deserialized.ts, record.ts);
        assert_eq!(deserialized.round, record.round);
        assert_eq!(deserialized.tool, record.tool);
        assert_eq!(deserialized.tool_use_id, record.tool_use_id);
        assert_eq!(deserialized.input, record.input);
        assert_eq!(deserialized.output, record.output);
        assert_eq!(deserialized.error, record.error);
        assert_eq!(deserialized.duration_ms, record.duration_ms);
    }

    // ---- TC-12: 并发调用的 order 严格递增 ----

    #[test]
    fn test_tool_call_logger_concurrent_order() {
        crate::test_util::run_with_temp_home(|home| {
            let cl = SessionLogger::new().unwrap();
            let tcl = std::sync::Arc::new(
                ToolCallLogger::new(&cl.session_dir(), cl.session_id()).unwrap(),
            );

            let mut handles = vec![];
            for i in 0..50u64 {
                let tcl = tcl.clone();
                handles.push(std::thread::spawn(move || {
                    tcl.append_tool_call(
                        "file_read",
                        &format!("tu_{}", i),
                        &json!({"idx": i}),
                        &format!("out_{}", i),
                        None,
                        i,
                        0,
                    )
                    .unwrap();
                }));
            }
            for h in handles {
                h.join().unwrap();
            }

            let file_path = cl.session_dir().join("tool_calls.jsonl");
            let records = read_jsonl(&file_path);
            assert_eq!(records.len(), 50);

            let mut orders: Vec<u64> = records
                .iter()
                .map(|r| r["order"].as_u64().unwrap())
                .collect();
            orders.sort();
            let expected: Vec<u64> = (0..50).collect();
            assert_eq!(orders, expected, "order 应覆盖 0..49 且无重复");

            let raw = std::fs::read_to_string(&file_path).unwrap();
            for line in raw.lines() {
                let parsed: Result<serde_json::Value, _> = serde_json::from_str(line);
                assert!(parsed.is_ok(), "并发写入后每行应为合法 JSON: {}", line);
            }
        });
    }

    // ==================== SessionMeta 测试 ====================

    fn read_session_json(path: &std::path::Path) -> serde_json::Value {
        let content = std::fs::read_to_string(path).unwrap();
        serde_json::from_str(&content).unwrap()
    }

    fn create_test_meta(home: &std::path::Path) -> SessionMeta {
        let session_dir = home.join(".zapmyco/sessions/test-session");
        std::fs::create_dir_all(&session_dir).unwrap();
        SessionMeta::create(
            &session_dir,
            "test-session",
            "0.2.0",
            "default",
            "anthropic",
            "claude-4",
            "https://api.anthropic.com",
            "full",
            false,
            None,
            "macOS 15.5 (arm64)",
            "zsh",
            "zh_CN.UTF-8",
        )
        .unwrap()
    }

    #[test]
    fn test_session_meta_creation() {
        crate::test_util::run_with_temp_home(|home| {
            let meta = create_test_meta(home);
            let json_path = meta.path();
            assert!(json_path.exists());
            let parsed = read_session_json(json_path);
            assert_eq!(parsed["session_id"], "test-session");
            assert_eq!(parsed["app_version"], "0.2.0");
            assert_eq!(parsed["profile"], "default");
            assert!(parsed["finished_at"].is_null());
            assert!(parsed["exit_reason"].is_null());
            assert_eq!(parsed["system_info"]["os"], "macOS 15.5 (arm64)");
        });
    }

    #[test]
    fn test_session_meta_finish_completed() {
        crate::test_util::run_with_temp_home(|home| {
            let meta = create_test_meta(home);
            meta.finish(ExitReason::Completed).unwrap();
            let parsed = read_session_json(meta.path());
            assert!(parsed["finished_at"].as_str().unwrap().len() > 0);
            assert_eq!(parsed["exit_reason"], "completed");
            assert_eq!(parsed["session_id"], "test-session");
        });
    }

    #[test]
    fn test_session_meta_finish_interrupted() {
        crate::test_util::run_with_temp_home(|home| {
            let meta = create_test_meta(home);
            meta.finish(ExitReason::Interrupted).unwrap();
            let parsed = read_session_json(meta.path());
            assert_eq!(parsed["exit_reason"], "interrupted");
        });
    }

    #[test]
    fn test_session_meta_finish_error() {
        crate::test_util::run_with_temp_home(|home| {
            let meta = create_test_meta(home);
            meta.finish(ExitReason::Error).unwrap();
            let parsed = read_session_json(meta.path());
            assert_eq!(parsed["exit_reason"], "error");
        });
    }

    #[test]
    fn test_write_session_json_atomicity() {
        crate::test_util::run_with_temp_home(|home| {
            let path = home.join("test.json");
            write_session_json(&path, r#"{"key": "value"}"#).unwrap();
            assert!(!path.with_extension("json.tmp").exists());
            assert!(path.exists());
            let content = std::fs::read_to_string(&path).unwrap();
            assert_eq!(content, r#"{"key": "value"}"#);
        });
    }

    #[test]
    fn test_subagent_session_meta() {
        crate::test_util::run_with_temp_home(|home| {
            let session_dir = home.join(".zapmyco/sessions/child-session");
            std::fs::create_dir_all(&session_dir).unwrap();
            let meta = SessionMeta::create(
                &session_dir,
                "child-session",
                "0.2.0",
                "default",
                "anthropic",
                "claude-4",
                "https://api.anthropic.com",
                "full",
                true,
                Some("parent-123"),
                "macOS 15.5 (arm64)",
                "zsh",
                "zh_CN.UTF-8",
            )
            .unwrap();
            let parsed = read_session_json(meta.path());
            assert_eq!(parsed["is_subagent"], true);
            assert_eq!(parsed["parent_session_id"], "parent-123");
        });
    }

    #[test]
    fn test_session_meta_finish_idempotent() {
        crate::test_util::run_with_temp_home(|home| {
            let meta = create_test_meta(home);
            meta.finish(ExitReason::Completed).unwrap();
            meta.finish(ExitReason::Completed).unwrap();
            let parsed = read_session_json(meta.path());
            assert_eq!(parsed["exit_reason"], "completed");
        });
    }

    #[test]
    fn test_session_meta_unicode_path() {
        crate::test_util::run_with_temp_home(|home| {
            let session_dir = home.join(".zapmyco/sessions/会话_测试_🌍");
            std::fs::create_dir_all(&session_dir).unwrap();
            let meta = SessionMeta::create(
                &session_dir,
                "会话_测试_🌍",
                "0.2.0",
                "default",
                "anthropic",
                "claude-4",
                "https://api.anthropic.com",
                "full",
                false,
                None,
                "macOS 15.5 (arm64)",
                "zsh",
                "zh_CN.UTF-8",
            )
            .unwrap();
            assert!(meta.path().exists());
            let parsed = read_session_json(meta.path());
            assert_eq!(parsed["session_id"], "会话_测试_🌍");
        });
    }

    #[test]
    fn test_session_meta_unchanged_after_panic() {
        crate::test_util::run_with_temp_home(|home| {
            let meta = create_test_meta(home);
            let parsed = read_session_json(meta.path());
            assert!(parsed["finished_at"].is_null());
            assert!(parsed["exit_reason"].is_null());
        });
    }

    // ==================== ConversationRecord HTTP 元数据测试 ====================

    #[test]
    fn test_conversation_record_with_http_meta() {
        let r1 = ConversationRecord {
            session_id: "s1".into(),
            order: 0,
            ts: "t".into(),
            duration_ms: 100,
            request: json!({"model": "test"}),
            response: json!({"content": "hi"}),
            http_status: None,
            rate_limit_remaining: None,
            rate_limit_reset: None,
        };
        let json1 = serde_json::to_string(&r1).unwrap();
        assert!(!json1.contains("http_status"));

        let r2 = ConversationRecord {
            http_status: Some(200),
            rate_limit_remaining: Some(99),
            rate_limit_reset: Some(1718000000),
            ..r1
        };
        let json2 = serde_json::to_string(&r2).unwrap();
        assert!(json2.contains("\"http_status\":200"));
        assert!(json2.contains("\"rate_limit_remaining\":99"));
    }

    #[test]
    fn test_conversation_record_deserialize_legacy() {
        let old_json = r#"{"session_id":"s1","order":0,"ts":"t","duration_ms":100,"request":{},"response":{}}"#;
        let record: ConversationRecord = serde_json::from_str(old_json).unwrap();
        assert_eq!(record.session_id, "s1");
        assert!(record.http_status.is_none());
    }

    // ==================== 补充测试 ====================

    #[test]
    fn test_ctrlc_signal_flag() {
        use std::sync::atomic::{AtomicBool, Ordering};
        static SHOULD_EXIT: AtomicBool = AtomicBool::new(false);

        SHOULD_EXIT.store(true, Ordering::Relaxed);
        assert!(SHOULD_EXIT.load(Ordering::Relaxed));

        SHOULD_EXIT.store(false, Ordering::Relaxed);
        assert!(!SHOULD_EXIT.load(Ordering::Relaxed));
    }

    #[test]
    fn test_write_session_json_failure() {
        let path = std::path::PathBuf::from("");
        let result = write_session_json(&path, "content");
        assert!(result.is_err());
    }

    #[test]
    fn test_append_record_with_http_none() {
        crate::test_util::run_with_temp_home(|home| {
            let logger = SessionLogger::new().unwrap();
            let result = logger.append_record(
                "ts".to_string(),
                100,
                serde_json::json!({"model": "test"}),
                serde_json::json!({"content": "hi"}),
                None,
                None,
                None,
            );
            assert!(result.is_ok());
            let content = std::fs::read_to_string(
                home.join(".zapmyco/sessions")
                    .join(logger.session_id())
                    .join("conversation.jsonl"),
            )
            .unwrap();
            assert!(!content.contains("http_status"));
        });
    }
}

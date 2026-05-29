/// 对话日志模块 — 将每次 LLM 调用的完整请求/响应记录到 ~/.zapmyco/conversations/
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

use chrono::Local;

const CONVERSATIONS_DIR: &str = "conversations";

/// 一条日志记录，对应 JSONL 中的一行
#[derive(Debug, Serialize)]
pub struct ConversationRecord {
    /// 会话 ID: YYMMDDHHMMSS-PID-NANOS
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
}

/// 对话日志写入器，每个会话创建一个实例
pub struct ConversationLogger {
    /// 当前会话的 .jsonl 文件路径
    log_path: PathBuf,
    /// 会话 ID
    session_id: String,
    /// round-trip 计数器
    order: AtomicU32,
}

impl ConversationLogger {
    /// 创建新的日志记录器
    ///
    /// 在 `~/.zapmyco/conversations/` 下创建一个独立的 jsonl 文件。
    /// 如果目录不存在会自动创建。
    pub fn new() -> Result<Self, String> {
        let session_id = generate_session_id();
        let log_dir = get_log_dir()?;
        std::fs::create_dir_all(&log_dir).map_err(|e| format!("创建日志目录失败: {}", e))?;

        let log_path = log_dir.join(format!("{}.jsonl", session_id));

        Ok(Self {
            log_path,
            session_id,
            order: AtomicU32::new(0),
        })
    }

    /// 追加一条日志记录到 jsonl 文件
    pub fn append_record(
        &self,
        ts: String,
        duration_ms: u64,
        request: serde_json::Value,
        response: serde_json::Value,
    ) -> Result<(), String> {
        let order = self.order.fetch_add(1, Ordering::SeqCst);

        let record = ConversationRecord {
            session_id: self.session_id.clone(),
            order,
            ts,
            duration_ms,
            request,
            response,
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
}

/// 获取日志目录路径: ~/.zapmyco/conversations/
fn get_log_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "无法获取用户 HOME 目录".to_string())?;

    Ok(PathBuf::from(home).join(format!(".zapmyco/{}", CONVERSATIONS_DIR)))
}

/// 生成会话 ID: YYMMDDHHMMSS-PID-NANOS
///
/// - YYMMDDHHMMSS: 当前时间的紧凑格式，可读性好
/// - PID: 进程 ID，区分不同进程
/// - NANOS: 纳秒尾数（6位），区分同进程内多次启动
fn generate_session_id() -> String {
    let now = Local::now();
    let ts = now.format("%y%m%d%H%M%S").to_string();
    let pid = std::process::id();
    let nanos_tail = now.timestamp_subsec_nanos() % 1_000_000;

    format!("{}-{}-{:06}", ts, pid, nanos_tail)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_generate_session_id_format() {
        let id = generate_session_id();
        // 格式: YYMMDDHHMMSS-PID-NANOS
        let parts: Vec<&str> = id.split('-').collect();
        assert_eq!(parts.len(), 3, "session_id 应有 3 段: {}", id);
        // 第一段是 12 位时间戳
        assert_eq!(parts[0].len(), 12, "时间戳部分应为 12 位: {}", parts[0]);
        // 第二段是 PID（长度可变）
        assert!(!parts[1].is_empty(), "PID 部分不应为空");
        assert!(
            parts[1].chars().all(|c| c.is_ascii_digit()),
            "PID 部分应全为数字: {}",
            parts[1]
        );
        // 第三段是 6 位纳秒
        assert_eq!(parts[2].len(), 6, "纳秒部分应为 6 位: {}", parts[2]);
    }

    #[test]
    fn test_session_id_changes_each_call() {
        let id1 = generate_session_id();
        let id2 = generate_session_id();
        // 极短时间内两次调用可能时间戳相同，但纳秒不同
        assert_ne!(id1, id2, "两次调用 session_id 应不同");
    }

    #[test]
    fn test_logger_new() {
        use crate::test_util::run_with_temp_home;
        run_with_temp_home(|_home| {
            let logger = ConversationLogger::new();
            assert!(logger.is_ok());
            let logger = logger.unwrap();
            // session_id 至少包含 12 位时间戳 + 1 位 PID + 6 位纳秒 + 2 个分隔符 = 21+
            assert!(
                logger.session_id.len() >= 21,
                "session_id 长度至少 21: {}",
                logger.session_id
            );
        });
    }

    #[test]
    fn test_logger_creates_file_on_append() {
        use crate::test_util::run_with_temp_home;
        run_with_temp_home(|home| {
            let logger = ConversationLogger::new().unwrap();
            let log_dir = home.join(".zapmyco/conversations");
            let expected_file = log_dir.join(format!("{}.jsonl", logger.session_id));

            // 文件还未创建（append 时才创建）
            assert!(!expected_file.exists());

            // 追加一条记录
            let result = logger.append_record(
                "2026-05-29T16:00:00Z".to_string(),
                1234,
                serde_json::json!({"model": "test"}),
                serde_json::json!({"content": "hello"}),
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
        run_with_temp_home(|home| {
            let logger = ConversationLogger::new().unwrap();

            logger
                .append_record(
                    "ts1".to_string(),
                    100,
                    json!({"msg": "req1"}),
                    json!({"msg": "resp1"}),
                )
                .unwrap();
            logger
                .append_record(
                    "ts2".to_string(),
                    200,
                    json!({"msg": "req2"}),
                    json!({"msg": "resp2"}),
                )
                .unwrap();

            let log_dir = home.join(".zapmyco/conversations");
            let content =
                std::fs::read_to_string(log_dir.join(format!("{}.jsonl", logger.session_id)))
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
    fn test_get_log_dir() {
        use crate::test_util::run_with_temp_home;
        run_with_temp_home(|home| {
            let dir = get_log_dir().unwrap();
            assert_eq!(dir, home.join(".zapmyco/conversations"));
        });
    }
}

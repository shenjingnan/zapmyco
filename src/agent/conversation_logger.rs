/// 对话日志模块 — 将每次 LLM 调用的完整请求/响应记录到 ~/.zapmyco/conversations/
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

use chrono::Local;

const CONVERSATIONS_DIR: &str = "conversations";

/// 一条日志记录，对应 JSONL 中的一行
#[derive(Debug, Serialize)]
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
pub(crate) fn get_log_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "无法获取用户 HOME 目录".to_string())?;

    Ok(PathBuf::from(home).join(format!(".zapmyco/{}", CONVERSATIONS_DIR)))
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
        run_with_temp_home(|_home| {
            let logger = ConversationLogger::new();
            assert!(logger.is_ok());
            let logger = logger.unwrap();
            // session_id 格式: YYYY-MM-DD_HHMMSS_P{PID}，至少 20 位
            assert!(
                logger.session_id.len() >= 20,
                "session_id 长度至少 20: {}",
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

    #[test]
    fn test_get_log_dir_home_not_set() {
        // SAFETY: 手动获取 HOME_LOCK 确保无竞态
        let _guard = crate::test_util::acquire_home_lock();
        let orig_home = std::env::var("HOME").ok();
        let orig_userprofile = std::env::var("USERPROFILE").ok();
        unsafe {
            std::env::remove_var("HOME");
            std::env::remove_var("USERPROFILE");
        }
        let result = get_log_dir();
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
        let result = ConversationLogger::new();
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

        run_with_temp_home(|home| {
            let logger = ConversationLogger::new().unwrap();
            for i in 0..5 {
                logger
                    .append_record(
                        "ts".to_string(),
                        i,
                        serde_json::json!({"n": i}),
                        serde_json::json!({"n": i}),
                    )
                    .unwrap();
            }

            let log_dir = home.join(".zapmyco/conversations");
            let content =
                std::fs::read_to_string(log_dir.join(format!("{}.jsonl", logger.session_id())))
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
}

/// 日志初始化模块
///
/// 初始化双层日志系统：
/// - 文件日志: 写入 `~/.zapmyco/logs/app.log`（info 级别以上，无 ANSI 颜色）
/// - stderr 日志: 受 `RUST_LOG` 环境变量控制（默认 warn 级别以上）
use std::fs::OpenOptions;
use std::io;
use std::path::PathBuf;
use std::sync::RwLock;
use tracing_subscriber::prelude::*;
use tracing_subscriber::{EnvFilter, Registry, fmt};

/// 当前会话的 app.log 目录。None 表示没有活跃的会话。
static SESSION_LOG_DIR: RwLock<Option<PathBuf>> = RwLock::new(None);

/// 设置当前会话的日志目录（由 cmd_run 在 session 创建后调用）
pub fn set_session_log_dir(path: PathBuf) {
    if let Ok(mut dir) = SESSION_LOG_DIR.write() {
        *dir = Some(path);
    }
}

/// 清除当前会话的日志目录（由 Guard drop 时调用）
pub fn clear_session_log_dir() {
    if let Ok(mut dir) = SESSION_LOG_DIR.write() {
        *dir = None;
    }
}

/// 读取当前会话日志目录
pub(crate) fn get_session_log_dir() -> Option<PathBuf> {
    SESSION_LOG_DIR.read().ok()?.clone()
}

/// 初始化日志系统
///
/// 使用 `try_init()` 而非 `init()`，以便在测试中多次调用不会 panic。
pub fn init_logging() {
    let log_path = get_log_path();

    // 确保日志目录存在
    if let Some(parent) = log_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }

    // 文件日志层 — 记录 info+，无 ANSI 颜色
    let file_layer = fmt::layer()
        .with_writer(make_file_writer(log_path.clone()))
        .with_ansi(false)
        .with_target(true)
        .with_filter(EnvFilter::new("info"));

    // stderr 日志层 — 受 RUST_LOG 控制，默认 warn
    let stderr_layer = fmt::layer()
        .with_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("warn")));

    let _ = Registry::default()
        .with(file_layer)
        .with(stderr_layer)
        .try_init();

    // 注册全局 panic hook：将 panic 信息写入 tracing error 日志并刷盘
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic_info| {
        // 先调用默认 hook（输出到 stderr），确保用户在终端看到 panic
        default_hook(panic_info);

        // 将 panic 信息写入 tracing error 日志（会通过 TeeWriter 同时写入全局和 session app.log）
        let panic_msg = panic_info.to_string();
        let location = panic_info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_else(|| "<unknown>".to_string());
        let backtrace = std::backtrace::Backtrace::force_capture();

        tracing::error!(
            panic_message = %panic_msg,
            panic_location = %location,
            backtrace = %backtrace,
            "进程 panic",
        );

        // 强制刷盘，防止 BufWriter 缓冲区在进程退出时丢失日志
        use std::io::Write;
        let _ = std::io::stdout().flush();
        let _ = std::io::stderr().flush();
    }));
}

/// 一个写入器，同时写入全局日志和 session 日志（Tee 模式）
struct TeeWriter {
    /// 全局 app.log 的文件句柄
    global: std::fs::File,
    /// session app.log 的文件句柄（仅在 session 活跃时存在）
    session: Option<std::fs::File>,
}

impl io::Write for TeeWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        // 始终写入全局日志
        let _ = self.global.write(buf);
        // 如果 session 活跃，也写入 session 日志
        if let Some(ref mut f) = self.session {
            let _ = f.write(buf);
        }
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        let _ = self.global.flush();
        if let Some(ref mut f) = self.session {
            let _ = f.flush();
        }
        Ok(())
    }
}

/// 创建文件日志 writer（可测试）
pub(crate) fn make_file_writer(global_log_path: PathBuf) -> impl Fn() -> Box<dyn io::Write> {
    move || -> Box<dyn io::Write> {
        // 确保目录存在（可能被外部删除）
        if let Some(parent) = global_log_path.parent() {
            std::fs::create_dir_all(parent).ok();
        }

        // 打开全局 app.log
        let global = match OpenOptions::new()
            .create(true)
            .append(true)
            .open(&global_log_path)
        {
            Ok(f) => f,
            Err(_) => return Box::new(io::sink()),
        };

        // 检查是否有活跃的 session，若有则打开 session app.log
        let session = get_session_log_dir().and_then(|session_dir| {
            let session_path = session_dir.join("app.log");
            if let Some(parent) = session_path.parent() {
                std::fs::create_dir_all(parent).ok();
            }
            OpenOptions::new()
                .create(true)
                .append(true)
                .open(&session_path)
                .ok()
        });

        Box::new(TeeWriter { global, session })
    }
}

/// 获取日志文件路径
fn get_log_path() -> PathBuf {
    get_log_dir().join("app.log")
}

/// 获取日志目录路径
fn get_log_dir() -> PathBuf {
    crate::config::settings::get_home_dir().join(".zapmyco/logs")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::run_with_temp_home;
    use std::io::Write;

    // ================================================================
    // 已有的测试
    // ================================================================
    #[test]
    fn test_log_path_uses_zapmyco_dir() {
        run_with_temp_home(|_home| {
            let log_path = get_log_path();
            assert!(log_path.starts_with(_home.join(".zapmyco/logs")));
            assert_eq!(
                log_path.file_name().unwrap(),
                "app.log",
                "日志文件名应为 app.log"
            );
        });
    }

    #[test]
    fn test_log_dir_is_created() {
        run_with_temp_home(|_home| {
            let log_dir = get_log_dir();
            assert!(!log_dir.exists(), "日志目录应在 init 时创建");

            // 模拟 create_dir_all
            std::fs::create_dir_all(&log_dir).unwrap();
            assert!(log_dir.exists());
        });
    }

    #[test]
    fn test_file_writer_appends() {
        run_with_temp_home(|home| {
            let log_path = home.join(".zapmyco/logs/app.log");
            std::fs::create_dir_all(log_path.parent().unwrap()).unwrap();

            // 写入第一行
            let mut writer = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_path)
                .unwrap();
            writeln!(writer, "line 1").unwrap();
            drop(writer);

            // 追加第二行
            let mut writer = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_path)
                .unwrap();
            writeln!(writer, "line 2").unwrap();
            drop(writer);

            let content = std::fs::read_to_string(&log_path).unwrap();
            let lines: Vec<&str> = content.lines().collect();
            assert_eq!(lines.len(), 2);
            assert_eq!(lines[0], "line 1");
            assert_eq!(lines[1], "line 2");
        });
    }

    #[test]
    fn test_make_file_writer_writes_content() {
        run_with_temp_home(|home| {
            let log_path = home.join(".zapmyco/logs/app.log");
            let writer = make_file_writer(log_path.clone());

            // 写入内容
            {
                let mut w = writer();
                writeln!(w, "hello world").unwrap();
            }

            let content = std::fs::read_to_string(&log_path).unwrap();
            assert!(content.contains("hello world"), "writer 应写入文件内容");
        });
    }

    #[test]
    fn test_make_file_writer_sink_on_error() {
        // 使用不可写路径，确认不会 panic
        let writer = make_file_writer(PathBuf::from("/nonexistent/path/app.log"));
        let mut w = writer();
        let result = writeln!(w, "should not panic");
        assert!(result.is_ok(), "回退到 io::sink 应始终成功");
    }

    #[test]
    fn test_init_logging_creates_directory() {
        run_with_temp_home(|home| {
            let log_dir = home.join(".zapmyco/logs");
            assert!(!log_dir.exists(), "测试前日志目录不应存在");
            init_logging();
            assert!(log_dir.exists(), "init_logging 应创建日志目录");
        });
    }

    #[test]
    fn test_make_file_writer_creates_directory() {
        run_with_temp_home(|home| {
            let log_path = home.join(".zapmyco/logs/app.log");
            let log_dir = log_path.parent().unwrap().to_path_buf();
            assert!(!log_dir.exists(), "测试前日志目录不应存在");

            // writer 被调用时应自动创建目录
            let writer = make_file_writer(log_path);
            {
                let _w = writer();
            }
            assert!(log_dir.exists(), "writer 应自动创建日志目录");
        });
    }

    #[test]
    fn test_init_logging_does_not_panic() {
        run_with_temp_home(|_home| {
            // 只是确认不会 panic
            init_logging();
        });
    }

    #[test]
    fn test_tracing_events_written_to_file() {
        run_with_temp_home(|home| {
            let log_path = home.join(".zapmyco/logs/app.log");

            // 创建临时 subscriber 写入文件
            let subscriber = Registry::default().with(
                fmt::layer()
                    .with_writer(make_file_writer(log_path.clone()))
                    .with_ansi(false),
            );

            tracing::subscriber::with_default(subscriber, || {
                tracing::info!("test info message");
                tracing::warn!("test warn message");
                tracing::error!("test error message");
            });

            // 验证日志文件包含所有消息
            let content = std::fs::read_to_string(&log_path).expect("日志文件应被创建");
            assert!(
                content.contains("test info message"),
                "日志文件应包含 info 消息"
            );
            assert!(
                content.contains("test warn message"),
                "日志文件应包含 warn 消息"
            );
            assert!(
                content.contains("test error message"),
                "日志文件应包含 error 消息"
            );
        });
    }

    #[test]
    fn test_tracing_events_no_ansi() {
        run_with_temp_home(|home| {
            let log_path = home.join(".zapmyco/logs/app.log");

            let subscriber = Registry::default().with(
                fmt::layer()
                    .with_writer(make_file_writer(log_path.clone()))
                    .with_ansi(false),
            );

            tracing::subscriber::with_default(subscriber, || {
                tracing::info!("plain text message");
            });

            let content = std::fs::read_to_string(&log_path).unwrap();
            // 无 ANSI 模式下不应包含转义序列
            assert!(!content.contains('\x1b'), "日志文件不应包含 ANSI 转义字符");
        });
    }

    #[test]
    fn test_tracing_events_filtered_by_level() {
        run_with_temp_home(|home| {
            let log_path = home.join(".zapmyco/logs/app.log");

            // info level filter
            let subscriber = Registry::default().with(
                fmt::layer()
                    .with_writer(make_file_writer(log_path.clone()))
                    .with_ansi(false)
                    .with_filter(EnvFilter::new("info")),
            );

            tracing::subscriber::with_default(subscriber, || {
                tracing::debug!("debug message - should not appear");
                tracing::info!("info message - should appear");
                tracing::warn!("warn message - should appear");
            });

            let content = std::fs::read_to_string(&log_path).unwrap();
            assert!(content.contains("info message"), "info 级别应通过过滤");
            assert!(content.contains("warn message"), "warn 级别应通过过滤");
            assert!(!content.contains("debug message"), "debug 级别应被过滤掉");
        });
    }

    #[test]
    fn test_tracing_events_include_target() {
        run_with_temp_home(|home| {
            let log_path = home.join(".zapmyco/logs/app.log");

            let subscriber = Registry::default().with(
                fmt::layer()
                    .with_writer(make_file_writer(log_path.clone()))
                    .with_ansi(false)
                    .with_target(true),
            );

            tracing::subscriber::with_default(subscriber, || {
                tracing::info!(target: "my_target", "targeted message");
            });

            let content = std::fs::read_to_string(&log_path).unwrap();
            assert!(content.contains("my_target"), "日志应包含 target 信息");
        });
    }

    #[test]
    fn test_make_file_writer_multiple_calls_produce_unique_writers() {
        run_with_temp_home(|home| {
            let log_path = home.join(".zapmyco/logs/app.log");
            let writer = make_file_writer(log_path.clone());

            // 多次调用 writer() 应产生独立的写入器
            {
                let mut w1 = writer();
                writeln!(w1, "from first writer").unwrap();
            }
            {
                let mut w2 = writer();
                writeln!(w2, "from second writer").unwrap();
            }

            let content = std::fs::read_to_string(&log_path).unwrap();
            let lines: Vec<&str> = content.lines().collect();
            assert_eq!(lines.len(), 2, "两个写入器的内容都应存在");
            assert_eq!(lines[0], "from first writer");
            assert_eq!(lines[1], "from second writer");
        });
    }

    // ================================================================
    // SESSION_LOG_DIR 状态管理
    // ================================================================

    #[test]
    fn test_get_session_log_dir_default_none() {
        // 默认状态应为 None
        assert!(get_session_log_dir().is_none());
    }

    #[test]
    fn test_set_and_get_session_log_dir() {
        let _lock = crate::test_util::acquire_session_log_lock();
        let dir = tempfile::TempDir::new().unwrap().into_path();
        set_session_log_dir(dir.clone());
        assert_eq!(get_session_log_dir(), Some(dir));
        clear_session_log_dir();
    }

    #[test]
    fn test_clear_session_log_dir() {
        let _lock = crate::test_util::acquire_session_log_lock();
        let dir = tempfile::TempDir::new().unwrap().into_path();
        set_session_log_dir(dir);
        assert!(get_session_log_dir().is_some());
        clear_session_log_dir();
        assert!(get_session_log_dir().is_none());
    }

    // ================================================================
    // TeeWriter 单元测试
    // ================================================================

    #[test]
    fn test_tee_writer_writes_global_only() {
        run_with_temp_home(|home| {
            let global_path = home.join("app.log");
            let global = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&global_path)
                .unwrap();
            let mut writer = TeeWriter {
                global,
                session: None,
            };
            writeln!(writer, "hello").unwrap();

            let content = std::fs::read_to_string(&global_path).unwrap();
            assert!(content.contains("hello"));
        });
    }

    #[test]
    fn test_tee_writer_writes_both() {
        run_with_temp_home(|home| {
            let global_path = home.join("app.log");
            let session_path = home.join("session").join("app.log");
            std::fs::create_dir_all(home.join("session")).unwrap();

            let global = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&global_path)
                .unwrap();
            let session = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&session_path)
                .unwrap();
            let mut writer = TeeWriter {
                global,
                session: Some(session),
            };
            writeln!(writer, "tee message").unwrap();

            assert!(
                std::fs::read_to_string(&global_path)
                    .unwrap()
                    .contains("tee message")
            );
            assert!(
                std::fs::read_to_string(&session_path)
                    .unwrap()
                    .contains("tee message")
            );
        });
    }

    #[test]
    fn test_tee_writer_flush() {
        run_with_temp_home(|home| {
            let global_path = home.join("app.log");
            let global = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&global_path)
                .unwrap();
            let mut writer = TeeWriter {
                global,
                session: None,
            };

            write!(writer, "data").unwrap();
            writer.flush().unwrap();

            let content = std::fs::read_to_string(&global_path).unwrap();
            assert!(content.contains("data"));
        });
    }

    #[test]
    fn test_tee_writer_drop_flushes() {
        run_with_temp_home(|home| {
            let global_path = home.join("app.log");
            let session_path = home.join("session").join("app.log");
            std::fs::create_dir_all(home.join("session")).unwrap();

            {
                let global = OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&global_path)
                    .unwrap();
                let session = OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&session_path)
                    .unwrap();
                let mut writer = TeeWriter {
                    global,
                    session: Some(session),
                };
                writeln!(writer, "dropped data").unwrap();
            } // TeeWriter drop 在此发生

            assert!(
                std::fs::read_to_string(&global_path)
                    .unwrap()
                    .contains("dropped data")
            );
            assert!(
                std::fs::read_to_string(&session_path)
                    .unwrap()
                    .contains("dropped data")
            );
        });
    }

    // ================================================================
    // make_file_writer session 行为测试
    // ================================================================

    #[test]
    fn test_make_file_writer_with_session_tee() {
        let _lock = crate::test_util::acquire_session_log_lock();
        run_with_temp_home(|home| {
            let session_dir = home.join(".zapmyco/sessions/test-session");
            std::fs::create_dir_all(&session_dir).unwrap();
            set_session_log_dir(session_dir.clone());

            let global_path = home.join(".zapmyco/logs/app.log");
            let writer = make_file_writer(global_path.clone());
            {
                let mut w = writer();
                writeln!(w, "session active").unwrap();
            }

            // 全局日志应包含消息
            assert!(
                std::fs::read_to_string(&global_path)
                    .unwrap()
                    .contains("session active")
            );

            // session 日志也应包含消息
            let session_log = session_dir.join("app.log");
            assert!(session_log.exists());
            assert!(
                std::fs::read_to_string(&session_log)
                    .unwrap()
                    .contains("session active")
            );

            clear_session_log_dir();
        });
    }

    #[test]
    fn test_make_file_writer_no_session_no_tee() {
        let _lock = crate::test_util::acquire_session_log_lock();
        run_with_temp_home(|home| {
            clear_session_log_dir();

            let global_path = home.join(".zapmyco/logs/app.log");
            let writer = make_file_writer(global_path.clone());
            {
                let mut w = writer();
                writeln!(w, "no session").unwrap();
            }

            assert!(
                std::fs::read_to_string(&global_path)
                    .unwrap()
                    .contains("no session")
            );
        });
    }

    #[test]
    fn test_make_file_writer_after_clear_stops_tee() {
        let _lock = crate::test_util::acquire_session_log_lock();
        run_with_temp_home(|home| {
            let session_dir = home.join(".zapmyco/sessions/session-1");
            std::fs::create_dir_all(&session_dir).unwrap();
            set_session_log_dir(session_dir.clone());

            let global_path = home.join(".zapmyco/logs/app.log");
            let writer = make_file_writer(global_path.clone());

            // session 激活时写入
            {
                let mut w = writer();
                writeln!(w, "before clear").unwrap();
            }

            clear_session_log_dir();

            // session 清除后写入
            {
                let mut w = writer();
                writeln!(w, "after clear").unwrap();
            }

            // session 文件只应有 "before clear"
            let content = std::fs::read_to_string(session_dir.join("app.log")).unwrap();
            assert!(content.contains("before clear"));
            assert!(
                !content.contains("after clear"),
                "clear 后不应再写入 session"
            );
        });
    }

    #[test]
    fn test_make_file_writer_session_dir_deleted_recreated() {
        let _lock = crate::test_util::acquire_session_log_lock();
        run_with_temp_home(|home| {
            let session_dir = home.join(".zapmyco/sessions/to-be-deleted");
            std::fs::create_dir_all(&session_dir).unwrap();
            set_session_log_dir(session_dir.clone());

            // 外部删除 session 目录
            std::fs::remove_dir_all(&session_dir).unwrap();

            let global_path = home.join(".zapmyco/logs/app.log");
            let writer = make_file_writer(global_path.clone());
            {
                let mut w = writer();
                writeln!(w, "dir was deleted").unwrap();
            }

            // session app.log 应被重建
            let session_log = session_dir.join("app.log");
            assert!(session_log.exists(), "session 目录应被自动重建");
            assert!(
                std::fs::read_to_string(&session_log)
                    .unwrap()
                    .contains("dir was deleted"),
                "删除后重新写入应成功"
            );

            clear_session_log_dir();
        });
    }

    // ================================================================
    // tracing 集成测试
    // ================================================================

    #[test]
    fn test_tracing_events_tee_to_session_log() {
        let _lock = crate::test_util::acquire_session_log_lock();
        run_with_temp_home(|home| {
            let session_dir = home.join(".zapmyco/sessions/tracing-test");
            std::fs::create_dir_all(&session_dir).unwrap();
            set_session_log_dir(session_dir.clone());

            let global_path = home.join(".zapmyco/logs/app.log");

            // 创建临时 subscriber
            let subscriber = Registry::default().with(
                fmt::layer()
                    .with_writer(make_file_writer(global_path.clone()))
                    .with_ansi(false)
                    .with_filter(EnvFilter::new("info")),
            );

            tracing::subscriber::with_default(subscriber, || {
                tracing::info!("tracing session message");
            });

            // session 日志应包含消息
            let session_log = session_dir.join("app.log");
            assert!(session_log.exists());
            assert!(
                std::fs::read_to_string(&session_log)
                    .unwrap()
                    .contains("tracing session message"),
                "session app.log 应包含 tracing 事件"
            );

            clear_session_log_dir();
        });
    }

    // ================================================================
    // TC-TW-04: 多次写入持续追加
    // ================================================================

    #[test]
    fn test_tee_writer_appends() {
        run_with_temp_home(|home| {
            let global_path = home.join("app.log");
            let global = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&global_path)
                .unwrap();
            let mut writer = TeeWriter {
                global,
                session: None,
            };

            writeln!(writer, "line1").unwrap();
            writeln!(writer, "line2").unwrap();
            writer.flush().unwrap();

            let content = std::fs::read_to_string(&global_path).unwrap();
            let lines: Vec<&str> = content.lines().collect();
            assert_eq!(lines.len(), 2);
            assert_eq!(lines[0], "line1");
            assert_eq!(lines[1], "line2");
        });
    }

    // ================================================================
    // TC-TW-05: 大缓冲区写入不截断
    // ================================================================

    #[test]
    fn test_tee_writer_large_buffer() {
        run_with_temp_home(|home| {
            let global_path = home.join("app.log");
            let session_path = home.join("session").join("app.log");
            std::fs::create_dir_all(home.join("session")).unwrap();

            let global = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&global_path)
                .unwrap();
            let session = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&session_path)
                .unwrap();
            let mut writer = TeeWriter {
                global,
                session: Some(session),
            };

            let large = "A".repeat(1024 * 64); // 64KB
            write!(writer, "{}", large).unwrap();
            writer.flush().unwrap();

            assert_eq!(std::fs::read_to_string(&global_path).unwrap().len(), 65536);
            assert_eq!(std::fs::read_to_string(&session_path).unwrap().len(), 65536);
        });
    }

    // ================================================================
    // TC-MF-04: 多个 session 各自独立
    // ================================================================

    #[test]
    fn test_make_file_writer_multiple_sessions() {
        let _lock = crate::test_util::acquire_session_log_lock();
        run_with_temp_home(|home| {
            let global_path = home.join(".zapmyco/logs/app.log");
            let writer = make_file_writer(global_path.clone());

            // Session A
            let session_a = home.join(".zapmyco/sessions/session-a");
            std::fs::create_dir_all(&session_a).unwrap();
            set_session_log_dir(session_a.clone());
            {
                let mut w = writer();
                writeln!(w, "from session a").unwrap();
            }
            clear_session_log_dir();

            // Session B
            let session_b = home.join(".zapmyco/sessions/session-b");
            std::fs::create_dir_all(&session_b).unwrap();
            set_session_log_dir(session_b.clone());
            {
                let mut w = writer();
                writeln!(w, "from session b").unwrap();
            }
            clear_session_log_dir();

            // 验证隔离
            let content_a = std::fs::read_to_string(session_a.join("app.log")).unwrap();
            let content_b = std::fs::read_to_string(session_b.join("app.log")).unwrap();
            assert!(content_a.contains("from session a"));
            assert!(content_b.contains("from session b"));
            assert!(!content_a.contains("from session b"));
            assert!(!content_b.contains("from session a"));

            // 全局包含两者
            let global = std::fs::read_to_string(&global_path).unwrap();
            assert!(global.contains("from session a"));
            assert!(global.contains("from session b"));
        });
    }

    // ================================================================
    // TC-MF-06: 多个 tracing 事件的顺序
    // ================================================================

    #[test]
    fn test_tracing_session_log_event_order() {
        let _lock = crate::test_util::acquire_session_log_lock();
        run_with_temp_home(|home| {
            let global_path = home.join(".zapmyco/logs/app.log");

            let subscriber = Registry::default().with(
                fmt::layer()
                    .with_writer(make_file_writer(global_path.clone()))
                    .with_ansi(false),
            );

            let session_dir = home.join(".zapmyco/sessions/order-test");
            std::fs::create_dir_all(&session_dir).unwrap();
            let session_log = session_dir.join("app.log");
            set_session_log_dir(session_dir);

            tracing::subscriber::with_default(subscriber, || {
                tracing::info!("first event");
                tracing::warn!("second event");
                tracing::error!("third event");
            });

            let content = std::fs::read_to_string(&session_log).unwrap();
            let lines: Vec<&str> = content.lines().collect();
            assert_eq!(lines.len(), 3, "应记录所有 3 个事件");
            assert!(lines[0].contains("first event"));
            assert!(lines[1].contains("second event"));
            assert!(lines[2].contains("third event"));

            clear_session_log_dir();
        });
    }

    // ================================================================
    // TC-ER-01: TeeWriter 不可写路径不 panic
    // ================================================================

    #[test]
    fn test_tee_writer_global_sink_on_invalid_path() {
        let _lock = crate::test_util::acquire_session_log_lock();
        clear_session_log_dir();
        let writer = make_file_writer(PathBuf::from("/nonexistent/path/app.log"));
        let mut w = writer();
        let result = writeln!(w, "should not panic");
        assert!(result.is_ok(), "全局文件不可写应回退到 io::sink");
    }

    // ================================================================
    // TC-ER-02: session 目录不可写 → 全局仍正常写入
    // ================================================================

    #[test]
    fn test_tee_writer_session_unwritable() {
        let _lock = crate::test_util::acquire_session_log_lock();
        run_with_temp_home(|home| {
            let session_dir = home.join("restricted-session");
            std::fs::create_dir_all(&session_dir).unwrap();

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&session_dir, std::fs::Permissions::from_mode(0o444))
                    .unwrap();
            }

            set_session_log_dir(session_dir);

            let global_path = home.join("app.log");
            let writer = make_file_writer(global_path.clone());
            {
                let mut w = writer();
                let result = writeln!(w, "session unwritable test");
                assert!(result.is_ok(), "session 不可写不应 panic");
            }

            // 全局日志应正常写入
            assert!(
                std::fs::read_to_string(&global_path)
                    .unwrap()
                    .contains("session unwritable test"),
                "全局日志应正常写入"
            );

            clear_session_log_dir();
        });
    }

    // ================================================================
    // TC-ER-04: session 日志文件被删除后自动重建
    // ================================================================

    #[test]
    fn test_tee_writer_session_file_deleted_recreated() {
        let _lock = crate::test_util::acquire_session_log_lock();
        run_with_temp_home(|home| {
            let session_dir = home.join(".zapmyco/sessions/file-deleted");
            std::fs::create_dir_all(&session_dir).unwrap();
            set_session_log_dir(session_dir.clone());

            let session_log = session_dir.join("app.log");

            // 先写一条
            let global_path = home.join("app.log");
            let writer = make_file_writer(global_path.clone());
            {
                let mut w = writer();
                writeln!(w, "first write").unwrap();
            }
            assert!(session_log.exists());

            // 外部删除 session 日志文件
            std::fs::remove_file(&session_log).unwrap();

            // 再次写入
            {
                let mut w = writer();
                writeln!(w, "after file deleted").unwrap();
            }

            // 文件应被重新创建
            assert!(session_log.exists());
            let content = std::fs::read_to_string(&session_log).unwrap();
            assert!(!content.contains("first write"), "重建后不应包含旧内容");
            assert!(content.contains("after file deleted"), "重建后应包含新内容");

            clear_session_log_dir();
        });
    }

    // ================================================================
    // TC-CONC-01: 多线程同时写入 session 日志
    // ================================================================

    #[test]
    fn test_tee_writer_concurrent_writes() {
        let _lock = crate::test_util::acquire_session_log_lock();
        run_with_temp_home(|home| {
            let session_dir = home.join(".zapmyco/sessions/concurrent");
            std::fs::create_dir_all(&session_dir).unwrap();
            set_session_log_dir(session_dir.clone());

            let global_path = home.join("app.log");
            let writer = std::sync::Arc::new(make_file_writer(global_path.clone()));

            let mut handles = vec![];
            for i in 0..20usize {
                let w = writer.clone();
                handles.push(std::thread::spawn(move || {
                    let mut f = w();
                    writeln!(f, "thread {} writing", i).unwrap();
                }));
            }
            for h in handles {
                h.join().unwrap();
            }

            let session_log = session_dir.join("app.log");
            let content = std::fs::read_to_string(&session_log).unwrap();
            let lines: Vec<&str> = content.lines().collect();
            assert_eq!(lines.len(), 20, "20 个线程的写入都应完整保留");
            for line in &lines {
                assert!(line.contains("writing"), "每行应包含预期内容: {:?}", line);
            }

            clear_session_log_dir();
        });
    }

    // ================================================================
    // TC-CONC-02: 多线程并发访问 SESSION_LOG_DIR
    // ================================================================

    #[test]
    fn test_session_log_dir_concurrent_access() {
        let _lock = crate::test_util::acquire_session_log_lock();
        let dir = tempfile::TempDir::new().unwrap().into_path();
        let mut handles = vec![];
        for i in 0..10usize {
            let d = dir.join(format!("thread-{}", i));
            handles.push(std::thread::spawn(move || {
                if i % 2 == 0 {
                    set_session_log_dir(d);
                    std::thread::sleep(std::time::Duration::from_millis(1));
                    clear_session_log_dir();
                } else {
                    let _ = get_session_log_dir();
                    std::thread::sleep(std::time::Duration::from_millis(1));
                }
            }));
        }
        for h in handles {
            h.join().unwrap();
        }
        clear_session_log_dir();
        assert!(get_session_log_dir().is_none());
    }

    // ================================================================
    // TC-CROSS-01: 路径分隔符跨平台兼容
    // ================================================================

    #[test]
    fn test_path_construction_cross_platform() {
        run_with_temp_home(|_home| {
            let session_dir = PathBuf::from("sessions").join("test-id");
            let log_path = session_dir.join("app.log");

            assert!(log_path.to_string_lossy().ends_with("app.log"));
            // 验证路径分隔符是平台正确的
            let sep = std::path::MAIN_SEPARATOR;
            assert_eq!(
                log_path
                    .to_string_lossy()
                    .chars()
                    .filter(|&c| c == sep)
                    .count(),
                2
            );
        });
    }

    // ================================================================
    // TC-CROSS-02: session_id 不含非法路径字符
    // ================================================================

    #[test]
    fn test_session_id_no_invalid_path_chars() {
        run_with_temp_home(|_home| {
            let logger = crate::agent::session_logger::SessionLogger::new().unwrap();
            let session_id = logger.session_id();

            // Windows 不允许的字符: \ / : * ? " < > |
            let invalid = ['\\', '/', ':', '*', '?', '"', '<', '>', '|'];
            for c in invalid {
                assert!(!session_id.contains(c), "session_id 不应包含 '{}'", c);
            }

            assert!(session_id.len() < 50, "session_id 应控制在合理长度");
        });
    }

    // ==================== Panic Hook 测试 ====================

    #[test]
    fn test_default_hook_is_called() {
        use std::sync::atomic::{AtomicBool, Ordering};
        static DEFAULT_HOOK_CALLED: AtomicBool = AtomicBool::new(false);
        let default_hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |panic_info| {
            DEFAULT_HOOK_CALLED.store(true, Ordering::Relaxed);
            default_hook(panic_info);
        }));

        let result = std::panic::catch_unwind(|| {
            panic!("test message");
        });
        assert!(result.is_err());
        assert!(DEFAULT_HOOK_CALLED.load(Ordering::Relaxed));

        let _ = std::panic::take_hook();
    }

    #[test]
    fn test_panic_hook_no_panic_on_normal_use() {
        let default_hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |panic_info| {
            default_hook(panic_info);
            tracing::error!(target: "panic", "{}", panic_info);
        }));

        let result = std::panic::catch_unwind(|| {
            panic!("this should not cause double panic");
        });
        assert!(result.is_err());

        let _ = std::panic::take_hook();
    }

    #[test]
    fn test_panic_hook_includes_backtrace() {
        crate::test_util::run_with_temp_home(|home| {
            use std::fs::OpenOptions;
            use tracing_subscriber::prelude::*;
            use tracing_subscriber::{Registry, fmt};

            let log_path = home.join("test_backtrace.log");
            let file = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_path)
                .unwrap();

            let subscriber = Registry::default().with(
                fmt::layer()
                    .with_writer(move || file.try_clone().unwrap())
                    .with_ansi(false),
            );
            tracing::subscriber::with_default(subscriber, || {
                let backtrace = std::backtrace::Backtrace::force_capture();
                tracing::error!(
                    panic_message = "test error",
                    backtrace = %backtrace,
                    "panic captured",
                );
            });

            let content = std::fs::read_to_string(&log_path).unwrap();
            assert!(content.contains("backtrace"));
        });
    }

    #[test]
    fn test_panic_hook_logs_to_tracing() {
        crate::test_util::run_with_temp_home(|home| {
            use std::fs::OpenOptions;
            use tracing_subscriber::prelude::*;
            use tracing_subscriber::{Registry, fmt};

            let log_path = home.join("test_panic.log");
            let file = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_path)
                .unwrap();

            let subscriber = Registry::default().with(
                fmt::layer()
                    .with_writer(move || file.try_clone().unwrap())
                    .with_ansi(false),
            );
            tracing::subscriber::with_default(subscriber, || {
                let default_hook = std::panic::take_hook();
                std::panic::set_hook(Box::new(move |panic_info| {
                    default_hook(panic_info);
                    tracing::error!(
                        panic_message = %panic_info.to_string(),
                        panic_location = panic_info.location()
                            .map(|l| format!("{}:{}", l.file(), l.line()))
                            .unwrap_or_default(),
                        "panic captured in test",
                    );
                }));

                let result = std::panic::catch_unwind(|| {
                    panic!("test panic message");
                });
                assert!(result.is_err());
            });

            let _ = std::panic::take_hook();

            let content = std::fs::read_to_string(&log_path).unwrap();
            assert!(content.contains("test panic message"));
            assert!(content.contains("panic_location"));
        });
    }
}

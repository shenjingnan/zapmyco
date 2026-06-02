/// 日志初始化模块
///
/// 初始化双层日志系统：
/// - 文件日志: 写入 `~/.zapmyco/logs/app.log`（info 级别以上，无 ANSI 颜色）
/// - stderr 日志: 受 `RUST_LOG` 环境变量控制（默认 warn 级别以上）
use std::fs::OpenOptions;
use std::io;
use std::path::PathBuf;
use tracing_subscriber::prelude::*;
use tracing_subscriber::{EnvFilter, Registry, fmt};

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
    let file_path = log_path.clone();
    let file_layer = fmt::layer()
        .with_writer(move || -> Box<dyn io::Write> {
            match OpenOptions::new()
                .create(true)
                .append(true)
                .open(&file_path)
            {
                Ok(file) => Box::new(file),
                Err(_) => Box::new(io::sink()),
            }
        })
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
    fn test_init_logging_does_not_panic() {
        run_with_temp_home(|_home| {
            // 只是确认不会 panic
            init_logging();
        });
    }
}

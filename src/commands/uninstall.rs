use std::io::IsTerminal;

use crate::commands::completion::remove_shell_completion;
use crate::config::settings;
use crate::output::{self, Message};

/// uninstall 命令 — 卸载 zapmyco
pub(crate) fn cmd_uninstall() -> Result<(), String> {
    let home = settings::get_home_dir();
    let zapmyco_dir = settings::get_settings_dir();
    let exe_path = std::env::current_exe().ok();
    let receipt_dir = home.join(".config/zapmyco");
    let has_receipt = receipt_dir.exists();
    let has_zapmyco_dir = zapmyco_dir.exists();

    if !std::io::stdin().is_terminal() {
        return execute_uninstall(
            &receipt_dir,
            &zapmyco_dir,
            has_receipt,
            true,
            exe_path.as_deref(),
            &home,
        );
    }

    // Phase 1: 确认阶段
    let want_keep_zapmyco = if has_zapmyco_dir {
        match inquire::Confirm::new("是否保留记忆和配置？")
            .with_default(true)
            .prompt()
        {
            Ok(val) => val,
            Err(_) => {
                output::send(&Message::result(String::new()));
                output::send(&Message::result("谢，不删之恩~ 🥹".to_string()));
                return Ok(());
            }
        }
    } else {
        true
    };

    let confirmed = match inquire::Confirm::new("是否确认卸载？")
        .with_default(true)
        .prompt()
    {
        Ok(val) => val,
        Err(_) => {
            output::send(&Message::result(String::new()));
            output::send(&Message::result("谢，不删之恩~ 🥹".to_string()));
            return Ok(());
        }
    };

    if !confirmed {
        output::send(&Message::result(String::new()));
        output::send(&Message::result("谢，不删之恩~ 🥹".to_string()));
        return Ok(());
    }

    // Phase 2: 执行阶段
    execute_uninstall(
        &receipt_dir,
        &zapmyco_dir,
        has_receipt,
        want_keep_zapmyco,
        exe_path.as_deref(),
        &home,
    )
}

/// 执行卸载清理（不含用户交互，可测试）
pub(crate) fn execute_uninstall(
    receipt_dir: &std::path::Path,
    zapmyco_dir: &std::path::Path,
    has_receipt: bool,
    want_keep_zapmyco: bool,
    exe_path: Option<&std::path::Path>,
    home: &std::path::Path,
) -> Result<(), String> {
    const RED: &str = "\x1b[31m";
    const RESET: &str = "\x1b[0m";

    remove_shell_completion(home);

    if has_receipt && let Err(e) = std::fs::remove_dir_all(receipt_dir) {
        output::send(&Message::info(format!(
            "  {RED}✗{RESET} 删除安装收据失败: {}",
            e
        )));
    }

    if !want_keep_zapmyco && let Err(e) = std::fs::remove_dir_all(zapmyco_dir) {
        output::send(&Message::info(format!(
            "  {RED}✗{RESET} 删除 {} 失败: {}",
            zapmyco_dir.display(),
            e
        )));
    }

    #[cfg(not(windows))]
    if let Some(path) = exe_path
        && let Err(e) = std::fs::remove_file(path)
    {
        output::send(&Message::info(format!(
            "  {RED}✗{RESET} 删除二进制文件失败: {}",
            e
        )));
    }

    #[cfg(windows)]
    if let Some(path) = exe_path {
        output::send(&Message::result(format!(
            "请手动删除二进制文件: {}",
            path.display()
        )));
    }

    output::send(&Message::result(String::new()));
    output::send(&Message::result("有缘再见~ 👋".to_string()));

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::run_with_temp_home;

    #[test]
    fn test_uninstall_clean_state() {
        run_with_temp_home(|_home| {
            let result = cmd_uninstall();
            assert!(result.is_ok());
        });
    }

    #[test]
    fn test_uninstall_receipt_only() {
        run_with_temp_home(|home| {
            let receipt_dir = home.join(".config/zapmyco");
            std::fs::create_dir_all(&receipt_dir).unwrap();
            std::fs::write(
                receipt_dir.join("zapmyco-receipt.json"),
                r#"{"version":"0.22.20"}"#,
            )
            .unwrap();

            assert!(receipt_dir.exists());
            let result = cmd_uninstall();
            assert!(result.is_ok());
            assert!(!receipt_dir.exists(), "收据目录应被删除");
        });
    }

    #[test]
    fn test_execute_clean_state() {
        run_with_temp_home(|home| {
            let result = execute_uninstall(
                &home.join(".config/zapmyco"),
                &home.join(".zapmyco"),
                false,
                true,
                None,
                home,
            );
            assert!(result.is_ok());
        });
    }

    #[test]
    fn test_execute_receipt_only() {
        run_with_temp_home(|home| {
            let receipt_dir = home.join(".config/zapmyco");
            std::fs::create_dir_all(&receipt_dir).unwrap();
            std::fs::write(receipt_dir.join("receipt.json"), r#"{"version":"0.22.20"}"#).unwrap();

            let result =
                execute_uninstall(&receipt_dir, &home.join(".zapmyco"), true, true, None, home);
            assert!(result.is_ok());
            assert!(!receipt_dir.exists(), "收据目录应该被删除");
        });
    }

    #[test]
    fn test_execute_remove_zapmyco_dir() {
        run_with_temp_home(|home| {
            let zapmyco_dir = home.join(".zapmyco");
            std::fs::create_dir_all(&zapmyco_dir).unwrap();
            std::fs::write(zapmyco_dir.join("settings.toml"), "").unwrap();

            let result = execute_uninstall(
                &home.join(".config/zapmyco"),
                &zapmyco_dir,
                false,
                false,
                None,
                home,
            );
            assert!(result.is_ok());
            assert!(!zapmyco_dir.exists(), "~/.zapmyco/ 应该被删除");
        });
    }

    #[test]
    fn test_execute_binary_deletion_error() {
        run_with_temp_home(|home| {
            let result = execute_uninstall(
                &home.join(".config/zapmyco"),
                &home.join(".zapmyco"),
                false,
                true,
                Some(&home.join("nonexistent/zapmyco")),
                home,
            );
            assert!(result.is_ok());
        });
    }

    #[test]
    fn test_execute_binary_successful_deletion() {
        run_with_temp_home(|home| {
            let binary = home.join("zapmyco");
            std::fs::write(&binary, "fake binary").unwrap();
            std::fs::create_dir_all(home.join(".zapmyco")).unwrap();
            std::fs::write(home.join(".zapmyco/settings.toml"), "").unwrap();

            let result = execute_uninstall(
                &home.join(".config/zapmyco"),
                &home.join(".zapmyco"),
                false,
                true,
                Some(&binary),
                home,
            );
            assert!(result.is_ok());
            assert!(!binary.exists(), "二进制文件应被删除");
        });
    }

    #[test]
    fn test_execute_receipt_delete_error() {
        run_with_temp_home(|home| {
            // 收据路径存在但不可读/删除 — 不 panic 即可
            let result = execute_uninstall(
                &home.join("nonexistent"),
                &home.join(".zapmyco"),
                true,
                true,
                None,
                home,
            );
            assert!(result.is_ok());
        });
    }
}

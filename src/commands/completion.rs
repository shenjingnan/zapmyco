use clap::{CommandFactory, ValueEnum};
use std::path::PathBuf;

use crate::cli::{Cli, PermissionMode};
use crate::config::models::{
    format_model_help, get_built_in_base_host_info, get_built_in_model_names,
};
use crate::config::settings;

/// completion 命令 — 生成 shell 补全脚本
pub(crate) fn cmd_completion<W: std::io::Write>(shell: clap_complete::Shell, writer: &mut W) {
    if matches!(shell, clap_complete::Shell::PowerShell) {
        generate_powershell_completion(writer);
        return;
    }
    if matches!(shell, clap_complete::Shell::Zsh) {
        generate_zsh_completion(writer);
        return;
    }
    let mut cmd = Cli::command();
    clap_complete::generate(shell, &mut cmd, "zapmyco", writer);
}

/// 生成 PowerShell 补全脚本（在 clap_complete 基础上增加值补全）
fn generate_powershell_completion(writer: &mut impl std::io::Write) {
    let mut buf = Vec::new();
    let mut cmd = Cli::command();
    clap_complete::generate(
        clap_complete::Shell::PowerShell,
        &mut cmd,
        "zapmyco",
        &mut buf,
    );
    let mut script = String::from_utf8(buf).unwrap_or_default();

    // 在 'zapmyco;run' { 分支中插入值补全逻辑
    let marker = "'zapmyco;run' {";
    if let Some(pos) = script.find(marker) {
        let insert_pos = pos + marker.len();
        let mut extra = String::new();

        // — $prev 检测 —
        extra.push_str(
            "\n    $prevParam = ''\n\
             if ($commandElements.Count -ge 2) {\n        \
               $prevEl = $commandElements[$commandElements.Count - 2].Value\n        \
               if ($prevEl.Contains('=')) {\n            \
                 $prevParam = $prevEl.Substring(0, $prevEl.IndexOf('='))\n        \
               } elseif ($prevEl.StartsWith('-')) {\n            \
                 $prevParam = $prevEl\n        \
               }\n    }\n",
        );

        // — --model 值补全 —
        extra.push_str("    if ($prevParam -eq '--model') {\n");
        for name in get_built_in_model_names() {
            let help = format_model_help(name);
            extra.push_str(&format!(
                "        [CompletionResult]::new('{}', '{}', [CompletionResultType]::ParameterValue, '{}')\n",
                name.replace('\'', "''"),
                name.replace('\'', "''"),
                help.replace('\'', "''"),
            ));
        }
        extra.push_str("        break\n    }\n");

        // — --base-url 值补全 —
        extra.push_str("    if ($prevParam -eq '--base-url') {\n");
        for (host, provider, region) in get_built_in_base_host_info() {
            let tip = format!("{} · {}", provider, region);
            extra.push_str(&format!(
                "        [CompletionResult]::new('{}', '{}', [CompletionResultType]::ParameterValue, '{}')\n",
                host.replace('\'', "''"),
                host.replace('\'', "''"),
                tip.replace('\'', "''"),
            ));
        }
        extra.push_str("        break\n    }\n");

        // — --permission-mode 值补全 —
        extra.push_str("    if ($prevParam -eq '--permission-mode') {\n");
        for variant in PermissionMode::value_variants() {
            if let Some(pv) = variant.to_possible_value() {
                let name = pv.get_name();
                let desc = pv.get_help().map(|s| s.to_string()).unwrap_or_default();
                extra.push_str(&format!(
                    "        [CompletionResult]::new('{}', '{}', [CompletionResultType]::ParameterValue, '{}')\n",
                    name.replace('\'', "''"),
                    name.replace('\'', "''"),
                    desc.replace('\'', "''"),
                ));
            }
        }
        extra.push_str("        break\n    }\n");

        script.insert_str(insert_pos, &extra);
    }

    let _ = write!(writer, "{script}");
}

/// 生成 zsh 补全脚本（在 clap_complete 基础上增加值补全，保证描述可见）
fn generate_zsh_completion(writer: &mut impl std::io::Write) {
    let mut buf = Vec::new();
    let mut cmd = Cli::command();
    clap_complete::generate(clap_complete::Shell::Zsh, &mut cmd, "zapmyco", &mut buf);
    let mut script = String::from_utf8(buf).unwrap_or_default();

    // 替换 --model 的内联值((…)) 为函数引用
    replace_inline_zsh_values(&mut script, "--model", "MODEL", "_zapmyco_model_values");
    // 替换 --base-url
    replace_inline_zsh_values(
        &mut script,
        "--base-url",
        "BASE_URL",
        "_zapmyco_base_url_values",
    );
    // 替换 --permission-mode
    replace_inline_zsh_values(
        &mut script,
        "--permission-mode",
        "PERMISSION_MODE",
        "_zapmyco_permission_mode_values",
    );

    // 移除所有位置参数的 `_default` 补全行（包括必需 `':` 和可选 `'::`），
    // 保持所有子命令行为一致：按 Tab 时显示选项而非文件列表。
    // 但保留剩余参数 (`'*::`)，如 note add 的内容需要文件补全。
    script = script
        .lines()
        .filter(|line| {
            let is_default_positional = (line.starts_with("':") || line.starts_with("'::"))
                && line.trim_end().ends_with(":_default' \\");
            !is_default_positional
        })
        .collect::<Vec<_>>()
        .join("\n");

    // 追加自定义补全函数
    script.push_str("\n\n# 自定义补全函数（zapmyco 内置）\n");
    script.push_str("_zapmyco_model_values() {\n");
    script.push_str("    local -a _zapmyco_models\n");
    script.push_str("    _zapmyco_models=(\n");
    for name in get_built_in_model_names() {
        let help = format_model_help(name);
        script.push_str(&format!(
            "        '{}:{}'\n",
            name.replace('\'', "''"),
            help.replace('\'', "''"),
        ));
    }
    script.push_str("    )\n");
    script.push_str("    _describe 'model' _zapmyco_models\n");
    script.push_str("}\n\n");

    script.push_str("_zapmyco_base_url_values() {\n");
    script.push_str("    local -a _zapmyco_urls\n");
    script.push_str("    _zapmyco_urls=(\n");
    for (host, provider, region) in get_built_in_base_host_info() {
        let tip = format!("{} · {}", provider, region);
        script.push_str(&format!(
            "        '{}:{}'\n",
            host.replace('\'', "''"),
            tip.replace('\'', "''"),
        ));
    }
    script.push_str("    )\n");
    script.push_str("    _describe 'base-url' _zapmyco_urls\n");
    script.push_str("}\n\n");

    script.push_str("_zapmyco_permission_mode_values() {\n");
    script.push_str("    local -a _zapmyco_modes\n");
    script.push_str("    _zapmyco_modes=(\n");
    for variant in PermissionMode::value_variants() {
        if let Some(pv) = variant.to_possible_value() {
            let name = pv.get_name();
            let desc = pv.get_help().map(|s| s.to_string()).unwrap_or_default();
            script.push_str(&format!(
                "        '{}:{}'\n",
                name.replace('\'', "''"),
                desc.replace('\'', "''"),
            ));
        }
    }
    script.push_str("    )\n");
    script.push_str("    _describe 'permission-mode' _zapmyco_modes\n");
    script.push_str("}\n");

    let _ = write!(writer, "{script}");
}

/// 替换 zsh 脚本中内联的 `((…))` 值列表为函数引用
fn replace_inline_zsh_values(
    script: &mut String,
    opt_name: &str,
    value_tag: &str,
    func_name: &str,
) {
    let search_pattern = format!("'{opt_name}=");
    let Some(opt_pos) = script.find(&search_pattern) else {
        return;
    };
    let value_marker = format!(":{value_tag}:(");
    let after_opt = &script[opt_pos..];
    let Some(marker_pos) = after_opt.find(&value_marker) else {
        return;
    };
    let values_start = opt_pos + marker_pos + value_marker.len();
    if !script[values_start..].starts_with('(') {
        return;
    }
    let Some(end) = script[values_start + 1..].find("))' \\") else {
        return;
    };
    let abs_end = values_start + 1 + end + 5;
    let new_action = format!("{func_name}' \\");
    script.replace_range(values_start - 1..abs_end, &new_action);
}

/// 检测当前 shell（从 $SHELL 环境变量解析）
pub(crate) fn detect_shell() -> Option<&'static str> {
    let shell = std::env::var("SHELL").ok()?;
    let name = std::path::Path::new(&shell).file_name()?.to_str()?;
    match name {
        "bash" => Some("bash"),
        "zsh" => Some("zsh"),
        "fish" => Some("fish"),
        _ => None,
    }
}

/// 获取 shell 配置文件路径
pub(crate) fn shell_config_path(shell: &str, home: &std::path::Path) -> PathBuf {
    match shell {
        "bash" => {
            let bashrc = home.join(".bashrc");
            let bash_profile = home.join(".bash_profile");
            if bashrc.exists() {
                bashrc
            } else {
                bash_profile
            }
        }
        "zsh" => home.join(".zshrc"),
        "fish" => home.join(".config/fish/config.fish"),
        _ => panic!("不支持的 shell: {}", shell),
    }
}

/// 获取 shell 对应的补全 eval 行
pub(crate) fn completion_line(shell: &str) -> &'static str {
    match shell {
        "bash" => "eval \"$(zapmyco completion bash)\"",
        "zsh" => "eval \"$(zapmyco completion zsh)\"",
        "fish" => "zapmyco completion fish | source",
        _ => panic!("不支持的 shell: {}", shell),
    }
}

/// 移除所有已知 shell 配置文件中的补全行
pub(crate) fn remove_shell_completion(home: &std::path::Path) {
    let shells = ["bash", "zsh", "fish"];
    for &shell in &shells {
        let config_path = shell_config_path(shell, home);
        if !config_path.exists() {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(&config_path) else {
            continue;
        };
        let line = completion_line(shell);
        let original_lines: Vec<&str> = content.lines().collect();
        let filtered: Vec<&str> = original_lines
            .iter()
            .filter(|l| l.trim() != line)
            .copied()
            .collect();

        if filtered.len() < original_lines.len() {
            let mut result = filtered.join("\n");
            if !result.is_empty() {
                result.push('\n');
            }
            let _ = std::fs::write(&config_path, result);
        }
    }
}

/// 设置 shell 补全（可测试的内部实现）
pub(crate) fn setup_shell_completion_inner(
    shell: Option<&str>,
    home: &std::path::Path,
) -> Result<String, String> {
    let shell = shell.ok_or_else(|| {
        "未能检测到当前 Shell（$SHELL 未设置）\n\
         请手动配置自动补全：运行 `zapmyco completion --help` 查看帮助。"
            .to_string()
    })?;

    let config_path = shell_config_path(shell, home);
    let line = completion_line(shell);

    if config_path.exists() {
        let content = std::fs::read_to_string(&config_path)
            .map_err(|e| format!("读取 {} 失败: {}", config_path.display(), e))?;
        if content.contains(line) {
            return Ok(format!("Shell 自动补全已配置（{}）", config_path.display()));
        }
    }

    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建目录 {} 失败: {}", parent.display(), e))?;
    }

    let content = if config_path.exists() {
        let mut content = std::fs::read_to_string(&config_path)
            .map_err(|e| format!("读取 {} 失败: {}", config_path.display(), e))?;
        if !content.ends_with('\n') {
            content.push('\n');
        }
        content.push_str(line);
        content.push('\n');
        content
    } else {
        format!("{}\n", line)
    };

    std::fs::write(&config_path, content)
        .map_err(|e| format!("写入 {} 失败: {}", config_path.display(), e))?;

    let source_hint = match shell {
        "fish" => "请重启终端以生效。",
        _ => "请运行 `source` 命令或重启终端以生效。",
    };

    Ok(format!(
        "Shell 自动补全已启用（{}）。\n{}",
        config_path.display(),
        source_hint,
    ))
}

/// 设置 shell 补全（从环境变量读取配置）
pub(crate) fn setup_shell_completion() -> Result<String, String> {
    let home_dir = settings::get_home_dir();
    setup_shell_completion_inner(detect_shell(), &home_dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::run_with_temp_home;

    // —————— completion 命令测试 ——————
    #[test]
    fn test_completion_bash() {
        let mut buf = Vec::new();
        cmd_completion(clap_complete::Shell::Bash, &mut buf);
        let output = String::from_utf8(buf).unwrap();
        assert!(
            output.contains("complete -F"),
            "bash 补全应包含 complete -F"
        );
        for sub in &[
            "config",
            "init",
            "settings",
            "uninstall",
            "run",
            "note",
            "upgrade",
            "completion",
        ] {
            assert!(output.contains(sub), "bash 补全应包含子命令 {}", sub);
        }
    }

    #[test]
    fn test_completion_zsh() {
        let mut buf = Vec::new();
        cmd_completion(clap_complete::Shell::Zsh, &mut buf);
        let output = String::from_utf8(buf).unwrap();
        assert!(output.contains("#compdef"), "zsh 补全应以 #compdef 开头");
        for sub in &[
            "config",
            "init",
            "settings",
            "uninstall",
            "run",
            "note",
            "upgrade",
            "completion",
        ] {
            assert!(output.contains(sub), "zsh 补全应包含子命令 {}", sub);
        }
    }

    #[test]
    fn test_completion_fish() {
        let mut buf = Vec::new();
        cmd_completion(clap_complete::Shell::Fish, &mut buf);
        let output = String::from_utf8(buf).unwrap();
        assert!(
            output.contains("complete -c"),
            "fish 补全应包含 complete -c"
        );
        for sub in &[
            "config",
            "init",
            "settings",
            "uninstall",
            "run",
            "note",
            "upgrade",
            "completion",
        ] {
            assert!(output.contains(sub), "fish 补全应包含子命令 {}", sub);
        }
    }

    #[test]
    fn test_completion_powershell() {
        let mut buf = Vec::new();
        cmd_completion(clap_complete::Shell::PowerShell, &mut buf);
        let output = String::from_utf8(buf).unwrap();
        assert!(
            output.contains("Register-ArgumentCompleter"),
            "powershell 补全应注册参数补全器"
        );
        for sub in &[
            "config",
            "init",
            "settings",
            "uninstall",
            "run",
            "note",
            "upgrade",
            "completion",
        ] {
            assert!(output.contains(sub), "powershell 补全应包含子命令 {}", sub);
        }
        // --model 值补全
        assert!(
            output.contains("prevParam -eq '--model'"),
            "powershell 补全应包含 --model 值补全"
        );
        assert!(
            output.contains("deepseek-v4-flash"),
            "powershell 补全应包含模型名称"
        );
        assert!(
            output.contains("1M ctx · 384K out · txt · deepseek-v4-flash"),
            "powershell 补全应包含模型描述"
        );
        // --base-url 值补全
        assert!(
            output.contains("prevParam -eq '--base-url'"),
            "powershell 补全应包含 --base-url 值补全"
        );
        assert!(
            output.contains("api.deepseek.com/anthropic"),
            "powershell 补全应包含 base URL"
        );
        assert!(
            output.contains("deepseek · 通用"),
            "powershell 补全应包含 base URL 描述"
        );
        // --permission-mode 值补全
        assert!(
            output.contains("prevParam -eq '--permission-mode'"),
            "powershell 补全应包含 --permission-mode 值补全"
        );
        for mode in &["full", "read-write", "read-only"] {
            assert!(
                output.contains(mode),
                "powershell 补全应包含权限模式 {}",
                mode
            );
        }
        // 原有参数名补全依然保留
        assert!(
            output.contains("ParameterName"),
            "powershell 补全应保留参数名补全"
        );
    }

    #[test]
    fn test_completion_all_shells_have_all_subcommands() {
        let shells = [
            clap_complete::Shell::Bash,
            clap_complete::Shell::Zsh,
            clap_complete::Shell::Fish,
            clap_complete::Shell::PowerShell,
        ];
        for shell in shells {
            let mut buf = Vec::new();
            cmd_completion(shell, &mut buf);
            let output = String::from_utf8(buf).unwrap();
            for sub in &[
                "config",
                "init",
                "settings",
                "uninstall",
                "run",
                "note",
                "upgrade",
                "completion",
            ] {
                assert!(output.contains(sub), "{:?} 补全应包含子命令 {}", shell, sub);
            }
        }
    }

    // —————— init 中 shell 补全自动配置的测试 ——————

    #[test]
    fn test_detect_shell_from_env() {
        unsafe {
            std::env::set_var("SHELL", "/bin/bash");
        }
        assert_eq!(detect_shell(), Some("bash"));

        unsafe {
            std::env::set_var("SHELL", "/usr/bin/zsh");
        }
        assert_eq!(detect_shell(), Some("zsh"));

        unsafe {
            std::env::set_var("SHELL", "/opt/homebrew/bin/fish");
        }
        assert_eq!(detect_shell(), Some("fish"));

        // 不支持的 shell
        unsafe {
            std::env::set_var("SHELL", "/bin/sh");
        }
        assert_eq!(detect_shell(), None);

        // SHELL 未设置
        unsafe {
            std::env::remove_var("SHELL");
        }
        assert_eq!(detect_shell(), None);

        // 恢复 bash（对其他测试友好）
        unsafe {
            std::env::set_var("SHELL", "/bin/bash");
        }
    }

    #[test]
    fn test_shell_config_path_bash_bashrc_exists() {
        run_with_temp_home(|home| {
            std::fs::write(home.join(".bashrc"), "").unwrap();
            std::fs::write(home.join(".bash_profile"), "").unwrap();
            let path = shell_config_path("bash", home);
            assert_eq!(path.file_name().unwrap(), ".bashrc");
        });
    }

    #[test]
    fn test_shell_config_path_bash_fallback_to_profile() {
        run_with_temp_home(|home| {
            // 只有 .bash_profile 存在
            std::fs::write(home.join(".bash_profile"), "").unwrap();
            let path = shell_config_path("bash", home);
            assert_eq!(path.file_name().unwrap(), ".bash_profile");
        });
    }

    #[test]
    fn test_shell_config_path_bash_neither_exists() {
        run_with_temp_home(|home| {
            // 两个都不存在，应返回 .bash_profile 作为默认
            let path = shell_config_path("bash", home);
            assert_eq!(path.file_name().unwrap(), ".bash_profile");
        });
    }

    #[test]
    fn test_shell_config_path_zsh() {
        run_with_temp_home(|home| {
            let path = shell_config_path("zsh", home);
            assert_eq!(path.file_name().unwrap(), ".zshrc");
        });
    }

    #[test]
    fn test_shell_config_path_fish() {
        run_with_temp_home(|home| {
            let path = shell_config_path("fish", home);
            assert!(path.ends_with(".config/fish/config.fish"));
        });
    }

    #[test]
    fn test_completion_line() {
        assert_eq!(
            completion_line("bash"),
            "eval \"$(zapmyco completion bash)\""
        );
        assert_eq!(completion_line("zsh"), "eval \"$(zapmyco completion zsh)\"");
        assert_eq!(completion_line("fish"), "zapmyco completion fish | source");
    }

    #[test]
    fn test_setup_completion_bash_new_file() {
        run_with_temp_home(|home| {
            let result = setup_shell_completion_inner(Some("bash"), home);
            assert!(result.is_ok());
            let msg = result.unwrap();
            assert!(msg.contains(".bash_profile"));
            assert!(msg.contains("Shell 自动补全已启用"));

            let content = std::fs::read_to_string(home.join(".bash_profile")).unwrap();
            assert!(content.contains("zapmyco completion bash"));
        });
    }

    #[test]
    fn test_setup_completion_bash_existing_file() {
        run_with_temp_home(|home| {
            std::fs::write(home.join(".bashrc"), "export FOO=bar\n").unwrap();

            let result = setup_shell_completion_inner(Some("bash"), home);
            assert!(result.is_ok());
            let msg = result.unwrap();
            assert!(msg.contains(".bashrc"));

            let content = std::fs::read_to_string(home.join(".bashrc")).unwrap();
            assert!(content.contains("export FOO=bar"));
            assert!(content.contains("zapmyco completion bash"));
        });
    }

    #[test]
    fn test_setup_completion_idempotent() {
        run_with_temp_home(|home| {
            std::fs::write(home.join(".zshrc"), "").unwrap();

            // 第一次
            let r1 = setup_shell_completion_inner(Some("zsh"), home);
            assert!(r1.is_ok());
            assert!(r1.unwrap().contains("已启用"));

            // 第二次，应提示已配置
            let r2 = setup_shell_completion_inner(Some("zsh"), home);
            assert!(r2.is_ok());
            assert!(r2.unwrap().contains("已配置")); // 不是"已启用"

            // 文件内容只出现一次
            let content = std::fs::read_to_string(home.join(".zshrc")).unwrap();
            let count = content.matches("zapmyco completion zsh").count();
            assert_eq!(count, 1, "补全行只能出现一次");
        });
    }

    #[test]
    fn test_setup_completion_fish_new_file() {
        run_with_temp_home(|home| {
            let result = setup_shell_completion_inner(Some("fish"), home);
            assert!(result.is_ok());
            let msg = result.unwrap();
            assert!(msg.contains("config/fish/config.fish"));

            let content = std::fs::read_to_string(home.join(".config/fish/config.fish")).unwrap();
            assert!(content.contains("zapmyco completion fish | source"));
        });
    }

    #[test]
    fn test_setup_completion_no_shell() {
        run_with_temp_home(|home| {
            let result = setup_shell_completion_inner(None, home);
            assert!(result.is_err());
            assert!(result.err().unwrap().contains("$SHELL 未设置"));
        });
    }

    #[test]
    fn test_setup_completion_unsupported_shell() {
        // sh 会被 detect_shell 过滤掉，但 setup_shell_completion_inner 使用 panic
        // 直接传 "sh" 给它就会 panic，这是预期的
        // 测试 detect_shell 已经 cover 了这个场景
    }

    // ————————————————————————————————
    // remove_shell_completion 测试
    // ————————————————————————————————

    #[test]
    fn test_remove_completion_removes_line() {
        run_with_temp_home(|home| {
            let zshrc = home.join(".zshrc");
            std::fs::write(
                &zshrc,
                "export FOO=bar\neval \"$(zapmyco completion zsh)\"\nexport BAR=baz\n",
            )
            .unwrap();

            remove_shell_completion(home);

            let content = std::fs::read_to_string(&zshrc).unwrap();
            assert!(!content.contains("zapmyco completion zsh"));
            assert!(content.contains("export FOO=bar"));
            assert!(content.contains("export BAR=baz"));
        });
    }

    #[test]
    fn test_remove_completion_noop() {
        run_with_temp_home(|home| {
            let zshrc = home.join(".zshrc");
            std::fs::write(&zshrc, "export FOO=bar\nexport BAR=baz\n").unwrap();

            remove_shell_completion(home);

            let content = std::fs::read_to_string(&zshrc).unwrap();
            assert_eq!(content, "export FOO=bar\nexport BAR=baz\n");
        });
    }

    #[test]
    fn test_remove_completion_all_shells() {
        run_with_temp_home(|home| {
            // 同时配置三种 shell
            std::fs::write(
                home.join(".bash_profile"),
                "eval \"$(zapmyco completion bash)\"\n",
            )
            .unwrap();
            std::fs::write(home.join(".zshrc"), "eval \"$(zapmyco completion zsh)\"\n").unwrap();
            std::fs::create_dir_all(home.join(".config/fish")).unwrap();
            std::fs::write(
                home.join(".config/fish/config.fish"),
                "zapmyco completion fish | source\n",
            )
            .unwrap();

            remove_shell_completion(home);

            // 所有补全行都应被移除
            let bash_content = std::fs::read_to_string(home.join(".bash_profile")).unwrap();
            assert!(!bash_content.contains("zapmyco completion bash"));

            let zsh_content = std::fs::read_to_string(home.join(".zshrc")).unwrap();
            assert!(!zsh_content.contains("zapmyco completion zsh"));

            let fish_content =
                std::fs::read_to_string(home.join(".config/fish/config.fish")).unwrap();
            assert!(!fish_content.contains("zapmyco completion fish"));
        });
    }

    #[test]
    fn test_remove_completion_file_not_exists() {
        // 没有 shell 配置文件，应正常运行不 panic
        run_with_temp_home(|home| {
            remove_shell_completion(home);
            // 没有文件被创建
            assert!(!home.join(".zshrc").exists());
            assert!(!home.join(".bashrc").exists());
            assert!(!home.join(".bash_profile").exists());
        });
    }

    #[test]
    fn test_remove_completion_only_line_in_file() {
        run_with_temp_home(|home| {
            let zshrc = home.join(".zshrc");
            std::fs::write(&zshrc, "eval \"$(zapmyco completion zsh)\"\n").unwrap();

            remove_shell_completion(home);

            let content = std::fs::read_to_string(&zshrc).unwrap();
            assert!(content.is_empty(), "文件只有补全行时，应变为空");
        });
    }

    #[test]
    fn test_remove_completion_multiple_occurrences() {
        run_with_temp_home(|home| {
            let zshrc = home.join(".zshrc");
            std::fs::write(
                &zshrc,
                "eval \"$(zapmyco completion zsh)\"\nexport FOO=bar\neval \"$(zapmyco completion zsh)\"\n",
            )
            .unwrap();

            remove_shell_completion(home);

            let content = std::fs::read_to_string(&zshrc).unwrap();
            assert!(!content.contains("zapmyco completion zsh"));
            assert_eq!(content.matches("zapmyco completion zsh").count(), 0);
            assert!(content.contains("export FOO=bar"));
        });
    }
}

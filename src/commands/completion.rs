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

    // 移除所有必需位置参数 (`':xxx -- desc:_default' \`) 的补全行，
    // 保持所有子命令行为一致：按 Tab 时显示选项而非文件列表。
    // 跳过可选参数 (`'::`) 和剩余参数 (`'*::`)。
    script = script
        .lines()
        .filter(|line| {
            !line.starts_with("':")
                || line.starts_with("'::")
                || line.starts_with("'*::")
                || !line.trim_end().ends_with(":_default' \\")
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

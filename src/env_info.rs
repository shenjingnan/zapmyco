/// 环境信息采集模块
///
/// 用于收集系统环境信息（操作系统、Shell、语言区域、可用命令行工具等），
/// 注入到系统提示词中，帮助 AI 理解用户的工作环境。
use std::sync::OnceLock;

/// 要检测的命令行工具列表：(名称, 分组)
const TOOL_CHECKS: &[(&str, &str)] = &[
    // 包管理器
    ("brew", "包管理器"),
    ("apt", "包管理器"),
    ("choco", "包管理器"),
    ("cargo", "包管理器"),
    ("npm", "包管理器"),
    ("pip3", "包管理器"),
    // 运行时
    ("python3", "运行时"),
    ("node", "运行时"),
    ("go", "运行时"),
    ("rustc", "运行时"),
    ("java", "运行时"),
    // 容器
    ("docker", "容器"),
    // 编辑器
    ("vim", "编辑器"),
    ("nano", "编辑器"),
    ("code", "编辑器"),
];

/// 缓存工具检测结果
static TOOL_CACHE: OnceLock<Vec<(&'static str, &'static str)>> = OnceLock::new();

/// 获取操作系统信息
///
/// 返回格式：`macOS 15.5 (arm64)` / `Linux 6.8.0-48-generic (x86_64)` / `Windows 10.0.22631 (x86_64)`
pub fn os_info() -> String {
    let os_name = match std::env::consts::OS {
        "linux" => "Linux",
        "macos" => "macOS",
        "windows" => "Windows",
        other => other,
    };
    let arch = std::env::consts::ARCH;

    // 尝试获取版本号（静默失败）
    let version = get_os_version();

    if let Some(ver) = version {
        format!("{} {} ({})", os_name, ver, arch)
    } else {
        format!("{} ({})", os_name, arch)
    }
}

/// 获取 OS 版本号
fn get_os_version() -> Option<String> {
    let (cmd, args) = match std::env::consts::OS {
        "macos" => ("sw_vers", ["-productVersion"].as_slice()),
        "linux" => ("uname", ["-r"].as_slice()),
        "windows" => ("cmd", ["/c", "ver"].as_slice()),
        _ => return None,
    };

    let output = std::process::Command::new(cmd)
        .args(args)
        .output()
        .ok()
        .filter(|o| o.status.success())?;

    let text = String::from_utf8_lossy(&output.stdout);
    let text = text.trim();

    if text.is_empty() {
        return None;
    }

    // Windows ver 输出格式: "Microsoft Windows [版本 10.0.22631.1]" → "10.0.22631"
    if std::env::consts::OS == "windows" {
        let cleaned = text
            .split(['[', ']'])
            .nth(1)
            .and_then(|s| s.strip_prefix("版本 "))
            .or_else(|| {
                text.split(['[', ']'])
                    .nth(1)
                    .and_then(|s| s.split_whitespace().find(|part| part.contains('.')))
            })
            .map(|s| s.trim().to_string());

        return cleaned;
    }

    Some(text.to_string())
}

/// 获取当前 Shell 名称
///
/// macOS/Linux: 从 `$SHELL` 环境变量获取
/// Windows: 从 `%ComSpec%` 环境变量获取
pub fn shell_name() -> String {
    // Unix: $SHELL → /bin/zsh → zsh
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(shell) = std::env::var("SHELL")
            && let Some(name) = shell.rsplit('/').next()
            && !name.is_empty()
        {
            return name.to_string();
        }
    }

    // Windows: %ComSpec% → C:\Windows\system32\cmd.exe → cmd
    #[cfg(target_os = "windows")]
    {
        if let Ok(comspec) = std::env::var("ComSpec") {
            if let Some(name) = comspec.rsplit(['\\', '/']).next() {
                let name = name.strip_suffix(".exe").unwrap_or(name);
                if !name.is_empty() {
                    return name.to_string();
                }
            }
        }
        // 尝试检测 PowerShell
        if check_tool_impl("pwsh") {
            return "pwsh".to_string();
        }
    }

    String::new()
}

/// 获取语言/区域设置
///
/// 从 `$LANG` 或 `$LC_ALL` 环境变量读取。
/// 注：Windows 通常不设置这些变量，返回空字符串。
pub fn locale_info() -> String {
    std::env::var("LANG")
        .or_else(|_| std::env::var("LC_ALL"))
        .unwrap_or_default()
}

/// 检测指定命令行工具是否可用
///
/// macOS/Linux: `which <name>`
/// Windows: `where.exe <name>`
fn check_tool_impl(name: &str) -> bool {
    let (cmd, args) = if cfg!(target_os = "windows") {
        ("where.exe", [name])
    } else {
        ("which", [name])
    };

    std::process::Command::new(cmd)
        .arg(args[0])
        .output()
        .ok()
        .is_some_and(|o| o.status.success())
}

/// 获取已知可用的命令行工具列表（按分组输出）
///
/// 结果会被缓存，仅首次调用时实际执行检测命令。
/// 返回格式示例：
/// ```text
/// 包管理器：brew, cargo, npm
/// 运行时：python3, node, rustc
/// ```
pub fn available_tools() -> String {
    let found = TOOL_CACHE.get_or_init(|| {
        TOOL_CHECKS
            .iter()
            .filter(|(name, _)| check_tool_impl(name))
            .copied()
            .collect()
    });

    if found.is_empty() {
        return String::new();
    }

    // 按分组整理
    let mut groups: Vec<(&str, Vec<&str>)> = Vec::new();
    for &(name, group) in found {
        if let Some((_, names)) = groups.iter_mut().rev().find(|(g, _)| *g == group) {
            names.push(name);
        } else {
            groups.push((group, vec![name]));
        }
    }

    groups
        .into_iter()
        .map(|(group, names)| format!("{}：{}", group, names.join(", ")))
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_os_info_not_empty() {
        let info = os_info();
        assert!(!info.is_empty(), "os_info() 应返回非空字符串");
        // 应包含 OS 类型
        let has_os = ["Linux", "macOS", "Windows"]
            .iter()
            .any(|&os| info.contains(os));
        assert!(has_os, "os_info() 应包含操作系统名称: {}", info);
    }

    #[test]
    fn test_os_info_contains_arch() {
        let info = os_info();
        let has_arch = ["x86_64", "aarch64", "arm64", "x86", "i386", "i686"]
            .iter()
            .any(|&a| info.contains(a));
        assert!(has_arch, "os_info() 应包含架构信息: {}", info);
    }

    #[test]
    fn test_shell_name() {
        let shell = shell_name();
        // 在 CI 中可能没有设置 $SHELL，此时返回空是允许的
        if !shell.is_empty() {
            let known_shells = ["zsh", "bash", "sh", "fish", "dash", "ksh", "cmd", "pwsh"];
            assert!(
                known_shells.contains(&shell.as_str()),
                "shell_name() 返回了未知 shell: {}",
                shell
            );
        }
    }

    #[test]
    fn test_locale_info() {
        // locale 可能为空（如 Windows），也可能有值
        // 只要不 panic 即可
        let _locale = locale_info();
    }

    #[test]
    fn test_check_tool_rustc() {
        // rustc 应该在 Rust 开发环境中可用
        assert!(check_tool_impl("rustc"), "rustc 应该可用");
    }

    #[test]
    fn test_check_tool_nonexistent() {
        // 一个不可能存在的工具
        assert!(
            !check_tool_impl("this-tool-does-not-exist-12345"),
            "不存在的工具应返回 false"
        );
    }

    #[test]
    fn test_available_tools_format() {
        let tools = available_tools();
        // 至少应该包含 rustc
        assert!(!tools.is_empty(), "available_tools() 不应为空");
        assert!(
            tools.contains("rustc"),
            "available_tools() 应包含 rustc: {}",
            tools
        );
        // 格式应包含分组名称
        assert!(
            tools.contains("：") || tools.contains(":"),
            "available_tools() 应包含分组分隔符: {}",
            tools
        );
    }

    #[test]
    fn test_os_version_format() {
        let version = get_os_version();
        // version 可能为 None（比如在不支持的平台上），也可能有值
        // 如果有值，应该非空
        if let Some(v) = version {
            assert!(!v.is_empty(), "版本号不应为空");
        }
    }

    #[test]
    fn test_os_info_contains_parentheses() {
        let info = os_info();
        // 应该包含括号包裹的架构信息: "macOS 15.5 (arm64)"
        assert!(
            info.contains('(') && info.contains(')'),
            "os_info() 应包含括号: {}",
            info
        );
    }
}

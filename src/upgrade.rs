//! zapmyco 自升级模块
//!
//! 通过 GitHub Releases API 获取最新版本，下载并替换当前二进制文件。

use std::cmp::Ordering;
use std::path::{Path, PathBuf};
use std::process::Command;

/// 执行升级流程
pub async fn cmd_upgrade() -> Result<(), String> {
    let current_version = env!("CARGO_PKG_VERSION");
    let latest_version = get_latest_version().await?;

    if !is_newer(&latest_version, current_version) {
        println!("✅ 当前已是最新版本 (v{})", current_version);
        return Ok(());
    }

    println!(
        "⬇️  发现新版本 v{} (当前 v{})",
        latest_version, current_version
    );
    println!("正在下载...");

    let target_triple = detect_target_triple()?;

    // 准备临时目录
    let tmp_dir = std::env::temp_dir().join(format!("zapmyco_upgrade_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp_dir);
    std::fs::create_dir_all(&tmp_dir).map_err(|e| format!("创建临时目录失败: {}", e))?;

    // 执行升级步骤，最后清理临时目录
    let result = perform_upgrade(&latest_version, target_triple, &tmp_dir).await;
    let _ = std::fs::remove_dir_all(&tmp_dir);

    result
}

/// 实际的升级步骤
async fn perform_upgrade(version: &str, triple: &str, tmp_dir: &Path) -> Result<(), String> {
    // 1. 下载归档
    let archive_ext = if cfg!(windows) { "zip" } else { "tar.xz" };
    let archive_name = format!("zapmyco-{}.{}", triple, archive_ext);
    let download_url = format!(
        "https://github.com/shenjingnan/zapmyco/releases/download/v{}/{}",
        version, archive_name,
    );

    let archive_path = tmp_dir.join(&archive_name);
    download_file(&download_url, &archive_path).await?;

    // 2. 解压
    println!("正在解压...");
    extract_archive(&archive_path, tmp_dir)?;

    // 3. 找到二进制文件
    let binary_name = if cfg!(windows) {
        "zapmyco.exe"
    } else {
        "zapmyco"
    };
    let extracted_binary = locate_binary(tmp_dir, triple, binary_name)?;

    // 4. 替换当前二进制
    println!("正在更新...");
    let current_exe =
        std::env::current_exe().map_err(|e| format!("无法获取当前执行路径: {}", e))?;
    replace_binary(&extracted_binary, &current_exe)?;

    // 5. 更新安装收据（如果存在）
    let _ = update_receipt(version);

    // 6. 重新配置 shell 补全
    let _ = upgrade_completion();

    let current_version = env!("CARGO_PKG_VERSION");
    println!("✅ 已从 v{} 升级到 v{}", current_version, version);
    println!("🔔 请运行: source ~/.zshrc (或新开终端 Tab) 刷新命令补全");

    Ok(())
}

/// 从 GitHub Releases API 获取最新版本号
async fn get_latest_version() -> Result<String, String> {
    let url = "https://api.github.com/repos/shenjingnan/zapmyco/releases/latest";
    let client = reqwest::Client::builder()
        .user_agent("zapmyco-upgrade/1.0")
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("获取最新版本信息失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("获取版本信息失败: HTTP {}", resp.status()));
    }

    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;

    let json: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("解析响应失败: {}", e))?;

    let tag = json["tag_name"]
        .as_str()
        .ok_or_else(|| "无法获取版本标签".to_string())?;

    Ok(tag.trim_start_matches('v').to_string())
}

/// 比较两个版本号
fn compare_versions(a: &str, b: &str) -> Ordering {
    let a_parts: Vec<u64> = a.split('.').filter_map(|s| s.parse().ok()).collect();
    let b_parts: Vec<u64> = b.split('.').filter_map(|s| s.parse().ok()).collect();

    for i in 0..std::cmp::max(a_parts.len(), b_parts.len()) {
        let a_val = a_parts.get(i).copied().unwrap_or(0);
        let b_val = b_parts.get(i).copied().unwrap_or(0);
        if a_val > b_val {
            return Ordering::Greater;
        }
        if a_val < b_val {
            return Ordering::Less;
        }
    }
    Ordering::Equal
}

/// 检查 latest 是否比 current 更新
fn is_newer(latest: &str, current: &str) -> bool {
    compare_versions(latest, current) == Ordering::Greater
}

/// 检测目标平台 triple
fn detect_target_triple() -> Result<&'static str, String> {
    match (std::env::consts::ARCH, std::env::consts::OS) {
        ("aarch64", "macos") => Ok("aarch64-apple-darwin"),
        ("x86_64", "macos") => Ok("x86_64-apple-darwin"),
        ("aarch64", "linux") => Ok("aarch64-unknown-linux-gnu"),
        ("x86_64", "linux") => Ok("x86_64-unknown-linux-gnu"),
        ("x86_64", "windows") => Ok("x86_64-pc-windows-msvc"),
        _ => Err(format!(
            "不支持的平台: {}-{}",
            std::env::consts::ARCH,
            std::env::consts::OS
        )),
    }
}

/// 下载文件
async fn download_file(url: &str, dest: &Path) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .user_agent("zapmyco-upgrade/1.0")
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("下载失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("下载失败: HTTP {}", response.status()));
    }

    // 流式写入文件
    let mut file = tokio::fs::File::create(dest)
        .await
        .map_err(|e| format!("创建文件失败: {}", e))?;

    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("读取数据失败: {}", e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("写入文件失败: {}", e))?;
    }

    file.flush()
        .await
        .map_err(|e| format!("刷新文件失败: {}", e))?;

    Ok(())
}

/// 解压归档（Unix 使用 tar 命令）
#[cfg(not(windows))]
fn extract_archive(archive_path: &Path, dest_dir: &Path) -> Result<(), String> {
    let status = Command::new("tar")
        .args([
            "-xJf",
            &archive_path.to_string_lossy(),
            "-C",
            &dest_dir.to_string_lossy(),
        ])
        .status()
        .map_err(|e| format!("执行 tar 解压失败: {}", e))?;

    if !status.success() {
        return Err("tar 解压失败".to_string());
    }
    Ok(())
}

/// 解压归档（Windows 使用 PowerShell）
#[cfg(windows)]
fn extract_archive(archive_path: &Path, dest_dir: &Path) -> Result<(), String> {
    let status = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!(
                "Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
                archive_path.display(),
                dest_dir.display()
            ),
        ])
        .status()
        .map_err(|e| format!("解压失败: {}", e))?;

    if !status.success() {
        return Err("解压失败".to_string());
    }
    Ok(())
}

/// 在解压目录中定位二进制文件
fn locate_binary(dir: &Path, triple: &str, binary_name: &str) -> Result<PathBuf, String> {
    // 预期路径: dir/zapmyco-{triple}/{binary}
    let expected = dir.join(format!("zapmyco-{}", triple)).join(binary_name);
    if expected.exists() {
        return Ok(expected);
    }
    // 回退：直接搜索 dir 下的二进制文件
    let fallback = dir.join(binary_name);
    if fallback.exists() {
        return Ok(fallback);
    }
    Err(format!("未找到二进制文件 {}", binary_name))
}

/// 替换当前运行的二进制文件（Unix）
#[cfg(unix)]
fn replace_binary(new_binary: &Path, current_exe: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    let parent = current_exe
        .parent()
        .ok_or_else(|| "无法确定安装目录".to_string())?;
    let staging = parent.join("zapmyco.upgrade");

    // 复制到同目录（确保在同一文件系统，rename 才能原子替换）
    std::fs::copy(new_binary, &staging).map_err(|e| format!("复制新二进制文件失败: {}", e))?;

    // 设置执行权限
    std::fs::set_permissions(&staging, PermissionsExt::from_mode(0o755))
        .map_err(|e| format!("设置执行权限失败: {}", e))?;

    // 原子替换
    std::fs::rename(&staging, current_exe).map_err(|e| format!("替换二进制文件失败: {}", e))?;

    Ok(())
}

/// 替换二进制文件（Windows）
#[cfg(windows)]
fn replace_binary(new_binary: &Path, current_exe: &Path) -> Result<(), String> {
    let old_exe = current_exe.with_extension("old.exe");

    // 重命名当前运行中的 exe（Windows 允许重命名运行中的文件）
    std::fs::rename(current_exe, &old_exe).map_err(|e| format!("重命名当前文件失败: {}", e))?;

    // 复制新文件
    std::fs::copy(new_binary, current_exe).map_err(|e| format!("复制新文件失败: {}", e))?;

    // 清理旧文件
    let _ = std::fs::remove_file(&old_exe);

    Ok(())
}

/// 更新安装收据
fn update_receipt(version: &str) -> Result<(), String> {
    let home = crate::config::settings::get_home_dir();
    let receipt_path = home.join(".config/zapmyco/zapmyco-receipt.json");

    if !receipt_path.exists() {
        return Ok(()); // 非 cargo-dist 安装，跳过
    }

    let content = serde_json::json!({ "version": version });
    let json_str = serde_json::to_string(&content).map_err(|e| format!("序列化收据失败: {}", e))?;

    std::fs::write(&receipt_path, json_str).map_err(|e| format!("写入收据失败: {}", e))?;

    Ok(())
}

/// 重新配置 shell 补全
fn upgrade_completion() -> Result<(), String> {
    match crate::cli::setup_shell_completion() {
        Ok(msg) => {
            println!("\n{}", msg);
            Ok(())
        }
        Err(e) => {
            eprintln!("\n{}", e);
            Ok(()) // 补全配置失败不阻断升级
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compare_versions_equal() {
        assert_eq!(compare_versions("0.29.2", "0.29.2"), Ordering::Equal);
    }

    #[test]
    fn test_compare_versions_greater() {
        assert_eq!(compare_versions("0.30.0", "0.29.2"), Ordering::Greater);
        assert_eq!(compare_versions("1.0.0", "0.99.99"), Ordering::Greater);
        assert_eq!(compare_versions("0.30.0", "0.30.0"), Ordering::Equal);
    }

    #[test]
    fn test_compare_versions_less() {
        assert_eq!(compare_versions("0.29.2", "0.30.0"), Ordering::Less);
        assert_eq!(compare_versions("0.99.99", "1.0.0"), Ordering::Less);
    }

    #[test]
    fn test_is_newer() {
        assert!(is_newer("0.30.0", "0.29.2"));
        assert!(is_newer("1.0.0", "0.99.99"));
        assert!(!is_newer("0.29.2", "0.30.0"));
        assert!(!is_newer("0.29.2", "0.29.2"));
    }

    #[test]
    fn test_detect_target_triple() {
        // Just verify it returns Ok on supported platforms or Err with a message
        let result = detect_target_triple();
        if let Ok(triple) = result {
            assert!(
                triple.contains("apple") || triple.contains("linux") || triple.contains("pc"),
                "unknown triple: {}",
                triple
            );
        }
    }
}

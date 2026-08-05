/// AGENTS.md 文件发现与读取
///
/// 支持三个层级:
/// 1. 用户级: ~/.zapmyco/AGENTS.md — 所有项目的全局指令
/// 2. 项目级: 从 CWD 向上查找 AGENTS.md — 项目通用指令（可入库）
/// 3. 本地级: 与项目级同目录的 AGENTS.local.md — 项目私有指令（不入库）
use std::path::{Path, PathBuf};

/// 读取所有层级的 AGENTS.md 内容
///
/// 按优先级由低到高加载，后加载的内容追加在后面（模型更关注）。
/// 如无可读文件则返回 None。
pub fn load_agents_md(cwd: &Path) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();

    // 1. 用户级: ~/.zapmyco/AGENTS.md
    if let Some(content) = read_file_if_exists(&get_home_agents_path()) {
        parts.push(format!("## 用户全局指令\n{}", content.trim()));
    }

    // 2. 项目级: 从 CWD 向上查找 AGENTS.md
    if let Some((project_root, content)) = find_project_file(cwd, "AGENTS.md") {
        parts.push(format!(
            "## 项目指令（{}）\n{}",
            project_root.display(),
            content.trim()
        ));

        // 3. 本地级: 同目录下的 AGENTS.local.md
        let local_path = project_root.join("AGENTS.local.md");
        if let Some(content) = read_file_if_exists(&local_path) {
            parts.push(format!(
                "## 本地指令（{}）\n{}",
                project_root.display(),
                content.trim()
            ));
        }
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n\n---\n\n"))
    }
}

/// 从 CWD 向上递归查找指定文件名
///
/// 返回 (文件所在目录, 文件内容)。
/// 找到第一个匹配的文件即返回，不会继续向上遍历。
fn find_project_file(cwd: &Path, filename: &str) -> Option<(PathBuf, String)> {
    let mut current = Some(cwd);
    while let Some(dir) = current {
        let candidate = dir.join(filename);
        if candidate.is_file()
            && let Ok(content) = std::fs::read_to_string(&candidate)
            && !content.trim().is_empty()
        {
            return Some((dir.to_path_buf(), content));
        }
        current = dir.parent();
    }
    None
}

/// 获取 ~/.zapmyco/AGENTS.md 路径
fn get_home_agents_path() -> PathBuf {
    crate::config::settings::get_home_dir().join(".zapmyco/AGENTS.md")
}

/// 如果文件存在且非空则读取内容
fn read_file_if_exists(path: &Path) -> Option<String> {
    if path.is_file() {
        std::fs::read_to_string(path)
            .ok()
            .filter(|c| !c.trim().is_empty())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::run_with_temp_home;
    use std::fs;

    #[test]
    fn test_read_user_agents_md() {
        run_with_temp_home(|home| {
            let agents_path = home.join(".zapmyco/AGENTS.md");
            fs::create_dir_all(home.join(".zapmyco")).unwrap();
            fs::write(&agents_path, "请使用中文回复").unwrap();

            let result = load_agents_md(home);
            assert!(result.is_some());
            assert!(result.unwrap().contains("请使用中文回复"));
        });
    }

    #[test]
    fn test_file_not_found_returns_none() {
        run_with_temp_home(|home| {
            let result = load_agents_md(home);
            assert!(result.is_none());
        });
    }

    #[test]
    fn test_find_project_file_upwards() {
        run_with_temp_home(|home| {
            let subdir = home.join("a").join("b").join("c");
            fs::create_dir_all(&subdir).unwrap();
            fs::write(home.join("AGENTS.md"), "project rule").unwrap();

            let result = find_project_file(&subdir, "AGENTS.md");
            assert!(result.is_some());
            let (dir, content) = result.unwrap();
            assert_eq!(dir, home);
            assert_eq!(content, "project rule");
        });
    }

    #[test]
    fn test_find_project_file_not_found() {
        run_with_temp_home(|home| {
            // 不创建任何文件
            let result = find_project_file(home, "AGENTS.md");
            assert!(result.is_none());
        });
    }

    #[test]
    fn test_project_and_local_merged() {
        run_with_temp_home(|home| {
            fs::write(home.join("AGENTS.md"), "project rule").unwrap();
            fs::write(home.join("AGENTS.local.md"), "local rule").unwrap();

            let result = load_agents_md(home).unwrap();
            assert!(result.contains("project rule"));
            assert!(result.contains("local rule"));
        });
    }

    #[test]
    fn test_three_levels_merged() {
        run_with_temp_home(|home| {
            // 用户级
            fs::create_dir_all(home.join(".zapmyco")).unwrap();
            fs::write(home.join(".zapmyco/AGENTS.md"), "user rule").unwrap();
            // 项目级
            fs::write(home.join("AGENTS.md"), "project rule").unwrap();
            // 本地级
            fs::write(home.join("AGENTS.local.md"), "local rule").unwrap();

            let result = load_agents_md(home).unwrap();
            assert!(result.contains("user rule"));
            assert!(result.contains("project rule"));
            assert!(result.contains("local rule"));
        });
    }

    #[test]
    fn test_local_without_project_skipped() {
        run_with_temp_home(|home| {
            // 只有 AGENTS.local.md，没有 AGENTS.md
            fs::write(home.join("AGENTS.local.md"), "local only").unwrap();

            let result = load_agents_md(home);
            // 由于没有 AGENTS.md，AGENTS.local.md 应被跳过
            assert!(result.is_none());
        });
    }

    #[test]
    fn test_read_file_if_exists_nonexistent() {
        run_with_temp_home(|home| {
            let path = home.join("nonexistent.md");
            assert!(read_file_if_exists(&path).is_none());
        });
    }

    #[test]
    fn test_read_file_if_exists_empty() {
        run_with_temp_home(|home| {
            let path = home.join("empty.md");
            fs::write(&path, "").unwrap();
            // 空文件应返回 None
            assert!(read_file_if_exists(&path).is_none());
        });
    }

    #[test]
    fn test_read_file_if_exists_whitespace_only() {
        run_with_temp_home(|home| {
            let path = home.join("whitespace.md");
            fs::write(&path, "  \n  \n").unwrap();
            // 纯空白文件应返回 None
            assert!(read_file_if_exists(&path).is_none());
        });
    }

    #[test]
    fn test_get_home_agents_path() {
        run_with_temp_home(|home| {
            let path = get_home_agents_path();
            assert_eq!(path, home.join(".zapmyco/AGENTS.md"));
        });
    }

    #[test]
    fn test_load_agents_md_empty_dir_returns_none() {
        run_with_temp_home(|home| {
            // 空目录，不创建任何文件
            let result = load_agents_md(home);
            assert!(result.is_none());
        });
    }
}

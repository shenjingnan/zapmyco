use std::path::{Path, PathBuf};

use crate::skills::loader;
use crate::skills::types::{SkillDescriptor, SkillFile, SkillSource};

/// 获取用户级 skill 目录：~/.zapmyco/skills/
fn user_skills_dir() -> PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".zapmyco/skills")
}

/// 获取项目级自有 skill 目录：<cwd>/.zapmyco/skills/
fn project_skills_dir(cwd: &Path) -> PathBuf {
    cwd.join(".zapmyco/skills")
}

/// 获取跨工具 skill 目录：<cwd>/.agents/skills/
fn agents_skills_dir(cwd: &Path) -> PathBuf {
    cwd.join(".agents/skills")
}

/// 支持的 SKILL.md 文件名变体（大小写兼容）
const SKILL_FILE_NAMES: &[&str] = &["SKILL.md", "skill.md"];

/// 校验 skill 名称不含路径遍历字符
fn validate_skill_name(name: &str) -> bool {
    !name.is_empty() && !name.contains('/') && !name.contains('\\') && !name.contains("..")
}

/// 在 skill 目录中查找 SKILL.md 文件（大小写不敏感）
fn find_skill_file(skill_dir: &Path) -> Option<PathBuf> {
    for name in SKILL_FILE_NAMES {
        let path = skill_dir.join(name);
        if path.exists() {
            return Some(path);
        }
    }
    None
}

/// 扫描指定目录下的所有 skill，返回每个 skill 的轻量描述
fn scan_skills_in_dir(base_dir: &Path, source: SkillSource) -> Vec<SkillDescriptor> {
    let mut skills = Vec::new();

    let dir = match std::fs::read_dir(base_dir) {
        Ok(d) => d,
        Err(_) => return skills,
    };

    for entry in dir.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let skill_file_path = match find_skill_file(&path) {
            Some(p) => p,
            None => continue,
        };

        match load_skill_frontmatter(&skill_file_path, &source) {
            Some(desc) => skills.push(desc),
            None => continue,
        }
    }

    skills
}

/// 只读取 SKILL.md 的 frontmatter，返回 SkillDescriptor
fn load_skill_frontmatter(path: &Path, source: &SkillSource) -> Option<SkillDescriptor> {
    let content = std::fs::read_to_string(path).ok()?;
    let skill_file = loader::parse_skill_file(&content).ok()?;

    Some(SkillDescriptor {
        name: skill_file.name,
        description: skill_file.description,
        source: source.clone(),
    })
}

/// 列出所有可用 skill（去重，高优先级覆盖低优先级）
pub fn list_available_skills(cwd: &Path) -> Vec<SkillDescriptor> {
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();

    // 按优先级从低到高扫描，后出现的同名 skill 覆盖前面的
    let scan_configs = [
        (user_skills_dir(), SkillSource::User),
        (agents_skills_dir(cwd), SkillSource::ProjectAgents),
        (project_skills_dir(cwd), SkillSource::Project),
    ];

    for (dir, source) in &scan_configs {
        let skills = scan_skills_in_dir(dir, source.clone());
        for skill in skills {
            if seen.insert(skill.name.clone()) {
                result.push(skill);
            } else if let Some(pos) = result.iter().position(|s| s.name == skill.name) {
                result[pos] = skill;
            }
        }
    }

    result
}

/// 根据名称查找并完整加载指定 skill
///
/// 按优先级从高到低查找。校验 name 不含路径遍历字符。
pub fn resolve_skill(name: &str, cwd: &Path) -> Option<SkillFile> {
    if !validate_skill_name(name) {
        return None;
    }

    let search_paths = [
        project_skills_dir(cwd).join(name),
        agents_skills_dir(cwd).join(name),
        user_skills_dir().join(name),
    ];

    for skill_dir in &search_paths {
        if let Some(skill_file_path) = find_skill_file(skill_dir) {
            let content = std::fs::read_to_string(skill_file_path).ok()?;
            return loader::parse_skill_file(&content).ok();
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn skill(base: &Path, name: &str, desc: &str, body: &str) {
        let dir = base.join(name);
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("SKILL.md"),
            format!("---\nname: {}\ndescription: {}\n---\n{}", name, desc, body),
        )
        .unwrap();
    }

    /// 在隔离的 HOME 环境中执行测试闭包
    fn with_skills_env(f: impl FnOnce(&Path, &Path)) {
        let _guard = crate::test_util::acquire_home_lock();
        let home = TempDir::new().unwrap();
        let hp = home.path().to_path_buf();
        fs::create_dir_all(hp.join(".zapmyco/skills")).unwrap();
        let proj = hp.join("project");
        fs::create_dir_all(proj.join(".zapmyco/skills")).unwrap();
        fs::create_dir_all(proj.join(".agents/skills")).unwrap();
        unsafe {
            std::env::set_var("HOME", &hp);
        }
        f(&hp, &proj);
    }

    // ── find_skill_file ──

    #[test]
    fn test_find_skill_file_exists() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("SKILL.md"), "test").unwrap();
        assert!(find_skill_file(dir.path()).is_some());
    }

    #[test]
    fn test_find_skill_file_lowercase() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("skill.md"), "test").unwrap();
        assert!(find_skill_file(dir.path()).is_some());
    }

    #[test]
    fn test_find_skill_file_not_found() {
        let dir = TempDir::new().unwrap();
        assert!(find_skill_file(dir.path()).is_none());
    }

    // ── list_available_skills ──

    #[test]
    fn test_list_skills_single_layer() {
        with_skills_env(|hp, cwd| {
            skill(&hp.join(".zapmyco/skills"), "skill-a", "d", "b");
            assert_eq!(list_available_skills(cwd)[0].name, "skill-a");
        });
    }

    #[test]
    fn test_list_skills_override() {
        with_skills_env(|hp, cwd| {
            skill(&hp.join(".zapmyco/skills"), "x", "user", "b");
            skill(&cwd.join(".zapmyco/skills"), "x", "project", "b");
            let skills = list_available_skills(cwd);
            assert_eq!(skills.len(), 1);
            assert_eq!(skills[0].description, "project");
        });
    }

    #[test]
    fn test_list_skills_all_layers() {
        with_skills_env(|hp, cwd| {
            skill(&hp.join(".zapmyco/skills"), "a", "user", "b");
            skill(&cwd.join(".agents/skills"), "b", "agents", "b");
            skill(&cwd.join(".zapmyco/skills"), "c", "project", "b");
            assert_eq!(list_available_skills(cwd).len(), 3);
        });
    }

    #[test]
    fn test_list_skills_empty() {
        with_skills_env(|_hp, cwd| {
            assert!(list_available_skills(cwd).is_empty());
        });
    }

    #[test]
    fn test_list_skills_skip_invalid() {
        with_skills_env(|hp, cwd| {
            let user = hp.join(".zapmyco/skills");
            fs::create_dir_all(user.join("bad")).unwrap();
            fs::write(user.join("bad/SKILL.md"), "plain text").unwrap();
            skill(&user, "good", "v", "b");
            let skills = list_available_skills(cwd);
            assert_eq!(skills.len(), 1);
            assert_eq!(skills[0].name, "good");
        });
    }

    #[test]
    fn test_list_skills_hidden_dir() {
        with_skills_env(|hp, cwd| {
            let user = hp.join(".zapmyco/skills");
            fs::create_dir_all(user.join(".hidden")).unwrap();
            fs::write(
                user.join(".hidden/SKILL.md"),
                "---\nname: hidden\ndescription: h\n---\nb",
            )
            .unwrap();
            skill(&user, "visible", "v", "b");
            assert!(
                list_available_skills(cwd)
                    .iter()
                    .any(|s| s.name == "visible")
            );
        });
    }

    // ── resolve_skill ──

    #[test]
    fn test_resolve_skill_project_first() {
        with_skills_env(|hp, cwd| {
            skill(&hp.join(".zapmyco/skills"), "s", "user", "u");
            skill(&cwd.join(".zapmyco/skills"), "s", "project", "p");
            assert_eq!(resolve_skill("s", cwd).unwrap().description, "project");
        });
    }

    #[test]
    fn test_resolve_skill_not_found() {
        with_skills_env(|_hp, cwd| {
            assert!(resolve_skill("nonexistent", cwd).is_none());
        });
    }

    #[test]
    fn test_resolve_skill_path_traversal() {
        with_skills_env(|_hp, cwd| {
            assert!(resolve_skill("../etc", cwd).is_none());
            assert!(resolve_skill("../../secret", cwd).is_none());
            assert!(resolve_skill("a/b", cwd).is_none());
            assert!(resolve_skill("", cwd).is_none());
        });
    }

    // ── list_available_skills extra ──

    #[test]
    fn test_list_skills_three_layer_override() {
        with_skills_env(|hp, cwd| {
            let u = hp.join(".zapmyco/skills");
            let a = cwd.join(".agents/skills");
            let p = cwd.join(".zapmyco/skills");
            skill(&u, "x", "user", "b");
            skill(&a, "x", "agents", "b");
            skill(&p, "x", "project", "b");
            let skills = list_available_skills(cwd);
            let s = skills.iter().find(|s| s.name == "x").unwrap();
            assert_eq!(s.description, "project");
        });
    }

    #[test]
    fn test_list_skills_user_level_missing() {
        with_skills_env(|hp, cwd| {
            // 只清理 user dir 但保留 project
            let user_dir = hp.join(".zapmyco/skills");
            fs::remove_dir_all(&user_dir).ok();
            skill(&cwd.join(".zapmyco/skills"), "s", "project", "b");
            let skills = list_available_skills(cwd);
            assert_eq!(skills.len(), 1);
            assert_eq!(skills[0].source, SkillSource::Project);
        });
    }

    #[test]
    fn test_list_skills_all_levels_empty() {
        with_skills_env(|hp, cwd| {
            fs::remove_dir_all(hp.join(".zapmyco/skills")).ok();
            fs::remove_dir_all(cwd.join(".zapmyco/skills")).ok();
            fs::remove_dir_all(cwd.join(".agents/skills")).ok();
            assert!(list_available_skills(cwd).is_empty());
        });
    }

    #[test]
    fn test_list_skills_skip_files_in_base() {
        with_skills_env(|hp, cwd| {
            // 在 skill 目录中放一个文件而非目录
            fs::write(hp.join(".zapmyco/skills/not_a_dir"), "not a dir").unwrap();
            skill(&hp.join(".zapmyco/skills"), "real", "real", "b");
            let skills = list_available_skills(cwd);
            assert!(skills.iter().any(|s| s.name == "real"));
            // 文件名不会被当作 skill 目录
        });
    }

    #[test]
    fn test_list_skills_no_nested_recurse() {
        with_skills_env(|hp, cwd| {
            let user = hp.join(".zapmyco/skills");
            // 在 user/skill-a 下放一个嵌套 skill
            skill(&user, "outer", "outer", "b");
            let nested = user.join("outer").join("inner");
            fs::create_dir_all(&nested).unwrap();
            fs::write(
                nested.join("SKILL.md"),
                "---\nname: inner\ndescription: inner\n---\nb",
            )
            .unwrap();
            let skills = list_available_skills(cwd);
            // inner 不会被扫描到（只扫一级）
            assert!(!skills.iter().any(|s| s.name == "inner"));
        });
    }

    // ── resolve_skill extra ──

    #[test]
    fn test_resolve_skill_agents_fallback() {
        with_skills_env(|_hp, cwd| {
            skill(&cwd.join(".agents/skills"), "s", "agents", "b");
            let s = resolve_skill("s", cwd).unwrap();
            assert_eq!(s.description, "agents");
        });
    }

    #[test]
    fn test_resolve_skill_three_layer() {
        with_skills_env(|hp, cwd| {
            skill(&hp.join(".zapmyco/skills"), "x", "user", "b");
            skill(&cwd.join(".agents/skills"), "x", "agents", "b");
            skill(&cwd.join(".zapmyco/skills"), "x", "project", "b");
            let s = resolve_skill("x", cwd).unwrap();
            // 应返回 project（最高优先级）
            assert_eq!(s.description, "project");
        });
    }

    #[test]
    fn test_resolve_skill_lowercase_file() {
        with_skills_env(|_hp, cwd| {
            let dir = cwd.join(".zapmyco/skills/ts");
            fs::create_dir_all(&dir).unwrap();
            fs::write(
                dir.join("skill.md"),
                "---\nname: ts\ndescription: d\n---\nb",
            )
            .unwrap();
            assert!(resolve_skill("ts", cwd).is_some());
        });
    }
}

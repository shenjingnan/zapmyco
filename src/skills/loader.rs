use crate::skills::types::{SkillDescriptor, SkillFile, SkillFrontmatter, SkillSource};

/// 解析 SKILL.md 文件内容
///
/// 1. 提取 YAML frontmatter（第一个 --- 到第二个 --- 之间的内容）
/// 2. 用 yaml_serde 解析 frontmatter
/// 3. 剩余部分作为 Markdown body
///
/// 支持 SKILL.md 和 skill.md（大小写兼容）。
pub fn parse_skill_file(content: &str) -> Result<SkillFile, String> {
    let content = content.trim();

    if !content.starts_with("---") {
        return Err("SKILL.md 必须以 YAML frontmatter (---) 开头".to_string());
    }

    let after_first = &content[3..];

    let end = after_first
        .find("\n---")
        .ok_or_else(|| "SKILL.md 缺少 closing ---".to_string())?;

    let yaml_str = &after_first[..end];
    let body = after_first[end + 4..].trim().to_string();

    let frontmatter: SkillFrontmatter = yaml_serde::from_str(yaml_str)
        .map_err(|e| format!("解析 SKILL.md frontmatter 失败: {}", e))?;

    if frontmatter.name.is_empty() {
        return Err("SKILL.md frontmatter 缺少 name 字段".to_string());
    }
    if frontmatter.description.is_empty() {
        return Err("SKILL.md frontmatter 缺少 description 字段".to_string());
    }
    if body.is_empty() {
        return Err("SKILL.md 缺少正文内容".to_string());
    }

    let allowed_tools = frontmatter.allowed_tools.unwrap_or_default();

    Ok(SkillFile {
        name: frontmatter.name,
        description: frontmatter.description,
        allowed_tools,
        body,
    })
}

/// 构建可用 skill 列表的 Markdown 文本
///
/// 注入到 context_reminder 中，作为环境信息告知 AI。
pub fn build_skill_list_text(skills: &[SkillDescriptor]) -> String {
    if skills.is_empty() {
        return String::new();
    }

    let mut lines = vec!["\n## 可用 Skill".to_string()];
    for skill in skills {
        let source_str = match skill.source {
            SkillSource::Project => "项目",
            SkillSource::ProjectAgents => "项目(.agents)",
            SkillSource::User => "用户",
        };
        lines.push(format!(
            "- **{}**: {}（{}）",
            skill.name, skill.description, source_str
        ));
    }
    lines.push(String::new());
    lines.join("\n")
}

/// 计算需要移除的工具列表
///
/// 返回不在 allowed_tools 中的工具名称，由调用者执行 remove_tools。
/// 如果 allowed_tools 为空，返回空列表（不限制）。
pub fn compute_denied_tools(current_tools: &[String], allowed_tools: &[String]) -> Vec<String> {
    if allowed_tools.is_empty() {
        return Vec::new();
    }
    current_tools
        .iter()
        .filter(|name| !allowed_tools.contains(name))
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── parse_skill_file ──

    #[test]
    fn test_parse_normal() {
        let input = "---\nname: test\ndescription: desc\n---\n# Body\ncontent";
        let result = parse_skill_file(input).unwrap();
        assert_eq!(result.name, "test");
        assert_eq!(result.description, "desc");
        assert!(result.body.contains("# Body"));
        assert!(result.body.contains("content"));
        assert!(result.allowed_tools.is_empty());
    }

    #[test]
    fn test_parse_with_allowed_tools() {
        let input =
            "---\nname: cr\ndescription: review\nallowed-tools: file_read file_search\n---\nbody";
        let result = parse_skill_file(input).unwrap();
        assert_eq!(result.allowed_tools, vec!["file_read", "file_search"]);
    }

    #[test]
    fn test_parse_multiline_body() {
        let input = "---\nname: test\ndescription: desc\n---\n# Title\n\nPara1\n\nPara2";
        let result = parse_skill_file(input).unwrap();
        assert_eq!(result.body, "# Title\n\nPara1\n\nPara2");
    }

    #[test]
    fn test_parse_crlf() {
        let input = "---\r\nname: test\r\ndescription: desc\r\n---\r\nbody";
        let result = parse_skill_file(input).unwrap();
        assert_eq!(result.name, "test");
        assert_eq!(result.body, "body");
    }

    #[test]
    fn test_parse_dash_in_body() {
        let input = "---\nname: test\ndescription: desc\n---\nSome text\n---\nmore";
        let result = parse_skill_file(input).unwrap();
        assert_eq!(result.body, "Some text\n---\nmore");
    }

    #[test]
    fn test_parse_no_frontmatter() {
        let result = parse_skill_file("plain text");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("必须以 YAML frontmatter"));
    }

    #[test]
    fn test_parse_no_closing() {
        let result = parse_skill_file("---\nname: test");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("缺少 closing"));
    }

    #[test]
    fn test_parse_missing_name() {
        let input = "---\ndescription: desc\n---\nbody";
        let result = parse_skill_file(input);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("缺少 name"));
    }

    #[test]
    fn test_parse_missing_description() {
        let input = "---\nname: test\n---\nbody";
        let result = parse_skill_file(input);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("缺少 description"));
    }

    #[test]
    fn test_parse_empty_body() {
        let input = "---\nname: test\ndescription: desc\n---\n  ";
        let result = parse_skill_file(input);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("缺少正文"));
    }

    #[test]
    fn test_parse_empty_content() {
        let result = parse_skill_file("");
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_zero_byte() {
        let result = parse_skill_file("");
        assert!(result.is_err());
    }

    // ── build_skill_list_text ──

    #[test]
    fn test_build_list_empty() {
        assert_eq!(build_skill_list_text(&[]), "");
    }

    #[test]
    fn test_build_list_single() {
        let skills = vec![SkillDescriptor {
            name: "cr".to_string(),
            description: "review".to_string(),
            source: SkillSource::Project,
        }];
        let text = build_skill_list_text(&skills);
        assert!(text.contains("## 可用 Skill"));
        assert!(text.contains("**cr**"));
        assert!(text.contains("review"));
        assert!(text.contains("项目"));
    }

    #[test]
    fn test_build_list_multiple_sources() {
        let skills = vec![
            SkillDescriptor {
                name: "a".to_string(),
                description: "d1".to_string(),
                source: SkillSource::Project,
            },
            SkillDescriptor {
                name: "b".to_string(),
                description: "d2".to_string(),
                source: SkillSource::User,
            },
        ];
        let text = build_skill_list_text(&skills);
        assert!(text.contains("项目"));
        assert!(text.contains("用户"));
    }

    // ── compute_denied_tools ──

    #[test]
    fn test_deny_no_restriction() {
        let current = vec!["a".to_string(), "b".to_string()];
        let allowed: Vec<String> = vec![];
        assert!(compute_denied_tools(&current, &allowed).is_empty());
    }

    #[test]
    fn test_deny_partial() {
        let current = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        let allowed = vec!["a".to_string(), "c".to_string()];
        let denied = compute_denied_tools(&current, &allowed);
        assert_eq!(denied, vec!["b"]);
    }

    #[test]
    fn test_deny_all() {
        let current = vec!["a".to_string(), "b".to_string()];
        let allowed = vec!["x".to_string()];
        let denied = compute_denied_tools(&current, &allowed);
        assert_eq!(denied.len(), 2);
    }

    #[test]
    fn test_deny_empty_current() {
        let current: Vec<String> = vec![];
        let allowed = vec!["a".to_string()];
        assert!(compute_denied_tools(&current, &allowed).is_empty());
    }
}

use serde::Deserialize;

/// SKILL.md 完整解析结果
#[derive(Debug, Clone)]
pub struct SkillFile {
    /// YAML frontmatter 中解析出的 name
    pub name: String,
    /// YAML frontmatter 中解析出的 description
    pub description: String,
    /// YAML frontmatter 中解析出的 allowed-tools（可选）
    pub allowed_tools: Vec<String>,
    /// Markdown 正文（frontmatter 之后的部分）
    pub body: String,
}

/// 用于反序列化 YAML frontmatter 的中间结构
///
/// 只关注我们需要的字段，其他未知字段自动忽略。
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct SkillFrontmatter {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// 工具白名单，支持两种格式：
    ///   allowed-tools: file_read file_search        (空格分隔字符串)
    ///   allowed-tools: [file_read, file_search]     (YAML 列表)
    #[serde(default)]
    #[serde(rename = "allowed-tools")]
    #[serde(deserialize_with = "deserialize_allowed_tools")]
    pub allowed_tools: Option<Vec<String>>,
}

/// 自定义反序列化：兼容 allowed-tools 的字符串和 YAML 列表两种格式
fn deserialize_allowed_tools<'de, D>(deserializer: D) -> Result<Option<Vec<String>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::Error;
    let opt: Option<yaml_serde::Value> = Option::deserialize(deserializer)?;
    match opt {
        None => Ok(None),
        Some(yaml_serde::Value::String(s)) => {
            let v: Vec<String> = s.split_whitespace().map(String::from).collect();
            Ok(Some(v))
        }
        Some(yaml_serde::Value::Sequence(seq)) => {
            let v: Vec<String> = seq
                .iter()
                .filter_map(|item| item.as_str().map(String::from))
                .collect();
            if v.is_empty() {
                return Err(D::Error::custom("allowed-tools 列表为空或包含非字符串元素"));
            }
            Ok(Some(v))
        }
        Some(other) => Err(D::Error::custom(format!(
            "allowed-tools 类型错误：期望字符串或列表，实际为 {:?}",
            other
        ))),
    }
}

/// Skill 来源层级
#[derive(Debug, Clone, PartialEq)]
pub enum SkillSource {
    /// 项目级：<project>/.zapmyco/skills/<name>/SKILL.md
    Project,
    /// 通用级：<project>/.agents/skills/<name>/SKILL.md
    ProjectAgents,
    /// 用户级：~/.zapmyco/skills/<name>/SKILL.md
    User,
}

/// Skill 描述信息（仅 frontmatter，轻量）
#[derive(Debug, Clone)]
pub struct SkillDescriptor {
    pub name: String,
    pub description: String,
    pub source: SkillSource,
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── 1.1 SkillFrontmatter 反序列化 ──

    #[test]
    fn test_frontmatter_normal() {
        let yaml = "name: test\ndescription: 测试 skill";
        let fm: SkillFrontmatter = yaml_serde::from_str(yaml).unwrap();
        assert_eq!(fm.name, "test");
        assert_eq!(fm.description, "测试 skill");
        assert!(fm.allowed_tools.is_none());
    }

    #[test]
    fn test_frontmatter_allowed_tools_string() {
        let yaml = "name: test\ndescription: x\nallowed-tools: file_read file_search";
        let fm: SkillFrontmatter = yaml_serde::from_str(yaml).unwrap();
        let tools = fm.allowed_tools.unwrap();
        assert_eq!(tools, vec!["file_read", "file_search"]);
    }

    #[test]
    fn test_frontmatter_allowed_tools_list() {
        let yaml = "name: test\ndescription: x\nallowed-tools:\n  - file_read\n  - file_search";
        let fm: SkillFrontmatter = yaml_serde::from_str(yaml).unwrap();
        let tools = fm.allowed_tools.unwrap();
        assert_eq!(tools, vec!["file_read", "file_search"]);
    }

    #[test]
    fn test_frontmatter_allowed_tools_empty() {
        let yaml = "name: test\ndescription: x";
        let fm: SkillFrontmatter = yaml_serde::from_str(yaml).unwrap();
        assert!(fm.allowed_tools.is_none());
    }

    #[test]
    fn test_frontmatter_allowed_tools_empty_string() {
        let yaml = "name: test\ndescription: x\nallowed-tools: ''";
        let fm: SkillFrontmatter = yaml_serde::from_str(yaml).unwrap();
        let tools = fm.allowed_tools.unwrap();
        assert!(tools.is_empty());
    }

    #[test]
    fn test_frontmatter_unknown_fields() {
        let yaml = "name: test\ndescription: x\nunknown: yes\nlicense: MIT";
        let fm: SkillFrontmatter = yaml_serde::from_str(yaml).unwrap();
        assert_eq!(fm.name, "test");
    }

    #[test]
    fn test_frontmatter_allowed_tools_invalid_type() {
        let yaml = "name: test\ndescription: x\nallowed-tools: 123";
        let result: Result<SkillFrontmatter, _> = yaml_serde::from_str(yaml);
        assert!(result.is_err());
    }

    #[test]
    fn test_frontmatter_allowed_tools_empty_list() {
        // allowed-tools: [] → 空序列 → 自定义 deserialize 返回错误
        let yaml = "name: test\ndescription: x\nallowed-tools: []";
        let result: Result<SkillFrontmatter, _> = yaml_serde::from_str(yaml);
        assert!(result.is_err());
    }

    #[test]
    fn test_frontmatter_extra_standard_fields() {
        // license、compatibility 等标准字段不影响解析
        let yaml = "name: test\ndescription: x\nlicense: MIT\ncompatibility: rust";
        let fm: SkillFrontmatter = yaml_serde::from_str(yaml).unwrap();
        assert_eq!(fm.name, "test");
        assert!(fm.allowed_tools.is_none());
    }

    // ── 1.2 SkillFile 构造 ──

    #[test]
    fn test_skillfile_construction() {
        let sf = SkillFile {
            name: "test".to_string(),
            description: "desc".to_string(),
            allowed_tools: vec!["file_read".to_string()],
            body: "# Body".to_string(),
        };
        assert_eq!(sf.name, "test");
        assert_eq!(sf.description, "desc");
        assert_eq!(sf.allowed_tools, vec!["file_read"]);
        assert_eq!(sf.body, "# Body");
    }

    #[test]
    fn test_skillfile_allowed_tools_empty() {
        let sf = SkillFile {
            name: "t".to_string(),
            description: "d".to_string(),
            allowed_tools: vec![],
            body: "b".to_string(),
        };
        assert!(sf.allowed_tools.is_empty());
    }

    // ── 1.3 SkillSource ──

    #[test]
    fn test_skillsource_equality() {
        assert_eq!(SkillSource::Project, SkillSource::Project);
        assert_ne!(SkillSource::Project, SkillSource::User);
        assert_ne!(SkillSource::ProjectAgents, SkillSource::Project);
    }
}

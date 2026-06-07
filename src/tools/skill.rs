use std::path::PathBuf;
use zapmyco_anthropic_ai_sdk::types::message::Tool;

/// Skill 工具 — LLM 可在对话中调用以列出或加载 skill
///
/// 与 SubAgent 工具相同的 action 派发模式：
/// - `action: "list"` — 列出所有可用 skill
/// - `action: "load"` — 加载指定 skill 的完整指令
pub struct SkillTool {
    cwd: PathBuf,
}

impl SkillTool {
    pub fn new() -> Result<Self, String> {
        let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
        Ok(Self { cwd })
    }

    #[cfg(test)]
    pub fn with_cwd(cwd: PathBuf) -> Self {
        Self { cwd }
    }

    fn validate_name(name: &str) -> Result<(), String> {
        if name.is_empty() {
            return Err("skill 名称不能为空".to_string());
        }
        if name.contains('/') || name.contains('\\') || name.contains("..") {
            return Err(format!("无效的 skill 名称: '{}'", name));
        }
        Ok(())
    }

    pub fn tool_definition() -> Tool {
        Tool {
            name: "skill".to_string(),
            description: Some(
                "管理 skill。Skill 是预定义的工作流模板，包含详细的执行规则和步骤。\
                 支持两种 action:\n\
                 - list: 列出所有可用 skill 的名称和描述，让用户选择\n\
                 - load: 加载指定 skill 的完整指令。调用后请仔细阅读并遵循 skill 中的规则"
                    .to_string(),
            ),
            input_schema: Some(serde_json::json!({
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["list", "load"],
                        "description": "list: 列出可用 skill；load: 加载指定 skill"
                    },
                    "name": {
                        "type": "string",
                        "description": "要加载的 skill 名称（action 为 load 时必需）"
                    }
                },
                "required": ["action"]
            })),
            ..Default::default()
        }
    }

    pub async fn execute(&self, input: &serde_json::Value) -> Result<String, String> {
        let action = input
            .get("action")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "缺少 action 参数（list / load）".to_string())?;

        match action {
            "list" => self.cmd_list().await,
            "load" => {
                let name = input
                    .get("name")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "action 为 load 时缺少 name 参数".to_string())?;
                self.cmd_load(name).await
            }
            other => Err(format!("不支持的 action: '{}'（支持: list, load）", other)),
        }
    }

    async fn cmd_list(&self) -> Result<String, String> {
        let skills = crate::skills::discovery::list_available_skills(&self.cwd);
        if skills.is_empty() {
            return Ok("当前没有任何可用 skill。可以在以下位置创建 SKILL.md：\n\
                 ~/.zapmyco/skills/<name>/SKILL.md\n\
                 <project>/.zapmyco/skills/<name>/SKILL.md\n\
                 <project>/.agents/skills/<name>/SKILL.md"
                .to_string());
        }

        let mut text = crate::skills::loader::build_skill_list_text(&skills);
        text.push_str("使用 action=load 加载某个 skill 来使用。\n");
        Ok(text)
    }

    async fn cmd_load(&self, name: &str) -> Result<String, String> {
        Self::validate_name(name)?;

        let cwd = &self.cwd;
        match crate::skills::discovery::resolve_skill(name, cwd) {
            Some(skill) => {
                if skill.name != name {
                    return Err(format!(
                        "Skill 目录名 '{}' 与 frontmatter name '{}' 不匹配",
                        name, skill.name
                    ));
                }
                Ok(format!("## Skill: {}\n\n{}", skill.name, skill.body))
            }
            None => {
                let skills = crate::skills::discovery::list_available_skills(cwd);
                let mut msg = format!("Skill '{}' 未找到。\n", name);
                if !skills.is_empty() {
                    msg.push_str("可用的 skill:\n");
                    for s in &skills {
                        msg.push_str(&format!("  - {}: {}\n", s.name, s.description));
                    }
                }
                Err(msg)
            }
        }
    }

    pub fn is_concurrency_safe(&self, _input: &serde_json::Value) -> bool {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn make_skill(home: &TempDir) -> (SkillTool, PathBuf) {
        let hp = home.path().to_path_buf();
        let proj = hp.join("project");
        fs::create_dir_all(proj.join(".zapmyco/skills/cr")).unwrap();
        fs::write(
            proj.join(".zapmyco/skills/cr/SKILL.md"),
            "---\nname: cr\ndescription: code review\n---\n# Review\nCheck all changes.",
        )
        .unwrap();
        let tool = SkillTool::with_cwd(proj.clone());
        (tool, proj)
    }

    // ── tool_definition ──

    #[test]
    fn test_tool_def_name() {
        let def = SkillTool::tool_definition();
        assert_eq!(def.name, "skill");
    }

    #[test]
    fn test_tool_def_schema_has_action_enum() {
        let def = SkillTool::tool_definition();
        let schema = def.input_schema.unwrap();
        let action = &schema["properties"]["action"];
        assert_eq!(action["enum"][0], "list");
        assert_eq!(action["enum"][1], "load");
    }

    #[test]
    fn test_tool_def_action_required() {
        let def = SkillTool::tool_definition();
        let schema = def.input_schema.unwrap();
        assert_eq!(schema["required"][0], "action");
    }

    #[test]
    fn test_tool_def_schema_has_name_property() {
        let def = SkillTool::tool_definition();
        let schema = def.input_schema.unwrap();
        assert!(schema["properties"]["name"].is_object());
    }

    // ── is_concurrency_safe ──

    #[test]
    fn test_concurrency_safe() {
        let tool = SkillTool::with_cwd(PathBuf::from("/"));
        let input = serde_json::json!({"action": "list"});
        assert!(tool.is_concurrency_safe(&input));
    }

    // ── validate_name ──

    #[test]
    fn test_validate_name_normal() {
        assert!(SkillTool::validate_name("code-review").is_ok());
    }

    #[test]
    fn test_validate_name_traversal() {
        assert!(SkillTool::validate_name("../etc").is_err());
        assert!(SkillTool::validate_name("a/b").is_err());
    }

    #[test]
    fn test_validate_name_empty() {
        assert!(SkillTool::validate_name("").is_err());
    }

    // ── execute: action=list ──

    #[test]
    fn test_execute_list_with_skills() {
        let home = TempDir::new().unwrap();
        let _guard = crate::test_util::acquire_home_lock();
        unsafe {
            std::env::set_var("HOME", home.path());
        }
        let (tool, _) = make_skill(&home);
        let input = serde_json::json!({"action": "list"});
        let result = block_on(tool.execute(&input));
        assert!(result.unwrap().contains("cr"));
    }

    #[test]
    fn test_execute_list_has_prompt() {
        let home = TempDir::new().unwrap();
        let _guard = crate::test_util::acquire_home_lock();
        unsafe {
            std::env::set_var("HOME", home.path());
        }
        let (tool, _) = make_skill(&home);
        let input = serde_json::json!({"action": "list"});
        let result = block_on(tool.execute(&input)).unwrap();
        assert!(result.contains("使用 action=load"));
    }

    #[test]
    fn test_execute_list_no_skills() {
        let home = TempDir::new().unwrap();
        let _guard = crate::test_util::acquire_home_lock();
        unsafe {
            std::env::set_var("HOME", home.path());
        }
        // 空目录，没有任何 skill
        let tool = SkillTool::with_cwd(home.path().join("empty"));
        let input = serde_json::json!({"action": "list"});
        let result = block_on(tool.execute(&input)).unwrap();
        assert!(result.contains("当前没有任何可用 skill"));
    }

    // ── execute: action=load ──

    #[test]
    fn test_execute_load_found() {
        let home = TempDir::new().unwrap();
        let _guard = crate::test_util::acquire_home_lock();
        unsafe {
            std::env::set_var("HOME", home.path());
        }
        let (tool, _) = make_skill(&home);
        let input = serde_json::json!({"action": "load", "name": "cr"});
        let result = block_on(tool.execute(&input)).unwrap();
        assert!(result.contains("## Skill: cr"));
        assert!(result.contains("Review"));
    }

    #[test]
    fn test_execute_load_not_found() {
        let home = TempDir::new().unwrap();
        let _guard = crate::test_util::acquire_home_lock();
        unsafe {
            std::env::set_var("HOME", home.path());
        }
        let (tool, _) = make_skill(&home);
        let input = serde_json::json!({"action": "load", "name": "nonexistent"});
        assert!(block_on(tool.execute(&input)).is_err());
    }

    #[test]
    fn test_execute_load_name_mismatch() {
        let home = TempDir::new().unwrap();
        let hp = home.path().to_path_buf();
        let proj = hp.join("project");
        fs::create_dir_all(proj.join(".zapmyco/skills/cr")).unwrap();
        // frontmatter name 为 "review" 而非 "cr"
        fs::write(
            proj.join(".zapmyco/skills/cr/SKILL.md"),
            "---\nname: review\ndescription: code review\n---\nbody",
        )
        .unwrap();
        let tool = SkillTool::with_cwd(proj);
        let input = serde_json::json!({"action": "load", "name": "cr"});
        let result = block_on(tool.execute(&input));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("不匹配"));
    }

    #[test]
    fn test_execute_load_missing_name_param() {
        let tool = SkillTool::with_cwd(PathBuf::from("/"));
        // action=load 但缺少 name
        let input = serde_json::json!({"action": "load"});
        let result = block_on(tool.execute(&input));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("缺少 name"));
    }

    #[test]
    fn test_execute_load_with_slash() {
        let tool = SkillTool::with_cwd(PathBuf::from("/"));
        let input = serde_json::json!({"action": "load", "name": "a/b"});
        let result = block_on(tool.execute(&input));
        assert!(result.is_err());
    }

    #[test]
    fn test_execute_load_traversal() {
        let home = TempDir::new().unwrap();
        let (tool, _) = make_skill(&home);
        let input = serde_json::json!({"action": "load", "name": "../etc"});
        assert!(block_on(tool.execute(&input)).is_err());
    }

    #[test]
    fn test_execute_missing_action() {
        let tool = SkillTool::with_cwd(PathBuf::from("/"));
        let input = serde_json::json!({});
        assert!(block_on(tool.execute(&input)).is_err());
    }

    #[test]
    fn test_execute_invalid_action() {
        let tool = SkillTool::with_cwd(PathBuf::from("/"));
        let input = serde_json::json!({"action": "invalid"});
        assert!(block_on(tool.execute(&input)).is_err());
    }

    fn block_on<F: std::future::Future<Output = Result<String, String>>>(
        f: F,
    ) -> Result<String, String> {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(f)
    }
}

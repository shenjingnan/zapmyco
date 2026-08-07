//! 公共数据类型 — 与主 crate `tui/types.rs`、`skills/types.rs` 字段对齐。

/// 权限模式 — 限制 agent 的操作权限。
///
/// 由主 crate 通过重导出维持 `crate::cli::PermissionMode` 路径；
/// clap 派生经 feature 门控，普通库消费方默认不引入 clap。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[cfg_attr(feature = "clap", derive(clap::ValueEnum))]
pub enum PermissionMode {
    /// 完全权限：可读、可写、可执行（默认）
    #[default]
    Full,
    /// 读写模式：可读、可写，禁止执行 shell 命令
    #[cfg_attr(feature = "clap", clap(alias = "readwrite"))]
    ReadWrite,
    /// 只读模式：只能读取和分析内容，禁止写入和执行
    #[cfg_attr(feature = "clap", clap(alias = "readonly"))]
    ReadOnly,
}

impl std::fmt::Display for PermissionMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Full => write!(f, "full"),
            Self::ReadWrite => write!(f, "readwrite"),
            Self::ReadOnly => write!(f, "readonly"),
        }
    }
}

/// 选择器选项（String 版，供注入 trait 跨 crate 传递）。
#[derive(Debug, Clone)]
pub struct SelectOption {
    /// 选项标签（短文本，如 "性能优化"）
    pub label: String,
    /// 选项描述（详细说明，如 "减少内存使用和执行时间"）
    pub description: String,
    /// 选中此项后进入文本输入模式，让用户自行输入
    pub custom_input: bool,
}

/// 单选结果
#[derive(Debug, Clone)]
pub enum SingleSelectResult {
    /// 选择了预定义选项（索引）
    Index(usize),
    /// 用户自行输入的内容
    Custom(String),
}

/// 多选结果
#[derive(Debug, Clone)]
pub struct MultiSelectResult {
    /// 选中的预定义选项索引列表
    pub indices: Vec<usize>,
    /// 用户自行输入的内容（如有）
    pub custom_text: Option<String>,
}

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

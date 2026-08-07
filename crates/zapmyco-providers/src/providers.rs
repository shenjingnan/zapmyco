//! 供应商元数据表。
//!
//! 集中管理各供应商的展示名、默认搜索模型、环境变量约定与 API 版本等元信息，
//! 与 `models.rs` 的模型注册表互补：注册表管"模型"，本表管"供应商"。
//!
//! 注意：`default_env_var` 与 `api_version` 目前**仅作信息用途，不接线**——
//! 现状下 `resolve_api_key` 对所有供应商都回退硬编码的 `DEEPSEEK_API_KEY`，
//! API 版本在各传输层硬编码为 `"2023-06-01"`。接线会改变现有行为，需另行决策。

/// 供应商元信息
#[derive(Debug, Clone, Copy)]
pub struct ProviderMeta {
    /// 供应商 ID（settings.toml `[llm.providers]` 的 key，与模型注册表 `provider` 字段一致）
    pub name: &'static str,
    /// init 向导显示名（对齐 `src/commands/init.rs` 的选项列表）
    pub display_name: &'static str,
    /// 默认搜索模型名；`None` 表示回退到 `resolve::DEFAULT_MODEL`
    pub default_search_model: Option<&'static str>,
    /// 该供应商的默认环境变量约定（仅信息，不接线）
    pub default_env_var: Option<&'static str>,
    /// 默认 API 版本（仅信息，不接线；现状各供应商均为 "2023-06-01"）
    pub api_version: &'static str,
}

/// 内置供应商元数据表。
///
/// 顺序对齐 `src/commands/init.rs` 的选项列表；`custom` 为特殊项
/// （无模型、配置解析回退默认值）。
pub const PROVIDER_METADATA: &[ProviderMeta] = &[
    ProviderMeta {
        name: "anthropic",
        display_name: "Anthropic",
        default_search_model: Some("claude-sonnet-4-6"),
        default_env_var: None,
        api_version: "2023-06-01",
    },
    ProviderMeta {
        name: "deepseek",
        display_name: "DeepSeek",
        default_search_model: Some("deepseek-v4-flash"),
        default_env_var: Some("DEEPSEEK_API_KEY"),
        api_version: "2023-06-01",
    },
    ProviderMeta {
        name: "qwen",
        display_name: "Qwen（通义千问）",
        default_search_model: None,
        default_env_var: None,
        api_version: "2023-06-01",
    },
    ProviderMeta {
        name: "minimax",
        display_name: "MiniMax",
        default_search_model: None,
        default_env_var: None,
        api_version: "2023-06-01",
    },
    ProviderMeta {
        name: "glm",
        display_name: "GLM（智谱）",
        default_search_model: None,
        default_env_var: None,
        api_version: "2023-06-01",
    },
    ProviderMeta {
        name: "kimi",
        display_name: "Kimi（月之暗面）",
        default_search_model: None,
        default_env_var: None,
        api_version: "2023-06-01",
    },
    ProviderMeta {
        name: "doubao",
        display_name: "Doubao（火山引擎/字节）",
        default_search_model: None,
        default_env_var: None,
        api_version: "2023-06-01",
    },
    ProviderMeta {
        name: "mimo",
        display_name: "MIMO（小米）",
        default_search_model: None,
        default_env_var: None,
        api_version: "2023-06-01",
    },
    ProviderMeta {
        name: "custom",
        display_name: "自定义",
        default_search_model: None,
        default_env_var: None,
        api_version: "2023-06-01",
    },
];

/// 按供应商 ID 查询元信息
pub fn provider_meta(name: &str) -> Option<&'static ProviderMeta> {
    PROVIDER_METADATA.iter().find(|m| m.name == name)
}

/// 获取所有供应商 ID 列表（含 `custom`，对齐 init 向导选项）
pub fn all_provider_names() -> Vec<&'static str> {
    PROVIDER_METADATA.iter().map(|m| m.name).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_provider_meta_known() {
        let meta = provider_meta("deepseek").unwrap();
        assert_eq!(meta.display_name, "DeepSeek");
        assert_eq!(meta.default_search_model, Some("deepseek-v4-flash"));
        assert_eq!(meta.default_env_var, Some("DEEPSEEK_API_KEY"));
        assert_eq!(meta.api_version, "2023-06-01");
    }

    #[test]
    fn test_provider_meta_anthropic_search_model() {
        let meta = provider_meta("anthropic").unwrap();
        assert_eq!(meta.display_name, "Anthropic");
        assert_eq!(meta.default_search_model, Some("claude-sonnet-4-6"));
    }

    #[test]
    fn test_provider_meta_unknown() {
        assert!(provider_meta("non-existent").is_none());
    }

    #[test]
    fn test_provider_meta_custom() {
        let meta = provider_meta("custom").unwrap();
        assert_eq!(meta.display_name, "自定义");
        assert_eq!(meta.default_search_model, None);
    }

    #[test]
    fn test_all_provider_names_contains_all() {
        let names = all_provider_names();
        for expected in [
            "anthropic",
            "deepseek",
            "qwen",
            "minimax",
            "glm",
            "kimi",
            "doubao",
            "mimo",
            "custom",
        ] {
            assert!(names.contains(&expected), "缺少供应商: {}", expected);
        }
        assert_eq!(names.len(), 9);
    }

    #[test]
    fn test_provider_meta_unique_names() {
        let mut seen = std::collections::HashSet::new();
        for meta in PROVIDER_METADATA {
            assert!(seen.insert(meta.name), "重复的供应商 ID: {}", meta.name);
        }
    }

    #[test]
    fn test_provider_meta_non_empty() {
        for meta in PROVIDER_METADATA {
            assert!(!meta.name.is_empty());
            assert!(!meta.display_name.is_empty());
            assert!(!meta.api_version.is_empty());
        }
    }
}

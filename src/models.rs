// Phase 2 将使用部分字段，暂时允许 dead_code
#![allow(dead_code)]

/// Models - 内置模型注册表
///
/// 集中维护所有内置模型的元信息（供应商归属、baseURL、能力）。
/// settings.json 中只需引用模型名称，详细信息由此处提供。

/// 模型能力
#[derive(Debug, Clone, PartialEq)]
pub enum ModelCapability {
    Text,
    Vision,
}

/// 内置模型信息
#[derive(Debug, Clone)]
pub struct BuiltInModel {
    /// 所属供应商标识
    pub provider: &'static str,
    /// API 基础地址
    pub base_url: &'static str,
    /// 模型能力列表
    pub capabilities: &'static [ModelCapability],
    /// 上下文窗口大小（tokens）
    pub context_window: Option<u32>,
    /// 最大输出 tokens
    pub max_output_tokens: Option<u32>,
}

/// 内置模型注册表
const BUILT_IN_MODELS: &[(&str, BuiltInModel)] = &[
    (
        "deepseek-v4-flash",
        BuiltInModel {
            provider: "deepseek",
            base_url: "https://api.deepseek.com/anthropic",
            capabilities: &[ModelCapability::Text],
            context_window: Some(1_000_000),
            max_output_tokens: Some(384_000),
        },
    ),
    (
        "deepseek-v4-pro",
        BuiltInModel {
            provider: "deepseek",
            base_url: "https://api.deepseek.com/anthropic",
            capabilities: &[ModelCapability::Text],
            context_window: Some(1_000_000),
            max_output_tokens: Some(384_000),
        },
    ),
    (
        "deepseek-reasoner",
        BuiltInModel {
            provider: "deepseek",
            base_url: "https://api.deepseek.com/anthropic",
            capabilities: &[ModelCapability::Text],
            context_window: Some(128_000),
            max_output_tokens: Some(16_384),
        },
    ),
    (
        "glm-4-flash",
        BuiltInModel {
            provider: "glm",
            base_url: "https://open.bigmodel.cn/api/anthropic",
            capabilities: &[ModelCapability::Text],
            context_window: Some(128_000),
            max_output_tokens: Some(16_384),
        },
    ),
    (
        "glm-4v",
        BuiltInModel {
            provider: "glm",
            base_url: "https://open.bigmodel.cn/api/anthropic",
            capabilities: &[ModelCapability::Text, ModelCapability::Vision],
            context_window: Some(128_000),
            max_output_tokens: Some(16_384),
        },
    ),
    (
        "glm-5v-turbo",
        BuiltInModel {
            provider: "glm",
            base_url: "https://open.bigmodel.cn/api/anthropic",
            capabilities: &[ModelCapability::Text, ModelCapability::Vision],
            context_window: Some(200_000),
            max_output_tokens: Some(128_000),
        },
    ),
    (
        "glm-5.1",
        BuiltInModel {
            provider: "glm",
            base_url: "https://open.bigmodel.cn/api/anthropic",
            capabilities: &[ModelCapability::Text],
            context_window: Some(200_000),
            max_output_tokens: Some(128_000),
        },
    ),
];

/// 根据模型名称获取内置模型信息
pub fn get_model_info(name: &str) -> Option<&'static BuiltInModel> {
    BUILT_IN_MODELS
        .iter()
        .find(|(key, _)| *key == name)
        .map(|(_, info)| info)
}

/// 获取所有内置模型名称列表
pub fn get_built_in_model_names() -> Vec<&'static str> {
    BUILT_IN_MODELS.iter().map(|(key, _)| *key).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_model_info_known_model() {
        let info = get_model_info("deepseek-v4-flash").unwrap();
        assert_eq!(info.provider, "deepseek");
        assert_eq!(info.base_url, "https://api.deepseek.com/anthropic");
        assert_eq!(info.capabilities, &[ModelCapability::Text]);
    }

    #[test]
    fn test_get_model_info_vision_model() {
        let info = get_model_info("glm-4v").unwrap();
        assert_eq!(info.provider, "glm");
        assert_eq!(info.capabilities, &[ModelCapability::Text, ModelCapability::Vision]);
    }

    #[test]
    fn test_get_model_info_unknown_model() {
        assert!(get_model_info("unknown-model").is_none());
    }

    #[test]
    fn test_get_built_in_model_names() {
        let names = get_built_in_model_names();
        assert!(names.contains(&"deepseek-v4-flash"));
        assert!(names.contains(&"glm-4v"));
        assert_eq!(names.len(), 7);
    }
}

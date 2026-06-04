//! Models - 内置模型注册表
//!
//! 集中维护所有内置模型的元信息（供应商归属、baseURL、能力）。
//! settings.toml 中只需引用模型名称，详细信息由此处提供。
// Phase 2 will use these fields
#![allow(dead_code)]

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
    // --- GLM 新增模型 ---
    (
        "glm-5",
        BuiltInModel {
            provider: "glm",
            base_url: "https://open.bigmodel.cn/api/anthropic",
            capabilities: &[ModelCapability::Text],
            context_window: Some(200_000),
            max_output_tokens: Some(128_000),
        },
    ),
    (
        "glm-5-turbo",
        BuiltInModel {
            provider: "glm",
            base_url: "https://open.bigmodel.cn/api/anthropic",
            capabilities: &[ModelCapability::Text],
            context_window: Some(200_000),
            max_output_tokens: Some(128_000),
        },
    ),
    (
        "glm-4.7",
        BuiltInModel {
            provider: "glm",
            base_url: "https://open.bigmodel.cn/api/anthropic",
            capabilities: &[ModelCapability::Text],
            context_window: Some(200_000),
            max_output_tokens: Some(128_000),
        },
    ),
    (
        "glm-4.7-flash",
        BuiltInModel {
            provider: "glm",
            base_url: "https://open.bigmodel.cn/api/anthropic",
            capabilities: &[ModelCapability::Text],
            context_window: Some(200_000),
            max_output_tokens: Some(128_000),
        },
    ),
    (
        "glm-4.6",
        BuiltInModel {
            provider: "glm",
            base_url: "https://open.bigmodel.cn/api/anthropic",
            capabilities: &[ModelCapability::Text],
            context_window: Some(200_000),
            max_output_tokens: Some(128_000),
        },
    ),
    (
        "glm-4.5-airx",
        BuiltInModel {
            provider: "glm",
            base_url: "https://open.bigmodel.cn/api/anthropic",
            capabilities: &[ModelCapability::Text],
            context_window: Some(128_000),
            max_output_tokens: Some(96_000),
        },
    ),
    (
        "glm-4-long",
        BuiltInModel {
            provider: "glm",
            base_url: "https://open.bigmodel.cn/api/anthropic",
            capabilities: &[ModelCapability::Text],
            context_window: Some(1_000_000),
            max_output_tokens: Some(4_096),
        },
    ),
    (
        "glm-4.6v",
        BuiltInModel {
            provider: "glm",
            base_url: "https://open.bigmodel.cn/api/anthropic",
            capabilities: &[ModelCapability::Text, ModelCapability::Vision],
            context_window: Some(128_000),
            max_output_tokens: Some(32_768),
        },
    ),
    (
        "glm-4.5-air",
        BuiltInModel {
            provider: "glm",
            base_url: "https://open.bigmodel.cn/api/anthropic",
            capabilities: &[ModelCapability::Text],
            context_window: Some(200_000),
            max_output_tokens: Some(96_000),
        },
    ),
    (
        "glm-4.5v",
        BuiltInModel {
            provider: "glm",
            base_url: "https://open.bigmodel.cn/api/anthropic",
            capabilities: &[ModelCapability::Text, ModelCapability::Vision],
            context_window: Some(128_000),
            max_output_tokens: Some(16_384),
        },
    ),
    // --- Anthropic 官方 ---
    (
        "claude-opus-4-8",
        BuiltInModel {
            provider: "anthropic",
            base_url: "https://api.anthropic.com",
            capabilities: &[ModelCapability::Text],
            context_window: Some(1_000_000),
            max_output_tokens: Some(128_000),
        },
    ),
    (
        "claude-opus-4-7",
        BuiltInModel {
            provider: "anthropic",
            base_url: "https://api.anthropic.com",
            capabilities: &[ModelCapability::Text],
            context_window: Some(1_000_000),
            max_output_tokens: Some(128_000),
        },
    ),
    (
        "claude-opus-4-6",
        BuiltInModel {
            provider: "anthropic",
            base_url: "https://api.anthropic.com",
            capabilities: &[ModelCapability::Text],
            context_window: Some(1_000_000),
            max_output_tokens: Some(128_000),
        },
    ),
    (
        "claude-sonnet-4-6",
        BuiltInModel {
            provider: "anthropic",
            base_url: "https://api.anthropic.com",
            capabilities: &[ModelCapability::Text],
            context_window: Some(1_000_000),
            max_output_tokens: Some(64_000),
        },
    ),
    (
        "claude-haiku-4-5",
        BuiltInModel {
            provider: "anthropic",
            base_url: "https://api.anthropic.com",
            capabilities: &[ModelCapability::Text],
            context_window: Some(200_000),
            max_output_tokens: Some(64_000),
        },
    ),
    (
        "claude-opus-4-1",
        BuiltInModel {
            provider: "anthropic",
            base_url: "https://api.anthropic.com",
            capabilities: &[ModelCapability::Text],
            context_window: Some(200_000),
            max_output_tokens: Some(32_768),
        },
    ),
    // --- MiniMax ---
    (
        "MiniMax-M3",
        BuiltInModel {
            provider: "minimax",
            base_url: "https://api.minimaxi.com/anthropic",
            capabilities: &[ModelCapability::Text, ModelCapability::Vision],
            context_window: Some(1_000_000),
            max_output_tokens: Some(128_000),
        },
    ),
    (
        "MiniMax-M2.7",
        BuiltInModel {
            provider: "minimax",
            base_url: "https://api.minimaxi.com/anthropic",
            capabilities: &[ModelCapability::Text],
            context_window: Some(204_800),
            max_output_tokens: Some(131_072),
        },
    ),
    (
        "MiniMax-M2.7-highspeed",
        BuiltInModel {
            provider: "minimax",
            base_url: "https://api.minimaxi.com/anthropic",
            capabilities: &[ModelCapability::Text],
            context_window: Some(204_800),
            max_output_tokens: Some(131_072),
        },
    ),
    (
        "MiniMax-M2.5",
        BuiltInModel {
            provider: "minimax",
            base_url: "https://api.minimaxi.com/anthropic",
            capabilities: &[ModelCapability::Text],
            context_window: Some(204_800),
            max_output_tokens: Some(131_072),
        },
    ),
    (
        "MiniMax-M2.1",
        BuiltInModel {
            provider: "minimax",
            base_url: "https://api.minimaxi.com/anthropic",
            capabilities: &[ModelCapability::Text],
            context_window: Some(204_800),
            max_output_tokens: Some(131_072),
        },
    ),
    (
        "MiniMax-M2",
        BuiltInModel {
            provider: "minimax",
            base_url: "https://api.minimaxi.com/anthropic",
            capabilities: &[ModelCapability::Text],
            context_window: Some(204_800),
            max_output_tokens: Some(131_072),
        },
    ),
    // --- Kimi 月之暗面 ---
    (
        "kimi-for-coding",
        BuiltInModel {
            provider: "kimi",
            base_url: "https://api.moonshot.cn/anthropic",
            capabilities: &[ModelCapability::Text, ModelCapability::Vision],
            context_window: Some(256_000),
            max_output_tokens: Some(32_768),
        },
    ),
    (
        "kimi-k2.6",
        BuiltInModel {
            provider: "kimi",
            base_url: "https://api.moonshot.cn/anthropic",
            capabilities: &[ModelCapability::Text, ModelCapability::Vision],
            context_window: Some(256_000),
            max_output_tokens: Some(32_768),
        },
    ),
    (
        "kimi-k2.5",
        BuiltInModel {
            provider: "kimi",
            base_url: "https://api.moonshot.cn/anthropic",
            capabilities: &[ModelCapability::Text, ModelCapability::Vision],
            context_window: Some(256_000),
            max_output_tokens: Some(32_768),
        },
    ),
    // --- Doubao 火山引擎 ---
    (
        "doubao-seed-code",
        BuiltInModel {
            provider: "doubao",
            base_url: "https://ark.cn-beijing.volces.com/api/compatible",
            capabilities: &[ModelCapability::Text, ModelCapability::Vision],
            context_window: Some(256_000),
            max_output_tokens: Some(32_768),
        },
    ),
    (
        "doubao-seed-2-0-pro",
        BuiltInModel {
            provider: "doubao",
            base_url: "https://ark.cn-beijing.volces.com/api/compatible",
            capabilities: &[ModelCapability::Text, ModelCapability::Vision],
            context_window: Some(256_000),
            max_output_tokens: Some(128_000),
        },
    ),
    (
        "doubao-seed-2-0-lite",
        BuiltInModel {
            provider: "doubao",
            base_url: "https://ark.cn-beijing.volces.com/api/compatible",
            capabilities: &[ModelCapability::Text, ModelCapability::Vision],
            context_window: Some(256_000),
            max_output_tokens: Some(128_000),
        },
    ),
    (
        "doubao-seed-2-0-mini",
        BuiltInModel {
            provider: "doubao",
            base_url: "https://ark.cn-beijing.volces.com/api/compatible",
            capabilities: &[ModelCapability::Text, ModelCapability::Vision],
            context_window: Some(256_000),
            max_output_tokens: Some(128_000),
        },
    ),
    (
        "doubao-seed-2-0-code-preview",
        BuiltInModel {
            provider: "doubao",
            base_url: "https://ark.cn-beijing.volces.com/api/compatible",
            capabilities: &[ModelCapability::Text, ModelCapability::Vision],
            context_window: Some(256_000),
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
        assert_eq!(
            info.capabilities,
            &[ModelCapability::Text, ModelCapability::Vision]
        );
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
        // 新 provider 模型
        assert!(names.contains(&"claude-opus-4-7"));
        assert!(names.contains(&"MiniMax-M3"));
        assert!(names.contains(&"kimi-for-coding"));
        assert!(names.contains(&"doubao-seed-code"));
        assert_eq!(names.len(), 36);
    }

    #[test]
    fn test_get_model_info_anthropic() {
        let info = get_model_info("claude-opus-4-7").unwrap();
        assert_eq!(info.provider, "anthropic");
        assert_eq!(info.base_url, "https://api.anthropic.com");
        assert_eq!(info.capabilities, &[ModelCapability::Text]);
        assert_eq!(info.context_window, Some(1_000_000));
        assert_eq!(info.max_output_tokens, Some(128_000));
    }

    #[test]
    fn test_get_model_info_minimax() {
        let info = get_model_info("MiniMax-M3").unwrap();
        assert_eq!(info.provider, "minimax");
        assert_eq!(info.base_url, "https://api.minimaxi.com/anthropic");
        assert_eq!(
            info.capabilities,
            &[ModelCapability::Text, ModelCapability::Vision]
        );
        assert_eq!(info.context_window, Some(1_000_000));
    }

    #[test]
    fn test_get_model_info_kimi() {
        let info = get_model_info("kimi-for-coding").unwrap();
        assert_eq!(info.provider, "kimi");
        assert_eq!(info.base_url, "https://api.moonshot.cn/anthropic");
        assert_eq!(
            info.capabilities,
            &[ModelCapability::Text, ModelCapability::Vision]
        );
        assert_eq!(info.context_window, Some(256_000));
    }

    #[test]
    fn test_get_model_info_doubao() {
        let info = get_model_info("doubao-seed-code").unwrap();
        assert_eq!(info.provider, "doubao");
        assert_eq!(
            info.base_url,
            "https://ark.cn-beijing.volces.com/api/compatible"
        );
        assert_eq!(
            info.capabilities,
            &[ModelCapability::Text, ModelCapability::Vision]
        );
        assert_eq!(info.context_window, Some(256_000));
    }

    #[test]
    fn test_all_models_have_valid_metadata() {
        for name in get_built_in_model_names() {
            let info = get_model_info(name).unwrap();
            assert!(!info.provider.is_empty(), "模型 {} 的 provider 为空", name);
            assert!(!info.base_url.is_empty(), "模型 {} 的 base_url 为空", name);
            assert!(
                info.capabilities.contains(&ModelCapability::Text),
                "模型 {} 缺少 Text 能力",
                name
            );
            assert!(
                info.context_window.is_some_and(|n| n > 0),
                "模型 {} 的 context_window 应大于 0",
                name
            );
            assert!(
                info.max_output_tokens.is_some_and(|n| n > 0),
                "模型 {} 的 max_output_tokens 应大于 0",
                name
            );
        }
    }

    #[test]
    fn test_model_capability_equality() {
        assert_eq!(ModelCapability::Text, ModelCapability::Text);
        assert_eq!(ModelCapability::Vision, ModelCapability::Vision);
        assert_ne!(ModelCapability::Text, ModelCapability::Vision);
    }
}

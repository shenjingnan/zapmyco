//! Agent 配置。
//!
//! `AgentConfig` 包含 Agent 运行所需的所有参数，
//! 通过依赖注入方式传入 Core 层，不读取任何外部配置。

use crate::core::AgentTool;

/// Agent 运行配置
///
/// 所有外部依赖通过此结构注入 Core 层，
/// Core 层不依赖文件系统、环境变量或任何特定环境。
pub struct AgentConfig {
    // ==================== LLM 相关 ====================
    /// 模型名称
    pub model: String,
    /// API Key
    pub api_key: String,
    /// API 端点
    pub base_url: String,
    /// API 版本
    pub api_version: String,
    /// 最大输出 tokens
    pub max_tokens: u32,

    // ==================== 提示词 ====================
    /// 系统提示词
    pub system_prompt: String,

    // ==================== 工具 ====================
    /// 注册的工具列表
    pub tools: Vec<Box<dyn AgentTool>>,

    // ==================== 循环控制 ====================
    /// 最大工具调用轮次
    pub max_tool_rounds: u32,

    // ==================== 扩展特性 ====================
    /// 是否启用 Extended Thinking
    pub thinking_enabled: bool,
}

impl AgentConfig {
    /// 创建基础配置
    ///
    /// # 参数
    /// - `model`: 模型名称
    /// - `api_key`: API Key
    /// - `base_url`: API 端点地址
    pub fn new(
        model: impl Into<String>,
        api_key: impl Into<String>,
        base_url: impl Into<String>,
    ) -> Self {
        Self {
            model: model.into(),
            api_key: api_key.into(),
            base_url: base_url.into(),
            api_version: String::from("2023-06-01"),
            max_tokens: 4096,
            system_prompt: String::new(),
            tools: Vec::new(),
            max_tool_rounds: 50,
            thinking_enabled: true,
        }
    }

    /// 设置 API 版本
    pub fn with_api_version(mut self, version: impl Into<String>) -> Self {
        self.api_version = version.into();
        self
    }

    /// 设置最大输出 tokens
    pub fn with_max_tokens(mut self, max_tokens: u32) -> Self {
        self.max_tokens = max_tokens;
        self
    }

    /// 设置系统提示词
    pub fn with_system_prompt(mut self, prompt: impl Into<String>) -> Self {
        self.system_prompt = prompt.into();
        self
    }

    /// 注册工具列表
    pub fn with_tools(mut self, tools: Vec<Box<dyn AgentTool>>) -> Self {
        self.tools = tools;
        self
    }

    /// 设置最大工具调用轮次
    pub fn with_max_tool_rounds(mut self, rounds: u32) -> Self {
        self.max_tool_rounds = rounds;
        self
    }

    /// 开关 Extended Thinking
    pub fn with_thinking(mut self, enabled: bool) -> Self {
        self.thinking_enabled = enabled;
        self
    }
}

impl Clone for AgentConfig {
    fn clone(&self) -> Self {
        let tools: Vec<Box<dyn AgentTool>> = Vec::new();
        // 注意：工具无法直接 clone，新 Vec 为空
        // 调用者需要重新注册工具
        Self {
            model: self.model.clone(),
            api_key: self.api_key.clone(),
            base_url: self.base_url.clone(),
            api_version: self.api_version.clone(),
            max_tokens: self.max_tokens,
            system_prompt: self.system_prompt.clone(),
            tools,
            max_tool_rounds: self.max_tool_rounds,
            thinking_enabled: self.thinking_enabled,
        }
    }
}

impl std::fmt::Debug for AgentConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AgentConfig")
            .field("model", &self.model)
            .field("api_key", &"***")
            .field("base_url", &self.base_url)
            .field("api_version", &self.api_version)
            .field("max_tokens", &self.max_tokens)
            .field("system_prompt", &self.system_prompt)
            .field("tools", &format!("{} tools", self.tools.len()))
            .field("max_tool_rounds", &self.max_tool_rounds)
            .field("thinking_enabled", &self.thinking_enabled)
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_with_new() {
        let config = AgentConfig::new("test-model", "test-key", "https://api.test.com");
        assert_eq!(config.model, "test-model");
        assert_eq!(config.api_key, "test-key");
        assert_eq!(config.base_url, "https://api.test.com");
        assert_eq!(config.api_version, "2023-06-01");
        assert_eq!(config.max_tokens, 4096);
        assert!(config.system_prompt.is_empty());
        assert!(config.tools.is_empty());
        assert_eq!(config.max_tool_rounds, 50);
        assert!(config.thinking_enabled);
    }

    #[test]
    fn test_builder_methods() {
        let config = AgentConfig::new("model", "key", "https://api.test.com")
            .with_api_version("2024-01-01")
            .with_max_tokens(8192)
            .with_system_prompt("You are a helpful assistant")
            .with_max_tool_rounds(10)
            .with_thinking(false);

        assert_eq!(config.api_version, "2024-01-01");
        assert_eq!(config.max_tokens, 8192);
        assert_eq!(config.system_prompt, "You are a helpful assistant");
        assert_eq!(config.max_tool_rounds, 10);
        assert!(!config.thinking_enabled);
    }

    #[test]
    fn test_clone() {
        let config = AgentConfig::new("model", "key", "https://api.test.com")
            .with_max_tokens(8192)
            .with_system_prompt("Hello");

        let cloned = config.clone();
        assert_eq!(cloned.model, config.model);
        assert_eq!(cloned.api_key, config.api_key);
        assert_eq!(cloned.base_url, config.base_url);
        assert_eq!(cloned.max_tokens, config.max_tokens);
        assert_eq!(cloned.system_prompt, config.system_prompt);
    }

    #[test]
    fn test_debug() {
        let config = AgentConfig::new("model", "secret-key", "https://api.test.com");
        let debug = format!("{:?}", config);
        assert!(debug.contains("model"));
        // API Key 在 Debug 输出中应该被隐藏
        assert!(!debug.contains("secret-key"));
        assert!(debug.contains("***"));
        assert!(!debug.is_empty());
    }
}

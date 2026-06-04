pub mod models;
pub mod settings;

// 旧路径兼容: zapmyco::settings::* → zapmyco::config::settings::*
pub use settings::{
    ConversationLogSettings, LlmSettings, ProviderConfig, Settings, display_settings, get_home_dir,
    get_settings_dir, get_settings_path, is_conversation_log_enabled, load_settings,
    resolve_env_ref, update_settings_model,
};

// 旧路径兼容: zapmyco::models::* → zapmyco::config::models::*
pub use models::{
    BuiltInModel, ModelCapability, get_built_in_model_names, get_model_info,
    guess_provider_from_model_name,
};

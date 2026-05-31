pub mod run_command;
pub mod web_fetch;
pub mod web_search;

// 旧路径兼容: zapmyco::web_fetch::* → zapmyco::tools::web_fetch::*
pub use web_fetch::{WebFetch, WebFetchError, WebFetchOptions};

// 旧路径兼容: zapmyco::web_search::* → zapmyco::tools::web_search::*
pub use web_search::{WebSearch, tool_description};

// 旧路径兼容: zapmyco::run_command::* → zapmyco::tools::run_command::*
pub use run_command::{RunCommand, RunCommandError, RunCommandOptions};

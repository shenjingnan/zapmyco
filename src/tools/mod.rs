pub mod edit;
pub mod glob;
pub mod grep;
pub mod read;
pub mod run_command;
pub mod web_fetch;
pub mod web_search;

// 旧路径兼容: zapmyco::glob::* → zapmyco::tools::glob::*
pub use edit::{Edit, EditOptions};
pub use glob::{Glob, GlobOptions};

// 旧路径兼容: zapmyco::grep::* → zapmyco::tools::grep::*
pub use grep::{Grep, GrepOptions};
pub use zapmyco_grep::GrepError;

// 旧路径兼容: zapmyco::web_fetch::* → zapmyco::tools::web_fetch::*
pub use web_fetch::{WebFetch, WebFetchError, WebFetchOptions};

// 旧路径兼容: zapmyco::web_search::* → zapmyco::tools::web_search::*
pub use web_search::{WebSearch, tool_description};

// 旧路径兼容: zapmyco::run_command::* → zapmyco::tools::run_command::*
pub use run_command::{RunCommand, RunCommandError, RunCommandOptions};

// 旧路径兼容: zapmyco::read::* → zapmyco::tools::read::*
pub use read::{Read, ReadOptions};

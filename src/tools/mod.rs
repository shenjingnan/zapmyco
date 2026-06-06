// 内部工具模块，标记为 doc(hidden) 以避免 cargo-semver-checks 将内部重构误报为 breaking change
#[doc(hidden)]
pub mod ask_user;
#[doc(hidden)]
pub mod file_edit;
#[doc(hidden)]
pub mod file_find;
#[doc(hidden)]
pub mod file_read;
#[doc(hidden)]
pub mod file_search;
#[doc(hidden)]
pub mod file_write;
#[doc(hidden)]
pub mod prompt;
#[doc(hidden)]
pub mod shell_exec;
#[doc(hidden)]
pub mod subagent;
#[doc(hidden)]
pub mod task_create;
#[doc(hidden)]
pub mod task_display;
#[doc(hidden)]
pub mod task_get;
#[doc(hidden)]
pub mod task_list;
#[doc(hidden)]
pub mod task_manager;
#[doc(hidden)]
pub mod task_update;
#[doc(hidden)]
pub mod web_fetch;
#[doc(hidden)]
pub mod web_search;

#[doc(hidden)]
pub use file_edit::{FileEdit, FileEditOptions};
#[doc(hidden)]
pub use file_find::{FileFind, FileFindOptions};

// 旧路径兼容: zapmyco::grep::* → zapmyco::tools::file_search::*
#[doc(hidden)]
pub use file_search::{FileSearch, FileSearchOptions};
#[doc(hidden)]
pub use file_write::{FileWrite, FileWriteOptions};
#[doc(hidden)]
pub use zapmyco_grep::GrepError;

#[doc(hidden)]
pub use file_read::{FileRead, FileReadOptions};

// 旧路径兼容: zapmyco::run_command::* → zapmyco::tools::shell_exec::*
#[doc(hidden)]
pub use shell_exec::{ShellExec, ShellExecError, ShellExecOptions};

// 旧路径兼容: zapmyco::web_fetch::* → zapmyco::tools::web_fetch::*
#[doc(hidden)]
pub use web_fetch::{WebFetch, WebFetchError, WebFetchOptions};

// 旧路径兼容: zapmyco::web_search::* → zapmyco::tools::web_search::*
#[doc(hidden)]
pub use web_search::{WebSearch, tool_description};

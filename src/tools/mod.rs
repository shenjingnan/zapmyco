pub mod file_edit;
pub mod file_find;
pub mod file_read;
pub mod file_search;
pub mod shell_exec;
pub mod web_fetch;
pub mod web_search;

pub use file_edit::{FileEdit, FileEditOptions};
pub use file_find::{FileFind, FileFindOptions};

// 旧路径兼容: zapmyco::grep::* → zapmyco::tools::file_search::*
pub use file_search::{FileSearch, FileSearchOptions};
pub use zapmyco_grep::GrepError;

pub use file_read::{FileRead, FileReadOptions};

// 旧路径兼容: zapmyco::run_command::* → zapmyco::tools::shell_exec::*
pub use shell_exec::{ShellExec, ShellExecError, ShellExecOptions};

// 旧路径兼容: zapmyco::web_fetch::* → zapmyco::tools::web_fetch::*
pub use web_fetch::{WebFetch, WebFetchError, WebFetchOptions};

// 旧路径兼容: zapmyco::web_search::* → zapmyco::tools::web_search::*
pub use web_search::{WebSearch, tool_description};

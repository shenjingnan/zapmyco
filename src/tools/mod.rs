// 工具模块。文件/Web/任务/审批 工具已迁移至独立 crate `zapmyco-tools`，
// 此处保留为向后兼容的重导出门面（doc(hidden)），使 `zapmyco::tools::*` 路径不变。
// 尚未迁移的 C 类工具（ask_user/shell_exec/web_search/subagent/skill）仍在主 crate 内实现。

// ── 已迁移至 zapmyco-tools 的模块（经重导出保持 crate::tools::* 路径）──
#[doc(hidden)]
pub use zapmyco_tools::confirm;
#[doc(hidden)]
pub use zapmyco_tools::file_edit;
#[doc(hidden)]
pub use zapmyco_tools::file_find;
#[doc(hidden)]
pub use zapmyco_tools::file_read;
#[doc(hidden)]
pub use zapmyco_tools::file_search;
#[doc(hidden)]
pub use zapmyco_tools::file_write;
#[doc(hidden)]
pub use zapmyco_tools::task_create;
#[doc(hidden)]
pub use zapmyco_tools::task_display;
#[doc(hidden)]
pub use zapmyco_tools::task_get;
#[doc(hidden)]
pub use zapmyco_tools::task_list;
#[doc(hidden)]
pub use zapmyco_tools::task_manager;
#[doc(hidden)]
pub use zapmyco_tools::task_update;
#[doc(hidden)]
pub use zapmyco_tools::web_fetch;

// ── 尚未迁移的模块（保持主 crate 内实现）──
#[doc(hidden)]
pub mod ask_user;
#[doc(hidden)]
pub mod prompt;
#[doc(hidden)]
pub mod shell_exec;
#[doc(hidden)]
pub mod skill;
#[doc(hidden)]
pub mod subagent;
#[doc(hidden)]
pub mod web_search;

// ── 旧路径兼容重导出（与迁移前逐一对应）──
#[doc(hidden)]
pub use zapmyco_tools::{
    GrepError,
    file_edit::{FileEdit, FileEditOptions},
    file_find::{FileFind, FileFindOptions},
    file_read::{FileRead, FileReadOptions},
    file_search::{FileSearch, FileSearchOptions},
    file_write::{FileWrite, FileWriteOptions},
    web_fetch::{WebFetch, WebFetchError, WebFetchOptions},
};

// 旧路径兼容: zapmyco::run_command::* → zapmyco::tools::shell_exec::*
#[doc(hidden)]
pub use shell_exec::{ShellExec, ShellExecError, ShellExecOptions};

// 旧路径兼容: zapmyco::web_search::* → zapmyco::tools::web_search::*
#[doc(hidden)]
pub use web_search::{WebSearch, tool_description};

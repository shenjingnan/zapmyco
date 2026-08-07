// 工具模块。全部工具已迁移至独立 crate `zapmyco-tools`，
// 此处保留为向后兼容的重导出门面（doc(hidden)），使 `zapmyco::tools::*` 路径不变。

// ── 已迁移至 zapmyco-tools 的模块（经重导出保持 crate::tools::* 路径）──
#[doc(hidden)]
pub use zapmyco_tools::ask_user;
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
pub use zapmyco_tools::shell_exec;
#[doc(hidden)]
pub use zapmyco_tools::skill;
#[doc(hidden)]
pub use zapmyco_tools::subagent;
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
#[doc(hidden)]
pub use zapmyco_tools::web_search;

// ── 旧路径兼容重导出（与迁移前逐一对应）──
#[doc(hidden)]
pub use zapmyco_tools::{
    GrepError,
    file_edit::{FileEdit, FileEditOptions},
    file_find::{FileFind, FileFindOptions},
    file_read::{FileRead, FileReadOptions},
    file_search::{FileSearch, FileSearchOptions},
    file_write::{FileWrite, FileWriteOptions},
    shell_exec::{ShellExec, ShellExecError, ShellExecOptions},
    web_fetch::{WebFetch, WebFetchError, WebFetchOptions},
    web_search::{WebSearch, tool_description},
};

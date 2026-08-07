//! 模型注册表已迁移至独立 crate `zapmyco-providers`。
//! 此处保留为向后兼容的重导出门面，`zapmyco::config::models::*` 路径不变。
#![allow(dead_code)]

pub use zapmyco_providers::models::*;

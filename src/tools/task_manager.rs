// Task 核心数据层 — 数据模型、文件持久化、并发锁、CRUD
//
// 本模块是 Task 系统的基础，负责：
// - 定义 Task / TaskStatus / TaskUpdate 数据结构
// - 文件级持久化（JSON 每任务一文件）
// - 基于 fs4 的跨进程文件锁（flock）
// - 自增 ID 生成（高水位文件）
// - 预留多 Agent 扩展点

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use thiserror::Error;

// ---------------------------------------------------------------------------
// Data Model
// ---------------------------------------------------------------------------

/// 任务状态
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Pending,
    InProgress,
    Completed,
}

impl TaskStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            TaskStatus::Pending => "pending",
            TaskStatus::InProgress => "in_progress",
            TaskStatus::Completed => "completed",
        }
    }
}

impl std::fmt::Display for TaskStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl std::str::FromStr for TaskStatus {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "pending" => Ok(TaskStatus::Pending),
            "in_progress" => Ok(TaskStatus::InProgress),
            "completed" => Ok(TaskStatus::Completed),
            _ => Err(format!("无效的任务状态: {}", s)),
        }
    }
}

/// 核心任务模型 — 每个任务序列化为一个 JSON 文件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub subject: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_form: Option<String>,
    pub status: TaskStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,
    #[serde(default)]
    pub blocks: Vec<String>,
    #[serde(default)]
    pub blocked_by: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Map<String, serde_json::Value>>,
}

impl Task {
    /// 格式化为一行摘要（用于 task_list）
    pub fn summary_line(&self) -> String {
        let status_tag = match self.status {
            TaskStatus::Pending => "[pending]",
            TaskStatus::InProgress => "[in_progress]",
            TaskStatus::Completed => "[completed]",
        };
        let owner = self
            .owner
            .as_ref()
            .map(|o| format!(" ({})", o))
            .unwrap_or_default();
        let blocked = if !self.blocked_by.is_empty() {
            format!(" [blocked by {}]", self.blocked_by.join(", "))
        } else {
            String::new()
        };
        format!(
            "#{} {} {}{}{}",
            self.id, status_tag, self.subject, owner, blocked
        )
    }

    /// 格式化为详细视图（用于 task_get）
    pub fn detail(&self) -> String {
        let mut lines = vec![
            format!("Task #{}: {}", self.id, self.subject),
            format!("Status: {}", self.status.as_str()),
            format!("Description: {}", self.description),
        ];
        if let Some(ref af) = self.active_form {
            lines.push(format!("Active form: {}", af));
        }
        if let Some(ref o) = self.owner {
            lines.push(format!("Owner: {}", o));
        }
        if !self.blocked_by.is_empty() {
            lines.push(format!("Blocked by: #{}", self.blocked_by.join(", #")));
        }
        if !self.blocks.is_empty() {
            lines.push(format!("Blocks: #{}", self.blocks.join(", #")));
        }
        lines.join("\n")
    }
}

/// 部分更新结构（用于 task_update 合并字段）
#[derive(Debug, Default)]
pub struct TaskUpdate {
    pub subject: Option<String>,
    pub description: Option<String>,
    pub active_form: Option<String>,
    pub status: Option<TaskStatus>,
    pub owner: Option<String>,
    pub add_blocks: Vec<String>,
    pub add_blocked_by: Vec<String>,
    pub metadata: Option<serde_json::Map<String, serde_json::Value>>,
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

#[derive(Debug, Error)]
pub enum TaskError {
    #[error("任务不存在: {0}")]
    NotFound(String),
    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON 序列化错误: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("错误: {0}")]
    Lock(String),
    #[error("spawn_blocking 失败: {0}")]
    Join(String),
}

// ---------------------------------------------------------------------------
// LockGuard
// ---------------------------------------------------------------------------

/// RAII 锁守卫：drop 时关闭 fd → flock 自动释放锁
struct LockGuard {
    _file: Option<std::fs::File>,
}

// std::fs::File 是 Send，因此 LockGuard 也是 Send
// 这允许 LockGuard 跨越 .await 点在 tokio 任务间传递
// SAFETY: File 在多线程间转移不会导致未定义行为
unsafe impl Send for LockGuard {}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// 默认 task list ID（单 Agent 模式）
pub const DEFAULT_LIST_ID: &str = "default";

// ---------------------------------------------------------------------------
// TaskManager
// ---------------------------------------------------------------------------

/// Task 管理器
///
/// 职责
/// - CRUD 全生命期管理
/// - 文件级持久化到 ~/.zapmyco/tasks/{list_id}/
/// - 跨进程文件锁（flock）保证并发安全
///
/// 设计
/// - 写操作（create/update/delete）先获取列表级排他锁
/// - 读操作（get/list）无锁（最终一致性可接受）
/// - TaskManager 本身无可变状态，所有方法均为 &self
pub struct TaskManager {
    list_id: String,
    base_dir: PathBuf,
}

impl TaskManager {
    /// 使用默认 list_id 创建（单 Agent 模式）
    pub fn new() -> Self {
        Self {
            list_id: DEFAULT_LIST_ID.to_string(),
            base_dir: crate::config::settings::get_settings_dir().join("tasks"),
        }
    }

    /// 指定 list_id 创建（多 Agent 模式预留）
    pub fn with_list_id(list_id: &str) -> Self {
        Self {
            list_id: list_id.to_string(),
            base_dir: crate::config::settings::get_settings_dir().join("tasks"),
        }
    }

    // ---- 路径辅助 ----

    /// 列表目录：~/.zapmyco/tasks/{list_id}/
    fn list_dir(&self) -> PathBuf {
        self.base_dir.join(&self.list_id)
    }

    /// 锁文件：~/.zapmyco/tasks/{list_id}/.lock
    fn lock_path(&self) -> PathBuf {
        self.list_dir().join(".lock")
    }

    /// 高水位文件：~/.zapmyco/tasks/{list_id}/.highwatermark
    fn high_water_mark_path(&self) -> PathBuf {
        self.list_dir().join(".highwatermark")
    }

    /// 任务文件：~/.zapmyco/tasks/{list_id}/{id}.json
    fn task_path(&self, id: &str) -> PathBuf {
        self.list_dir().join(format!("{}.json", id))
    }

    /// 创建列表目录（如不存在）
    async fn ensure_dirs(&self) -> Result<(), TaskError> {
        tokio::fs::create_dir_all(self.list_dir()).await?;
        Ok(())
    }

    // ---- 高水位管理 ----

    /// 读取当前最大任务 ID
    async fn read_high_water_mark(&self) -> Result<u64, TaskError> {
        let path = self.high_water_mark_path();
        match tokio::fs::read_to_string(&path).await {
            Ok(content) => Ok(content.trim().parse::<u64>().unwrap_or(0)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(0),
            Err(e) => Err(TaskError::Io(e)),
        }
    }

    /// 写入高水位
    async fn write_high_water_mark(&self, value: u64) -> Result<(), TaskError> {
        tokio::fs::write(self.high_water_mark_path(), value.to_string()).await?;
        Ok(())
    }

    // ---- 文件锁 ----

    /// 获取列表级排他锁
    ///
    /// flock(LOCK_EX) 是阻塞系统调用，因此在线程池中执行。
    /// 锁持有人完成操作后，LockGuard drop 时自动解锁。
    async fn acquire_lock(&self) -> Result<LockGuard, TaskError> {
        self.ensure_dirs().await?;
        let lock_path = self.lock_path();

        let file = tokio::task::spawn_blocking(move || {
            let file = std::fs::OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(false)
                .read(true)
                .open(&lock_path)?;
            file.lock()?;
            Ok::<_, TaskError>(file)
        })
        .await
        .map_err(|e| TaskError::Join(format!("spawn_blocking 失败: {}", e)))??;

        Ok(LockGuard { _file: Some(file) })
    }

    // ---- CRUD ----

    /// 创建任务
    pub async fn create(
        &self,
        subject: &str,
        description: &str,
        active_form: Option<&str>,
        metadata: Option<serde_json::Map<String, serde_json::Value>>,
    ) -> Result<Task, TaskError> {
        let _lock = self.acquire_lock().await?;

        let hwm = self.read_high_water_mark().await?;
        let new_id = hwm + 1;
        let id_str = new_id.to_string();

        let task = Task {
            id: id_str.clone(),
            subject: subject.to_string(),
            description: description.to_string(),
            active_form: active_form.map(|s| s.to_string()),
            status: TaskStatus::Pending,
            owner: None,
            blocks: Vec::new(),
            blocked_by: Vec::new(),
            metadata,
        };

        let content = serde_json::to_string_pretty(&task)?;
        tokio::fs::write(self.task_path(&id_str), &content).await?;
        self.write_high_water_mark(new_id).await?;

        // _lock 在此方法结束时 drop → 自动解锁
        Ok(task)
    }

    /// 获取单个任务
    pub async fn get(&self, id: &str) -> Result<Option<Task>, TaskError> {
        let path = self.task_path(id);
        match tokio::fs::read_to_string(&path).await {
            Ok(content) => {
                let task: Task = serde_json::from_str(&content)?;
                Ok(Some(task))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(TaskError::Io(e)),
        }
    }

    /// 列出所有任务（按 ID 数值升序）
    pub async fn list(&self) -> Result<Vec<Task>, TaskError> {
        let dir_path = self.list_dir();
        if !tokio::fs::try_exists(&dir_path).await.unwrap_or(false) {
            return Ok(Vec::new());
        }
        let mut dir = tokio::fs::read_dir(&dir_path).await?;
        let mut tasks = Vec::new();

        while let Some(entry) = dir.next_entry().await? {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
                // 跳过 .lock / .highwatermark 等隐藏文件
                if stem.starts_with('.') {
                    continue;
                }
                if let Ok(content) = tokio::fs::read_to_string(&path).await
                    && let Ok(task) = serde_json::from_str::<Task>(&content)
                {
                    tasks.push(task);
                }
            }
        }

        tasks.sort_by_cached_key(|t| t.id.parse::<u64>().unwrap_or(0));
        Ok(tasks)
    }

    /// 更新任务（合并更新模式）
    ///
    /// 只更新 updates 中 Some/非空的字段。
    /// add_blocks / add_blocked_by 是追加而非覆盖。
    pub async fn update(&self, id: &str, updates: TaskUpdate) -> Result<Task, TaskError> {
        let _lock = self.acquire_lock().await?;

        let mut task = self
            .get(id)
            .await?
            .ok_or_else(|| TaskError::NotFound(id.to_string()))?;

        // 逐字段合并
        if let Some(v) = updates.subject {
            task.subject = v;
        }
        if let Some(v) = updates.description {
            task.description = v;
        }
        if let Some(v) = updates.active_form {
            task.active_form = Some(v);
        }
        if let Some(v) = updates.status {
            task.status = v;
        }
        if let Some(v) = updates.owner {
            task.owner = Some(v);
        }
        for block_id in updates.add_blocks {
            if !task.blocks.contains(&block_id) {
                task.blocks.push(block_id);
            }
        }
        for block_id in updates.add_blocked_by {
            if !task.blocked_by.contains(&block_id) {
                task.blocked_by.push(block_id);
            }
        }
        if let Some(v) = updates.metadata {
            let mut merged = task.metadata.unwrap_or_default();
            for (key, value) in v {
                if value.is_null() {
                    merged.remove(&key);
                } else {
                    merged.insert(key, value);
                }
            }
            task.metadata = if merged.is_empty() {
                None
            } else {
                Some(merged)
            };
        }

        let content = serde_json::to_string_pretty(&task)?;
        tokio::fs::write(self.task_path(id), &content).await?;

        Ok(task)
    }

    /// 删除任务文件
    pub async fn delete(&self, id: &str) -> Result<bool, TaskError> {
        let _lock = self.acquire_lock().await?;

        let path = self.task_path(id);
        match tokio::fs::remove_file(&path).await {
            Ok(()) => Ok(true),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(e) => Err(TaskError::Io(e)),
        }
    }

    // =============================================================
    // 多 Agent 扩展点（Phase 2+ 实现）
    // =============================================================
    // claim_task()       — 原子认领任务（带锁 + 忙碌检查）
    // unassign()         — 队友下线时释放其任务
    // get_agent_statuses() — 获取团队所有成员状态
    // block_task()       — 建立双向依赖关系
    // reset_list()       — 清空任务列表（swarm 场景）
    // =============================================================
}

impl Default for TaskManager {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::run_with_temp_home;

    #[test]
    fn test_create_and_get() {
        run_with_temp_home(|_home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let mgr = TaskManager::new();
                let task = mgr
                    .create("测试任务", "描述内容", Some("测试中"), None)
                    .await
                    .unwrap();
                assert_eq!(task.subject, "测试任务");
                assert_eq!(task.description, "描述内容");
                assert_eq!(task.active_form, Some("测试中".to_string()));
                assert_eq!(task.status, TaskStatus::Pending);
                assert!(task.owner.is_none());
                assert!(task.blocks.is_empty());
                assert!(task.blocked_by.is_empty());

                let fetched = mgr.get(&task.id).await.unwrap().unwrap();
                assert_eq!(fetched.subject, "测试任务");
                assert_eq!(fetched.active_form, Some("测试中".to_string()));
            });
        });
    }

    #[test]
    fn test_create_minimal() {
        run_with_temp_home(|_home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let mgr = TaskManager::new();
                let task = mgr.create("最小任务", "", None, None).await.unwrap();
                assert_eq!(task.id, "1");
                assert_eq!(task.subject, "最小任务");
                assert!(task.active_form.is_none());
                assert!(task.metadata.is_none());
            });
        });
    }

    #[test]
    fn test_get_not_found() {
        run_with_temp_home(|_home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let mgr = TaskManager::new();
                let result = mgr.get("999").await.unwrap();
                assert!(result.is_none());
            });
        });
    }

    #[test]
    fn test_list() {
        run_with_temp_home(|_home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let mgr = TaskManager::new();
                mgr.create("任务A", "", None, None).await.unwrap();
                mgr.create("任务B", "", None, None).await.unwrap();
                let tasks = mgr.list().await.unwrap();
                assert_eq!(tasks.len(), 2);
                assert_eq!(tasks[0].subject, "任务A");
                assert_eq!(tasks[1].subject, "任务B");
            });
        });
    }

    #[test]
    fn test_list_empty() {
        run_with_temp_home(|_home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let mgr = TaskManager::new();
                let tasks = mgr.list().await.unwrap();
                assert!(tasks.is_empty());
            });
        });
    }

    #[test]
    fn test_list_excludes_dot_files() {
        run_with_temp_home(|_home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let mgr = TaskManager::new();
                mgr.create("正常任务", "", None, None).await.unwrap();
                // 建一个隐藏文件模拟干扰
                let dir = mgr.list_dir();
                tokio::fs::write(dir.join(".hidden.json"), r#"{"id":"99"}"#)
                    .await
                    .unwrap();
                let tasks = mgr.list().await.unwrap();
                assert_eq!(tasks.len(), 1);
            });
        });
    }

    #[test]
    fn test_update_status() {
        run_with_temp_home(|_home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let mgr = TaskManager::new();
                let task = mgr.create("任务", "", None, None).await.unwrap();

                let updated = mgr
                    .update(
                        &task.id,
                        TaskUpdate {
                            status: Some(TaskStatus::InProgress),
                            ..Default::default()
                        },
                    )
                    .await
                    .unwrap();
                assert_eq!(updated.status, TaskStatus::InProgress);

                // 验证持久化
                let fetched = mgr.get(&task.id).await.unwrap().unwrap();
                assert_eq!(fetched.status, TaskStatus::InProgress);
            });
        });
    }

    #[test]
    fn test_update_completed() {
        run_with_temp_home(|_home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let mgr = TaskManager::new();
                let task = mgr.create("可完成的", "", None, None).await.unwrap();
                let updated = mgr
                    .update(
                        &task.id,
                        TaskUpdate {
                            status: Some(TaskStatus::Completed),
                            ..Default::default()
                        },
                    )
                    .await
                    .unwrap();
                assert_eq!(updated.status, TaskStatus::Completed);
            });
        });
    }

    #[test]
    fn test_update_dependencies() {
        run_with_temp_home(|_home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let mgr = TaskManager::new();
                let t1 = mgr.create("前置任务", "", None, None).await.unwrap();
                let t2 = mgr.create("后续任务", "", None, None).await.unwrap();

                let updated = mgr
                    .update(
                        &t2.id,
                        TaskUpdate {
                            add_blocked_by: vec![t1.id.clone()],
                            ..Default::default()
                        },
                    )
                    .await
                    .unwrap();
                assert!(updated.blocked_by.contains(&t1.id));

                // 验证 t1 的 blocks 未被自动更新（不建立反向引用，由 LLM 自行管理）
                let t1_fetched = mgr.get(&t1.id).await.unwrap().unwrap();
                assert!(!t1_fetched.blocks.contains(&t2.id));
            });
        });
    }

    #[test]
    fn test_update_subject_and_description() {
        run_with_temp_home(|_home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let mgr = TaskManager::new();
                let task = mgr.create("旧标题", "旧描述", None, None).await.unwrap();
                let updated = mgr
                    .update(
                        &task.id,
                        TaskUpdate {
                            subject: Some("新标题".to_string()),
                            description: Some("新描述".to_string()),
                            ..Default::default()
                        },
                    )
                    .await
                    .unwrap();
                assert_eq!(updated.subject, "新标题");
                assert_eq!(updated.description, "新描述");
            });
        });
    }

    #[test]
    fn test_update_owner() {
        run_with_temp_home(|_home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let mgr = TaskManager::new();
                let task = mgr.create("分配任务", "", None, None).await.unwrap();
                let updated = mgr
                    .update(
                        &task.id,
                        TaskUpdate {
                            owner: Some("agent-a".to_string()),
                            ..Default::default()
                        },
                    )
                    .await
                    .unwrap();
                assert_eq!(updated.owner, Some("agent-a".to_string()));
            });
        });
    }

    #[test]
    fn test_update_not_found() {
        run_with_temp_home(|_home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let mgr = TaskManager::new();
                let result = mgr.update("999", TaskUpdate::default()).await;
                assert!(result.is_err());
                assert!(matches!(result.unwrap_err(), TaskError::NotFound(_)));
            });
        });
    }

    #[test]
    fn test_delete() {
        run_with_temp_home(|_home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let mgr = TaskManager::new();
                let task = mgr.create("待删除", "", None, None).await.unwrap();
                assert!(mgr.delete(&task.id).await.unwrap());
                assert!(mgr.get(&task.id).await.unwrap().is_none());
                assert_eq!(mgr.list().await.unwrap().len(), 0);
            });
        });
    }

    #[test]
    fn test_delete_not_found() {
        run_with_temp_home(|_home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let mgr = TaskManager::new();
                assert!(!mgr.delete("999").await.unwrap());
            });
        });
    }

    #[test]
    fn test_id_auto_increment() {
        run_with_temp_home(|_home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let mgr = TaskManager::new();
                let t1 = mgr.create("T1", "", None, None).await.unwrap();
                let t2 = mgr.create("T2", "", None, None).await.unwrap();
                let t3 = mgr.create("T3", "", None, None).await.unwrap();
                assert_eq!(t1.id, "1");
                assert_eq!(t2.id, "2");
                assert_eq!(t3.id, "3");
            });
        });
    }

    #[test]
    fn test_id_survives_delete() {
        // 删除后高水位不应下降
        run_with_temp_home(|_home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let mgr = TaskManager::new();
                mgr.create("T1", "", None, None).await.unwrap();
                mgr.create("T2", "", None, None).await.unwrap();
                mgr.delete("2").await.unwrap();
                let t3 = mgr.create("T3", "", None, None).await.unwrap();
                assert_eq!(t3.id, "3", "删除不应重置 ID 计数器");
            });
        });
    }

    #[test]
    fn test_high_water_mark_persists_across_sessions() {
        run_with_temp_home(|_home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                // 模拟第一次 session
                let mgr1 = TaskManager::new();
                mgr1.create("S1T1", "", None, None).await.unwrap();
                mgr1.create("S1T2", "", None, None).await.unwrap();
                drop(mgr1);

                // 模拟第二次 session（同一目录）
                let mgr2 = TaskManager::new();
                let t3 = mgr2.create("S2T1", "", None, None).await.unwrap();
                assert_eq!(t3.id, "3", "跨 session ID 应连续递增");
            });
        });
    }

    #[test]
    fn test_concurrent_create_unique_ids() {
        run_with_temp_home(|_home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let mgr = std::sync::Arc::new(TaskManager::new());
                let mut handles = vec![];
                for i in 0..20 {
                    let mgr = mgr.clone();
                    handles.push(tokio::spawn(async move {
                        mgr.create(&format!("并发{}", i), "", None, None)
                            .await
                            .unwrap()
                    }));
                }
                let tasks: Vec<_> = futures_util::future::join_all(handles)
                    .await
                    .into_iter()
                    .map(|r| r.unwrap())
                    .collect();
                assert_eq!(tasks.len(), 20);

                let mut ids: Vec<_> = tasks.iter().map(|t| t.id.clone()).collect();
                ids.sort();
                ids.dedup();
                assert_eq!(ids.len(), 20, "所有任务 ID 必须唯一");
            });
        });
    }

    #[test]
    fn test_summary_line() {
        let task = Task {
            id: "1".into(),
            subject: "测试".into(),
            description: "desc".into(),
            active_form: None,
            status: TaskStatus::Pending,
            owner: None,
            blocks: vec![],
            blocked_by: vec![],
            metadata: None,
        };
        let line = task.summary_line();
        assert!(line.contains("#1"));
        assert!(line.contains("测试"));
        assert!(line.contains("[pending]"));
    }

    #[test]
    fn test_summary_line_with_owner_and_blocked() {
        let task = Task {
            id: "5".into(),
            subject: "带依赖的任务".into(),
            description: "...".into(),
            active_form: None,
            status: TaskStatus::InProgress,
            owner: Some("alice".into()),
            blocks: vec![],
            blocked_by: vec!["1".into(), "2".into()],
            metadata: None,
        };
        let line = task.summary_line();
        assert!(line.contains("#5"));
        assert!(line.contains("alice"));
        assert!(line.contains("blocked by 1, 2"));
        assert!(line.contains("[in_progress]"));
    }

    #[test]
    fn test_detail_view() {
        let task = Task {
            id: "42".into(),
            subject: "详细任务".into(),
            description: "这是一段描述".into(),
            active_form: Some("进行中".into()),
            status: TaskStatus::InProgress,
            owner: Some("bob".into()),
            blocks: vec!["7".into()],
            blocked_by: vec!["3".into()],
            metadata: None,
        };
        let detail = task.detail();
        assert!(detail.contains("#42"));
        assert!(detail.contains("详细任务"));
        assert!(detail.contains("这是一段描述"));
        assert!(detail.contains("进行中"));
        assert!(detail.contains("bob"));
        assert!(detail.contains("#7"));
        assert!(detail.contains("#3"));
    }

    #[test]
    fn test_detail_no_optionals() {
        let task = Task {
            id: "1".into(),
            subject: "简单".into(),
            description: "".into(),
            active_form: None,
            status: TaskStatus::Pending,
            owner: None,
            blocks: vec![],
            blocked_by: vec![],
            metadata: None,
        };
        let detail = task.detail();
        assert!(detail.contains("#1"));
        assert!(!detail.contains("Owner:"));
        assert!(!detail.contains("Blocked by:"));
        assert!(!detail.contains("Blocks:"));
    }

    #[test]
    fn test_deserialize_snake_case_status() {
        // 验证 JSON 中的 "in_progress" 正确反序列化为 TaskStatus::InProgress
        let json = r#"{
            "id": "1",
            "subject": "test",
            "description": "",
            "status": "in_progress",
            "blocks": [],
            "blocked_by": []
        }"#;
        let task: Task = serde_json::from_str(json).unwrap();
        assert_eq!(task.status, TaskStatus::InProgress);
    }

    #[test]
    fn test_deserialize_all_statuses() {
        for (status_str, expected) in [
            ("pending", TaskStatus::Pending),
            ("in_progress", TaskStatus::InProgress),
            ("completed", TaskStatus::Completed),
        ] {
            let json = format!(
                r#"{{"id":"1","subject":"t","description":"","status":"{}","blocks":[],"blocked_by":[]}}"#,
                status_str
            );
            let task: Task = serde_json::from_str(&json).unwrap();
            assert_eq!(task.status, expected, "failed for status: {}", status_str);
        }
    }

    #[test]
    fn test_task_status_from_str() {
        assert_eq!(
            "pending".parse::<TaskStatus>().ok(),
            Some(TaskStatus::Pending)
        );
        assert_eq!(
            "in_progress".parse::<TaskStatus>().ok(),
            Some(TaskStatus::InProgress)
        );
        assert_eq!(
            "completed".parse::<TaskStatus>().ok(),
            Some(TaskStatus::Completed)
        );
        assert_eq!("unknown".parse::<TaskStatus>().ok(), None);
        assert_eq!("".parse::<TaskStatus>().ok(), None);
    }

    #[test]
    fn test_task_status_display() {
        assert_eq!(TaskStatus::Pending.to_string(), "pending");
        assert_eq!(TaskStatus::InProgress.to_string(), "in_progress");
        assert_eq!(TaskStatus::Completed.to_string(), "completed");
    }

    #[test]
    fn test_with_list_id() {
        let mgr = TaskManager::with_list_id("my-team");
        assert!(mgr.list_dir().to_string_lossy().contains("my-team"));
    }

    #[test]
    fn test_default_list_id() {
        let mgr = TaskManager::new();
        assert!(mgr.list_dir().to_string_lossy().contains("default"));
    }

    #[test]
    fn test_delete_removes_file_only() {
        run_with_temp_home(|_home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let mgr = TaskManager::new();
                mgr.create("T1", "", None, None).await.unwrap();
                mgr.create("T2", "", None, None).await.unwrap();
                mgr.delete("1").await.unwrap();

                // 列表只返回 T2
                let tasks = mgr.list().await.unwrap();
                assert_eq!(tasks.len(), 1);
                assert_eq!(tasks[0].id, "2");
            });
        });
    }

    #[test]
    fn test_update_add_blocks_deduplicates() {
        run_with_temp_home(|_home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let mgr = TaskManager::new();
                let t1 = mgr.create("T1", "", None, None).await.unwrap();
                let t2 = mgr.create("T2", "", None, None).await.unwrap();

                // 两次添加同样的依赖
                mgr.update(
                    &t2.id,
                    TaskUpdate {
                        add_blocked_by: vec![t1.id.clone()],
                        ..Default::default()
                    },
                )
                .await
                .unwrap();
                let updated = mgr
                    .update(
                        &t2.id,
                        TaskUpdate {
                            add_blocked_by: vec![t1.id.clone()],
                            ..Default::default()
                        },
                    )
                    .await
                    .unwrap();
                assert_eq!(updated.blocked_by, vec![t1.id], "不应出现重复依赖");
            });
        });
    }

    #[test]
    fn test_update_with_metadata_merge() {
        run_with_temp_home(|_home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let mgr = TaskManager::new();
                let task = mgr.create("元数据测试", "", None, None).await.unwrap();
                let mut meta = serde_json::Map::new();
                meta.insert("priority".into(), serde_json::Value::String("high".into()));
                meta.insert("story_points".into(), serde_json::Value::Number(5.into()));
                let updated = mgr
                    .update(
                        &task.id,
                        TaskUpdate {
                            metadata: Some(meta),
                            ..Default::default()
                        },
                    )
                    .await
                    .unwrap();
                let m = updated.metadata.as_ref().unwrap();
                assert_eq!(m.get("priority").and_then(|v| v.as_str()), Some("high"));
                assert_eq!(m.get("story_points").and_then(|v| v.as_u64()), Some(5));
            });
        });
    }

    #[test]
    fn test_update_metadata_remove_key() {
        run_with_temp_home(|_home| {
            let rt = tokio::runtime::Runtime::new().unwrap();
            rt.block_on(async {
                let mgr = TaskManager::new();
                let mut meta = serde_json::Map::new();
                meta.insert("temp".into(), serde_json::Value::String("value".into()));
                let task = mgr
                    .create("元数据删除", "", None, Some(meta))
                    .await
                    .unwrap();
                assert!(task.metadata.is_some());

                // 删除 key
                let mut remove = serde_json::Map::new();
                remove.insert("temp".into(), serde_json::Value::Null);
                let updated = mgr
                    .update(
                        &task.id,
                        TaskUpdate {
                            metadata: Some(remove),
                            ..Default::default()
                        },
                    )
                    .await
                    .unwrap();
                assert!(
                    updated.metadata.is_none() || updated.metadata.as_ref().unwrap().is_empty()
                );
            });
        });
    }
}

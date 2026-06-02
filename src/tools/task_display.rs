// Task 展示模块 — 事件流 + 检查点快照
//
// 职责：
// - 对比当前任务列表与上次展示时的状态，计算 diff（新增/状态变更/删除）
// - 将 diff 渲染为简洁的事件消息（每轮 0~2 条，每条 1 行）
// - 在关键节点输出全量快照（初始计划、每 N 条事件、全部完成）
//
// 设计原则：
// - 不修改 TaskManager 数据层
// - 输出格式统一（终端和 IM 使用相同的纯文本格式）
// - 不在工具层发射事件，通过状态对比自动推导 diff

use crate::tools::task_manager::{Task, TaskStatus};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/// 展示配置
pub struct TaskDisplayConfig {
    /// 每多少条事件后输出一次全量快照
    pub snapshot_interval: usize,
}

impl Default for TaskDisplayConfig {
    fn default() -> Self {
        Self {
            snapshot_interval: 3,
        }
    }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/// 一轮计算的输出结果
pub struct OutputMessages {
    /// 事件消息（0~N 条，每条 1 行，简洁的变化通知）
    pub events: Vec<String>,
    /// 可选的快照消息（阶段性全量列表）
    pub snapshot: Option<String>,
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

/// 展示状态机
///
/// 跟踪"上次展示时的快照"和"已发送事件计数"，
/// 通过状态对比自动推导 diff，避免在工具层注入事件。
pub struct TaskDisplayState {
    /// 上次展示时的任务快照（用于 diff）
    previous_tasks: Vec<Task>,
    /// 自上次全量快照以来已发送的事件数
    events_since_snapshot: usize,
    /// 初始计划是否已展示
    initial_shown: bool,
    /// 配置
    config: TaskDisplayConfig,
}

impl TaskDisplayState {
    pub fn new() -> Self {
        Self {
            previous_tasks: Vec::new(),
            events_since_snapshot: 0,
            initial_shown: false,
            config: TaskDisplayConfig::default(),
        }
    }

    pub fn with_config(config: TaskDisplayConfig) -> Self {
        Self {
            previous_tasks: Vec::new(),
            events_since_snapshot: 0,
            initial_shown: false,
            config,
        }
    }

    /// 核心方法：接收最新任务列表，计算输出消息
    ///
    /// 调用方应每轮工具执行结束后调用一次此方法，传入当前完整任务列表。
    pub fn compute_output(&mut self, current_tasks: &[Task]) -> OutputMessages {
        let mut events = Vec::new();
        let mut snapshot = None;

        // 空列表：如果之前有任务，需要输出删除事件；否则无事可做
        if current_tasks.is_empty() {
            if !self.previous_tasks.is_empty() {
                for prev_task in &self.previous_tasks {
                    events.push(format!("🗑️ #{} {} 已删除", prev_task.id, prev_task.subject));
                }
                self.previous_tasks.clear();
            }
            return OutputMessages { events, snapshot };
        }

        // ---- 初始展示：仅一次完整计划快照 ----
        if !self.initial_shown {
            snapshot = Some(render_plan_snapshot(current_tasks));
            self.initial_shown = true;
            self.previous_tasks = current_tasks.to_vec();
            return OutputMessages { events, snapshot };
        }

        // ---- 计算 diff 事件 ----
        let diff_events = compute_events(&self.previous_tasks, current_tasks);

        for ev in &diff_events {
            if let Some(line) = render_event_line(ev) {
                events.push(line);
            }
        }

        self.events_since_snapshot += diff_events.len();

        // ---- 检查点快照判定 ----
        let all_done = current_tasks
            .iter()
            .all(|t| t.status == TaskStatus::Completed);

        if all_done {
            // 全部完成 → 最终总结（优先级高于检查点）
            if !diff_events.is_empty() {
                snapshot = Some(render_final_summary(current_tasks));
                self.events_since_snapshot = 0;
            }
        } else if self.events_since_snapshot >= self.config.snapshot_interval {
            // 事件数达到阈值 → 检查点快照
            snapshot = Some(render_checkpoint(current_tasks));
            self.events_since_snapshot = 0;
        }

        // ---- 更新状态 ----
        self.previous_tasks = current_tasks.to_vec();

        OutputMessages { events, snapshot }
    }
}

impl Default for TaskDisplayState {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Diff engine
// ---------------------------------------------------------------------------

/// 内部事件类型
enum TaskEvent {
    /// 一批新任务被创建
    TasksCreated(Vec<Task>),
    /// 某个任务状态变更
    StatusChanged { task: Task, old: TaskStatus },
    /// 某个任务被删除
    Deleted { id: String, subject: String },
}

/// 计算两次任务列表之间的 diff 事件
fn compute_events(prev: &[Task], curr: &[Task]) -> Vec<TaskEvent> {
    let mut events = Vec::new();

    let prev_map: std::collections::HashMap<&str, &Task> =
        prev.iter().map(|t| (t.id.as_str(), t)).collect();
    let curr_map: std::collections::HashMap<&str, &Task> =
        curr.iter().map(|t| (t.id.as_str(), t)).collect();

    // 新增任务（批量合并为一条事件，避免刷屏）
    let new_tasks: Vec<Task> = curr
        .iter()
        .filter(|t| !prev_map.contains_key(t.id.as_str()))
        .cloned()
        .collect();
    if !new_tasks.is_empty() {
        events.push(TaskEvent::TasksCreated(new_tasks));
    }

    // 状态变更
    for curr_task in curr {
        if let Some(prev_task) = prev_map.get(curr_task.id.as_str())
            && curr_task.status != prev_task.status
        {
            events.push(TaskEvent::StatusChanged {
                task: curr_task.clone(),
                old: prev_task.status.clone(),
            });
        }
    }

    // 任务被删除
    for prev_task in prev {
        if !curr_map.contains_key(prev_task.id.as_str()) {
            events.push(TaskEvent::Deleted {
                id: prev_task.id.clone(),
                subject: prev_task.subject.clone(),
            });
        }
    }

    events
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/// 渲染单条事件消息（简洁，1 行）
fn render_event_line(event: &TaskEvent) -> Option<String> {
    match event {
        TaskEvent::TasksCreated(tasks) => {
            if tasks.len() <= 3 {
                let subjects: Vec<&str> = tasks.iter().map(|t| t.subject.as_str()).collect();
                Some(format!("📋 新增: {}", subjects.join(", ")))
            } else {
                Some(format!("📋 新增 {} 个任务", tasks.len()))
            }
        }
        TaskEvent::StatusChanged { task, .. } => match task.status {
            TaskStatus::InProgress => {
                let label = task.active_form.as_deref().unwrap_or(&task.subject);
                Some(format!("▶️ #{} {}", task.id, label))
            }
            TaskStatus::Completed => Some(format!("✅ #{} {}", task.id, task.subject)),
            TaskStatus::Pending => {
                // 边缘情况：回退到 pending（通常不会发生）
                Some(format!("⏸️ #{} {}", task.id, task.subject))
            }
        },
        TaskEvent::Deleted { id, subject } => Some(format!("🗑️ #{} {} 已删除", id, subject)),
    }
}

/// 渲染初始计划快照
fn render_plan_snapshot(tasks: &[Task]) -> String {
    let mut lines = Vec::new();
    lines.push(format!("━━━ 📋 任务计划 ({} 项) ━━━", tasks.len()));
    for task in tasks {
        lines.push(format!(
            "  ◻ #{} {}{}",
            task.id,
            task.subject,
            blocked_suffix(task)
        ));
    }
    lines.join("\n")
}

/// 渲染检查点快照（带状态图标和进度）
fn render_checkpoint(tasks: &[Task]) -> String {
    let done = tasks
        .iter()
        .filter(|t| t.status == TaskStatus::Completed)
        .count();
    let total = tasks.len();
    let mut lines = Vec::new();
    lines.push(format!("━━━ 📋 进度: {}/{} ━━━", done, total));
    for task in tasks {
        let (icon, extra) = match task.status {
            TaskStatus::Completed => ("✔".to_string(), String::new()),
            TaskStatus::InProgress => {
                let activity = task
                    .active_form
                    .as_deref()
                    .map(|a| format!(" [{}]", a))
                    .unwrap_or_default();
                ("◼".to_string(), activity)
            }
            TaskStatus::Pending => ("◻".to_string(), String::new()),
        };
        lines.push(format!(
            "  {} #{} {}{}{}",
            icon,
            task.id,
            task.subject,
            extra,
            blocked_suffix(task)
        ));
    }
    lines.join("\n")
}

/// 渲染最终完成总结
fn render_final_summary(tasks: &[Task]) -> String {
    let mut lines = Vec::new();
    lines.push(format!("━━━ 🎉 全部完成 ({} 项) ━━━", tasks.len()));
    for task in tasks {
        lines.push(format!("  ✔ #{} {}", task.id, task.subject));
    }
    lines.join("\n")
}

/// 生成依赖阻塞后缀
fn blocked_suffix(task: &Task) -> String {
    if task.blocked_by.is_empty() {
        String::new()
    } else {
        let ids: Vec<String> = task
            .blocked_by
            .iter()
            .map(|id| format!("#{}", id))
            .collect();
        format!(" [blocked by {}]", ids.join(", "))
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn make_task(id: &str, subject: &str, status: TaskStatus) -> Task {
        Task {
            id: id.to_string(),
            subject: subject.to_string(),
            description: String::new(),
            active_form: None,
            status,
            owner: None,
            blocks: vec![],
            blocked_by: vec![],
            metadata: None,
        }
    }

    fn make_task_with_blocked(
        id: &str,
        subject: &str,
        status: TaskStatus,
        blocked_by: Vec<String>,
    ) -> Task {
        Task {
            blocked_by,
            ..make_task(id, subject, status)
        }
    }

    // =============================================================
    // 初始展示
    // =============================================================

    #[test]
    fn test_initial_plan_shown_once() {
        let mut state = TaskDisplayState::new();
        let tasks = vec![
            make_task("1", "任务A", TaskStatus::Pending),
            make_task("2", "任务B", TaskStatus::Pending),
        ];

        // 第一次调用：应该输出初始计划快照
        let output = state.compute_output(&tasks);
        assert!(output.events.is_empty(), "初始展示不应有事件");
        let snap = output.snapshot.expect("初始展示应有快照");
        assert!(snap.contains("任务计划"));
        assert!(snap.contains("2 项"));

        // 第二次调用：状态未变，不应输出任何内容
        let output = state.compute_output(&tasks);
        assert!(output.events.is_empty());
        assert!(output.snapshot.is_none());
    }

    #[test]
    fn test_empty_tasks_no_output() {
        let mut state = TaskDisplayState::new();
        let output = state.compute_output(&[]);
        assert!(output.events.is_empty());
        assert!(output.snapshot.is_none());
    }

    #[test]
    fn test_empty_then_nonempty_shows_plan() {
        let mut state = TaskDisplayState::new();
        // 空列表
        assert!(state.compute_output(&[]).snapshot.is_none());
        // 非空 → 初始计划
        let tasks = vec![make_task("1", "任务A", TaskStatus::Pending)];
        let output = state.compute_output(&tasks);
        assert!(output.snapshot.is_some());
    }

    // =============================================================
    // 事件：新增任务
    // =============================================================

    #[test]
    fn test_new_task_created() {
        let mut state = TaskDisplayState::new();
        // 初始展示
        let t1 = make_task("1", "任务A", TaskStatus::Pending);
        state.compute_output(&[t1]);

        // 新增一个任务
        let t2 = make_task("2", "任务B", TaskStatus::Pending);
        let output = state.compute_output(&[make_task("1", "任务A", TaskStatus::Pending), t2]);

        assert_eq!(output.events.len(), 1, "新增应有 1 条事件");
        assert!(output.events[0].contains("新增"));
        assert!(output.events[0].contains("任务B"));
    }

    #[test]
    fn test_multiple_new_tasks_merged() {
        let mut state = TaskDisplayState::new();
        state.compute_output(&[make_task("1", "任务A", TaskStatus::Pending)]);

        // 批量新增 2 个任务 → 合并为 1 条事件
        let output = state.compute_output(&[
            make_task("1", "任务A", TaskStatus::Pending),
            make_task("2", "任务B", TaskStatus::Pending),
            make_task("3", "任务C", TaskStatus::Pending),
        ]);

        assert_eq!(output.events.len(), 1, "批量新增应合并为 1 条事件");
        assert!(output.events[0].contains("任务B"));
        assert!(output.events[0].contains("任务C"));
    }

    #[test]
    fn test_many_new_tasks_compact() {
        let mut state = TaskDisplayState::new();
        state.compute_output(&[make_task("1", "A", TaskStatus::Pending)]);

        // 4 个新任务 → 不列具体名称
        let tasks: Vec<Task> = (2..=6)
            .map(|i| make_task(&i.to_string(), &format!("任务{}", i), TaskStatus::Pending))
            .collect();
        let mut all = vec![make_task("1", "A", TaskStatus::Pending)];
        all.extend(tasks);

        let output = state.compute_output(&all);
        assert_eq!(output.events.len(), 1);
        assert!(output.events[0].contains("新增 5 个"));
    }

    // =============================================================
    // 事件：状态变更
    // =============================================================

    #[test]
    fn test_task_started() {
        let mut state = TaskDisplayState::new();
        state.compute_output(&[make_task("1", "数据库设计", TaskStatus::Pending)]);

        let output = state.compute_output(&[make_task("1", "数据库设计", TaskStatus::InProgress)]);

        assert_eq!(output.events.len(), 1);
        assert!(output.events[0].contains("▶️"));
        assert!(output.events[0].contains("#1"));
    }

    #[test]
    fn test_task_completed() {
        let mut state = TaskDisplayState::new();
        state.compute_output(&[make_task("1", "数据库设计", TaskStatus::Pending)]);

        // 跳过 in_progress，直接到 completed
        let output = state.compute_output(&[make_task("1", "数据库设计", TaskStatus::Completed)]);

        assert_eq!(output.events.len(), 1);
        assert!(output.events[0].contains("✅"));
        assert!(output.events[0].contains("数据库设计"));
    }

    #[test]
    fn test_multiple_status_changes_same_round() {
        let mut state = TaskDisplayState::new();
        let tasks = vec![
            make_task("1", "A", TaskStatus::Pending),
            make_task("2", "B", TaskStatus::Pending),
        ];
        state.compute_output(&tasks);

        // 两个任务同时变更状态
        let updated = vec![
            make_task("1", "A", TaskStatus::Completed),
            make_task("2", "B", TaskStatus::InProgress),
        ];
        let output = state.compute_output(&updated);
        assert_eq!(output.events.len(), 2, "两个变更应产生两条事件");
    }

    // =============================================================
    // 事件：删除任务
    // =============================================================

    #[test]
    fn test_task_deleted() {
        let mut state = TaskDisplayState::new();
        state.compute_output(&[make_task("1", "任务A", TaskStatus::Pending)]);

        let output = state.compute_output(&[]);
        assert_eq!(output.events.len(), 1);
        assert!(output.events[0].contains("已删除"));
    }

    // =============================================================
    // 检查点快照
    // =============================================================

    #[test]
    fn test_snapshot_after_interval() {
        let mut state = TaskDisplayState::with_config(TaskDisplayConfig {
            snapshot_interval: 2, // 每 2 条事件出一次快照
        });

        let tasks = vec![
            make_task("1", "A", TaskStatus::Pending),
            make_task("2", "B", TaskStatus::Pending),
            make_task("3", "C", TaskStatus::Pending),
        ];
        state.compute_output(&tasks); // 初始计划

        // 第 1 条事件 → 无快照
        let output = state.compute_output(&[
            make_task("1", "A", TaskStatus::InProgress),
            make_task("2", "B", TaskStatus::Pending),
            make_task("3", "C", TaskStatus::Pending),
        ]);
        assert_eq!(output.events.len(), 1);
        assert!(output.snapshot.is_none(), "第 1 条事件不应有快照");

        // 第 2 条事件 → 触发快照
        let output = state.compute_output(&[
            make_task("1", "A", TaskStatus::Completed),
            make_task("2", "B", TaskStatus::Pending),
            make_task("3", "C", TaskStatus::Pending),
        ]);
        assert!(output.snapshot.is_some(), "第 2 条事件应触发快照");
        assert!(output.snapshot.as_ref().unwrap().contains("进度: 1/3"));
    }

    #[test]
    fn test_snapshot_all_done_final() {
        let mut state = TaskDisplayState::new();
        let tasks = vec![make_task("1", "A", TaskStatus::Pending)];
        state.compute_output(&tasks); // 初始计划

        // 完成唯一的任务
        let output = state.compute_output(&[make_task("1", "A", TaskStatus::Completed)]);
        assert!(output.snapshot.is_some(), "全部完成应有最终总结");
        assert!(output.snapshot.as_ref().unwrap().contains("🎉"));
        assert!(output.snapshot.as_ref().unwrap().contains("全部完成"));
    }

    // =============================================================
    // 场景：完整流程
    // =============================================================

    #[test]
    fn test_full_scenario() {
        let mut state = TaskDisplayState::with_config(TaskDisplayConfig {
            snapshot_interval: 3,
        });

        // 1. 初始计划
        let mut tasks = vec![
            make_task("1", "数据库设计", TaskStatus::Pending),
            make_task("2", "用户注册API", TaskStatus::Pending),
            make_task("3", "用户登录API", TaskStatus::Pending),
        ];
        let output = state.compute_output(&tasks);
        assert!(output.snapshot.is_some());
        assert!(output.snapshot.as_ref().unwrap().contains("任务计划"));

        // 2. 任务 1 开始
        tasks[0].status = TaskStatus::InProgress;
        let output = state.compute_output(&tasks);
        assert_eq!(output.events.len(), 1);
        assert!(output.events[0].contains("▶️"));
        assert!(output.snapshot.is_none());

        // 3. 任务 1 完成
        tasks[0].status = TaskStatus::Completed;
        let output = state.compute_output(&tasks);
        assert_eq!(output.events.len(), 1);
        assert!(output.events[0].contains("✅"));
        assert!(output.snapshot.is_none());

        // 4. 任务 2 开始（第 3 条事件 → 触发快照）
        tasks[1].status = TaskStatus::InProgress;
        let output = state.compute_output(&tasks);
        assert_eq!(output.events.len(), 1);
        assert!(output.snapshot.is_some(), "第 3 条事件应触发快照");

        // 5. 任务 2 完成
        tasks[1].status = TaskStatus::Completed;
        let output = state.compute_output(&tasks);
        assert_eq!(output.events.len(), 1);
        assert!(output.snapshot.is_none());

        // 6. 任务 3 开始（第 2 条事件 → 无快照）
        tasks[2].status = TaskStatus::InProgress;
        let output = state.compute_output(&tasks);
        assert!(output.snapshot.is_none());

        // 7. 任务 3 完成 → 全部完成
        tasks[2].status = TaskStatus::Completed;
        let output = state.compute_output(&tasks);
        assert_eq!(output.events.len(), 1);
        assert!(output.snapshot.is_some());
        assert!(output.snapshot.unwrap().contains("全部完成"));
    }

    // =============================================================
    // blocked_by 渲染
    // =============================================================

    #[test]
    fn test_blocked_tasks_in_snapshot() {
        let tasks = vec![
            make_task("1", "前置", TaskStatus::Completed),
            make_task_with_blocked("2", "后置", TaskStatus::Pending, vec!["1".to_string()]),
        ];

        let snapshot = render_checkpoint(&tasks);
        assert!(snapshot.contains("blocked by #1"));
    }

    #[test]
    fn test_blocked_suffix_empty() {
        let task = make_task("1", "无依赖", TaskStatus::Pending);
        assert_eq!(blocked_suffix(&task), "");
    }

    #[test]
    fn test_blocked_suffix_single() {
        let task =
            make_task_with_blocked("2", "有依赖", TaskStatus::Pending, vec!["1".to_string()]);
        assert_eq!(blocked_suffix(&task), " [blocked by #1]");
    }

    #[test]
    fn test_blocked_suffix_multiple() {
        let task = make_task_with_blocked(
            "3",
            "多依赖",
            TaskStatus::Pending,
            vec!["1".to_string(), "2".to_string()],
        );
        assert_eq!(blocked_suffix(&task), " [blocked by #1, #2]");
    }

    // =============================================================
    // 渲染格式验证
    // =============================================================

    #[test]
    fn test_plan_snapshot_format() {
        let tasks = vec![
            make_task("1", "任务A", TaskStatus::Pending),
            make_task("2", "任务B", TaskStatus::Pending),
        ];
        let snapshot = render_plan_snapshot(&tasks);
        assert!(snapshot.starts_with("━━━"));
        assert!(snapshot.contains("◻ #1"));
        assert!(snapshot.contains("◻ #2"));
    }

    #[test]
    fn test_checkpoint_includes_mixed_statuses() {
        let tasks = vec![
            make_task("1", "完成的任务", TaskStatus::Completed),
            make_task("2", "进行中", TaskStatus::InProgress),
            make_task("3", "待处理", TaskStatus::Pending),
        ];
        let snapshot = render_checkpoint(&tasks);
        assert!(snapshot.contains("✔ #1"));
        assert!(snapshot.contains("◼ #2"));
        assert!(snapshot.contains("◻ #3"));
        assert!(snapshot.contains("进度: 1/3"));
    }

    #[test]
    fn test_final_summary_format() {
        let tasks = vec![
            make_task("1", "任务A", TaskStatus::Completed),
            make_task("2", "任务B", TaskStatus::Completed),
        ];
        let summary = render_final_summary(&tasks);
        assert!(summary.contains("🎉"));
        assert!(summary.contains("全部完成"));
        assert!(summary.contains("2 项"));
        assert!(summary.contains("✔ #1"));
        assert!(summary.contains("✔ #2"));
    }

    #[test]
    fn test_event_created_line() {
        let tasks = vec![make_task("1", "数据库", TaskStatus::Pending)];
        let event = TaskEvent::TasksCreated(tasks);
        let line = render_event_line(&event);
        assert_eq!(line, Some("📋 新增: 数据库".to_string()));
    }

    #[test]
    fn test_event_started_line() {
        let task = make_task("1", "数据库设计", TaskStatus::InProgress);
        let event = TaskEvent::StatusChanged {
            task,
            old: TaskStatus::Pending,
        };
        let line = render_event_line(&event);
        assert_eq!(line, Some("▶️ #1 数据库设计".to_string()));
    }

    #[test]
    fn test_event_started_with_active_form() {
        let task = Task {
            active_form: Some("正在设计数据库".to_string()),
            ..make_task("1", "数据库设计", TaskStatus::InProgress)
        };
        let event = TaskEvent::StatusChanged {
            task,
            old: TaskStatus::Pending,
        };
        let line = render_event_line(&event);
        assert_eq!(line, Some("▶️ #1 正在设计数据库".to_string()));
    }

    #[test]
    fn test_event_completed_line() {
        let task = make_task("1", "数据库设计", TaskStatus::Completed);
        let event = TaskEvent::StatusChanged {
            task,
            old: TaskStatus::InProgress,
        };
        let line = render_event_line(&event);
        assert_eq!(line, Some("✅ #1 数据库设计".to_string()));
    }

    #[test]
    fn test_event_deleted_line() {
        let event = TaskEvent::Deleted {
            id: "1".to_string(),
            subject: "无用任务".to_string(),
        };
        let line = render_event_line(&event);
        assert_eq!(line, Some("🗑️ #1 无用任务 已删除".to_string()));
    }
}

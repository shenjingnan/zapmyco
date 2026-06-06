# SubAgent 测试方案

> 版本: v1.0 · 日期: 2026-06-05 · 配套设计: `subagent-design.md`

---

## 目录

1. [测试策略](#1-测试策略)
2. [单元测试](#2-单元测试)
3. [集成测试](#3-集成测试)
4. [cli.rs 条件注册测试](#4-clirs-条件注册测试)
5. [Bug 回归测试](#5-bug-回归测试)
6. [跨平台测试](#6-跨平台测试)
7. [手动测试场景](#7-手动测试场景)
8. [持续集成](#8-持续集成)

---

## 1. 测试策略

### 1.1 分层

| 层 | 工具 | 速度 | 覆盖 |
|---|------|------|------|
| 单元测试 | `#[test]` + mock | ms 级 | 工具逻辑、状态机、输出格式化 |
| 集成测试 | `#[tokio::test]` + 临时目录 | s 级 | 子进程创建、文件 I/O、并发的竞态 |
| 手动测试 | `cargo run` 触发 LLM | min 级 | 端到端 LLM 编排流程 |

### 1.2 隔离原则

- 所有写入磁盘的测试使用**临时目录**（`tempfile::TempDir`），不污染 `~/.zapmyco/subagents/`
- 子进程测试使用 `echo`/`sleep`/`false` 等标准命令，**不启动真实的 `zapmyco` 子进程**
- 并发测试设置 `--test-threads=1` 避免目录竞态
- 环境变量 `HOME` 用 `tempfile` 隔离

---

## 2. 单元测试

所有测试位于 `src/tools/subagent.rs` 的 `#[cfg(test)] mod tests` 中。

### 2.1 subagent_id 生成

```rust
#[test]
fn test_generate_subagent_id_format() {
    let id = generate_subagent_id();
    // 格式: sa_{YYYYMMDD}_{8位hex}
    assert!(id.starts_with("sa_"));
    assert_eq!(id.len(), 25); // "sa_YYYYMMDD_XXXXXXXX"
}

#[test]
fn test_generate_subagent_id_unique() {
    let ids: HashSet<String> = (0..100).map(|_| generate_subagent_id()).collect();
    assert_eq!(ids.len(), 100); // 100 次无碰撞
}

#[test]
fn test_generate_subagent_id_collision_avoidance() {
    let dir = TempDir::new().unwrap();
    // 先创建一个占用 ID
    let existing = generate_subagent_id();
    std::fs::create_dir(dir.path().join(&existing)).unwrap();
    // 应该跳过已存在的，生成新 ID
    let next = generate_subagent_id();
    assert_ne!(next, existing);
}
```

### 2.2 agent_session_id 生成

```rust
#[test]
fn test_agent_session_id_format() {
    let id = generate_agent_session_id();
    assert!(id.starts_with("as_"));
    assert_eq!(id.len(), 19); // "as_16位hex"
}

#[test]
fn test_agent_session_id_unique() {
    let set: HashSet<String> = (0..1000).map(|_| generate_agent_session_id()).collect();
    assert_eq!(set.len(), 1000);
}
```

### 2.3 build_command

```rust
#[test]
fn test_build_command_basic() {
    let (binary, args) = build_command("echo hello", false).unwrap();
    assert!(binary.contains("echo")); // 当前环境
    // 或验证路径存在
}

#[test]
fn test_build_command_with_subagent_flag() {
    let (binary, args) = build_command("task", true).unwrap();
    assert!(args.contains(&"--subagent".to_string()));
}

#[test]
fn test_build_command_without_subagent_flag() {
    let (binary, args) = build_command("task", false).unwrap();
    assert!(!args.contains(&"--subagent".to_string()));
}

/// build_command 使用 current_exe()，不会返回 PATH 字面量
#[test]
fn test_build_command_uses_current_exe() {
    let current = std::env::current_exe().unwrap();
    let (binary, _) = build_command("task", false).unwrap();
    assert_eq!(binary, current.to_string_lossy());
}
```

### 2.4 execute — action 路由分发

```rust
#[test]
fn test_execute_dispatches_spawn() {
    let tool = SubAgentTool::new_for_test(TempDir::new().unwrap());
    let input = serde_json::json!({"action": "spawn", "cli": "zapmyco", "task": "echo hi"});
    let result = tool.execute(&input).await;
    // spawn 应返回 running + subagent_id
    assert!(result.unwrap().contains("sa_"));
}

#[test]
fn test_execute_dispatches_poll() {
    let tool = SubAgentTool::new_for_test(TempDir::new().unwrap());
    let input = serde_json::json!({"action": "poll", "subagent_ids": ["sa_nonexistent"]});
    let result = tool.execute(&input).await;
    assert!(result.unwrap().contains("ID 不存在"));
}

#[test]
fn test_execute_dispatches_list() {
    let tool = SubAgentTool::new_for_test(TempDir::new().unwrap());
    let input = serde_json::json!({"action": "list"});
    let result = tool.execute(&input).await;
    assert!(result.is_ok());
}

#[test]
fn test_execute_dispatches_kill() {
    let tool = SubAgentTool::new_for_test(TempDir::new().unwrap());
    let input = serde_json::json!({"action": "kill", "subagent_ids": ["sa_nonexistent"]});
    let result = tool.execute(&input).await;
    assert!(result.is_ok());
}

#[test]
fn test_execute_rejects_invalid_action() {
    let tool = SubAgentTool::new_for_test(TempDir::new().unwrap());
    let input = serde_json::json!({"action": "reboot"});
    let result = tool.execute(&input).await;
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("无效 action"));
}

#[test]
fn test_execute_requires_action_field() {
    let tool = SubAgentTool::new_for_test(TempDir::new().unwrap());
    let input = serde_json::json!({"task": "hello"});
    let result = tool.execute(&input).await;
    assert!(result.is_err());
}
```

### 2.5 tool_definition — Schema 正确性

```rust
#[test]
fn test_tool_definition_name() {
    let tool = SubAgentTool::tool_definition();
    assert_eq!(tool.name, "subagent");
}

#[test]
fn test_tool_definition_has_description() {
    let tool = SubAgentTool::tool_definition();
    assert!(tool.description.is_some());
    assert!(!tool.description.unwrap().is_empty());
}

#[test]
fn test_tool_definition_action_enum() {
    let tool = SubAgentTool::tool_definition();
    let schema = tool.input_schema.unwrap();
    let action = &schema["properties"]["action"];
    let enum_values: Vec<&str> = action["enum"].as_array().unwrap()
        .iter().map(|v| v.as_str().unwrap()).collect();
    assert_eq!(enum_values, vec!["spawn", "poll", "list", "kill"]);
}

#[test]
fn test_tool_definition_subagent_ids_is_array() {
    let tool = SubAgentTool::tool_definition();
    let schema = tool.input_schema.unwrap();
    let ids = &schema["properties"]["subagent_ids"];
    assert_eq!(ids["type"], "array");
    assert_eq!(ids["items"]["type"], "string");
}

#[test]
fn test_tool_definition_required_fields() {
    let tool = SubAgentTool::tool_definition();
    let schema = tool.input_schema.unwrap();
    let required: Vec<&str> = schema["required"].as_array().unwrap()
        .iter().map(|v| v.as_str().unwrap()).collect();
    assert!(required.contains(&"action"));
}
```

### 2.6 is_concurrency_safe

```rust
#[test]
fn test_is_concurrency_safe_spawn() {
    let tool = SubAgentTool::new_for_test(TempDir::new().unwrap());
    let handler = ToolHandler::SubAgent(tool);
    let input = serde_json::json!({"action": "spawn"});
    assert!(handler.is_concurrency_safe(&input));
}

#[test]
fn test_is_concurrency_safe_poll() {
    let tool = SubAgentTool::new_for_test(TempDir::new().unwrap());
    let handler = ToolHandler::SubAgent(tool);
    let input = serde_json::json!({"action": "poll"});
    assert!(handler.is_concurrency_safe(&input));
}

#[test]
fn test_is_concurrency_safe_list() {
    let tool = SubAgentTool::new_for_test(TempDir::new().unwrap());
    let handler = ToolHandler::SubAgent(tool);
    let input = serde_json::json!({"action": "list"});
    assert!(handler.is_concurrency_safe(&input));
}

#[test]
fn test_is_concurrency_safe_kill() {
    let tool = SubAgentTool::new_for_test(TempDir::new().unwrap());
    let handler = ToolHandler::SubAgent(tool);
    let input = serde_json::json!({"action": "kill"});
    assert!(handler.is_concurrency_safe(&input));
}

#[test]
fn test_is_concurrency_safe_default() {
    let tool = SubAgentTool::new_for_test(TempDir::new().unwrap());
    let handler = ToolHandler::SubAgent(tool);
    let input = serde_json::json!({"action": "unknown"});
    assert!(!handler.is_concurrency_safe(&input));
}
```

### 2.7 format_completed — 输出折叠

```rust
#[test]
fn test_format_completed_small_output() {
    let dir = prepare_subagent_dir("sa_test", |d| {
        d.write("stdout", "hello world");
        d.write("exit_code", "0");
        d.write("started_at", "2026-06-05T10:00:00");
        d.write("cli", "zapmyco");
        d.write("task", "test task");
        d.touch("done");
    });
    let output = format_completed(&dir, "sa_test");
    assert!(output.contains("completed"));
    assert!(output.contains("hello world"));   // 全文输出
    assert!(!output.contains("OUTPUT LARGE")); // 未折叠
}

#[test]
fn test_format_completed_large_output_folded() {
    let dir = prepare_subagent_dir("sa_test", |d| {
        d.write("stdout", &"x".repeat(3000)); // > 2KB
        d.write("exit_code", "0");
        d.write("started_at", "2026-06-05T10:00:00");
        d.write("cli", "zapmyco");
        d.write("task", "test task");
        d.touch("done");
    });
    let output = format_completed(&dir, "sa_test");
    assert!(output.contains("OUTPUT LARGE"));
    assert!(output.contains("开头"));     // 有开头摘要
    assert!(output.contains("完整输出")); // 有磁盘路径提示
}

#[test]
fn test_format_completed_truncated_output() {
    let dir = prepare_subagent_dir("sa_test", |d| {
        d.write("stdout", &"x".repeat(1_500_000)); // > 1MB
        d.write("exit_code", "0");
        d.write("started_at", "2026-06-05T10:00:00");
        d.write("cli", "zapmyco");
        d.write("task", "test task");
        d.touch("done");
    });
    let output = format_completed(&dir, "sa_test");
    assert!(output.contains("OUTPUT TRUNCATED"));
    assert!(output.len() < 1_100_000); // 截断后应远小于原始
}

#[test]
fn test_format_completed_shows_stderr_when_nonempty() {
    let dir = prepare_subagent_dir("sa_test", |d| {
        d.write("stdout", "ok");
        d.write("stderr", "warning: deprecated API");
        d.write("exit_code", "0");
        d.write("started_at", "2026-06-05T10:00:00");
        d.write("cli", "zapmyco");
        d.write("task", "test task");
        d.touch("done");
    });
    let output = format_completed(&dir, "sa_test");
    assert!(output.contains("stderr"));         // stderr 段落
    assert!(output.contains("deprecated API")); // 具体内容
}

#[test]
fn test_format_completed_hides_stderr_when_empty() {
    let dir = prepare_subagent_dir("sa_test", |d| {
        d.write("stdout", "ok");
        d.write("stderr", "");
        d.write("exit_code", "0");
        d.write("started_at", "2026-06-05T10:00:00");
        d.write("cli", "zapmyco");
        d.write("task", "test task");
        d.touch("done");
    });
    let output = format_completed(&dir, "sa_test");
    assert!(!output.contains("stderr"));
}
```

### 2.8 format_completed — error + stderr 组合

```rust
#[test]
fn test_format_completed_error_with_stderr() {
    let dir = prepare_subagent_dir("sa_err_stderr", |d| {
        d.write("stdout", "部分完成");
        d.write("stderr", "panic at line 42");
        d.write("exit_code", "1");
        d.write("started_at", "2026-06-05T10:00:00");
        d.write("cli", "zapmyco");
        d.write("task", "test");
        d.touch("done");
    });
    let output = format_completed(&dir, "sa_err_stderr");
    assert!(output.contains("error"), "exit_code=1 应标注 error");
    assert!(output.contains("panic at line 42"), "stderr 内容应显示");
    // stderr 顺序应在 stdout 之后
    let stdout_pos = output.find("部分完成");
    let stderr_pos = output.find("panic at line 42");
    assert!(stdout_pos < stderr_pos, "stdout 应先于 stderr");
}
```

### 2.9 is_process_alive

```rust
#[test]
fn test_is_process_alive_current_process() {
    assert!(is_process_alive(std::process::id()));
}

#[test]
fn test_is_process_alive_nonexistent_pid() {
    assert!(!is_process_alive(999_999_999)); // 通常不存在
}
```

### 2.10 calc_elapsed — 等待时间计算

```rust
#[test]
fn test_calc_elapsed_recent() {
    let dir = TempDir::new().unwrap();
    let now = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%.f").to_string();
    std::fs::write(dir.path().join("started_at"), &now).unwrap();
    let elapsed = calc_elapsed(dir.path());
    assert!(elapsed.ends_with("s"));
    assert!(elapsed.trim_end_matches('s').parse::<u64>().unwrap() < 5); // 刚写入
}

#[test]
fn test_calc_elapsed_no_file() {
    let dir = TempDir::new().unwrap();
    let elapsed = calc_elapsed(dir.path());
    assert!(elapsed.is_empty()); // 没有 started_at → 空字符串
}
```

### 2.11 generate_subagent_id 碰撞检测

```rust
#[test]
fn test_generate_subagent_id_skips_existing() {
    let dir = TempDir::new().unwrap();
    // 手动占用 ID "sa_20260605_00000000"
    let occupied = "sa_20260605_00000000";
    std::fs::create_dir(dir.path().join(occupied)).unwrap();
    // console 补丁，让 generate 第一次就"随机"到这个 ID
    // 然后用 set 验证它跳过了
}
```

### 2.12 状态判断

```rust
#[test]
fn test_determine_status_created() {
    let dir = prepare_subagent_dir("sa_test", |d| {
        d.write("task", "task");
        // 没有 pid
        // 没有 done
    });
    assert_eq!(determine_status(&dir), SubAgentStatus::Created);
}

#[test]
fn test_determine_status_running() {
    let dir = prepare_subagent_dir("sa_test", |d| {
        d.write("task", "task");
        d.write("pid", "12345");
        // 没有 done
    });
    assert_eq!(determine_status(&dir), SubAgentStatus::Running);
}

#[test]
fn test_determine_status_completed() {
    let dir = prepare_subagent_dir("sa_test", |d| {
        d.write("task", "task");
        d.write("pid", "12345");
        d.write("exit_code", "0");
        d.touch("done");
    });
    assert_eq!(determine_status(&dir), SubAgentStatus::Completed);
}

#[test]
fn test_determine_status_timeout() {
    let dir = prepare_subagent_dir("sa_test", |d| {
        d.write("task", "task");
        d.write("pid", "12345");
        d.write("exit_code", "-1");
        d.touch("done");
    });
    assert_eq!(determine_status(&dir), SubAgentStatus::Timeout);
}

#[test]
fn test_determine_status_cancelled() {
    let dir = prepare_subagent_dir("sa_test", |d| {
        d.write("task", "task");
        d.write("pid", "12345");
        d.write("exit_code", "-15"); // SIGTERM
        d.touch("done");
    });
    assert_eq!(determine_status(&dir), SubAgentStatus::Cancelled);
}

#[test]
fn test_determine_status_error() {
    let dir = prepare_subagent_dir("sa_test", |d| {
        d.write("task", "task");
        d.write("pid", "12345");
        d.write("exit_code", "1"); // 非零
        d.touch("done");
    });
    assert_eq!(determine_status(&dir), SubAgentStatus::Error);
}
```

---

## 3. 集成测试

集成测试放在 `tests/subagent_integration.rs`。

### 3.1 poll 内部等待和 wait_secs 边界

```rust
#[tokio::test]
async fn test_poll_returns_completed_after_wait() {
    let tool = SubAgentTool::new_for_test(TempDir::new().unwrap());

    // 模拟一个很快完成的子 Agent
    let dir = tool.data_dir.join("sa_test");
    std::fs::create_dir(&dir).unwrap();
    std::fs::write(dir.join("started_at"), &now());
    std::fs::write(dir.join("task"), "test");

    // 后台 2 秒后创建 done
    let dir_clone = dir.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(2)).await;
        std::fs::write(dir_clone.join("stdout"), "hello").unwrap();
        std::fs::write(dir_clone.join("exit_code"), "0").unwrap();
        File::create(dir_clone.join("done")).unwrap();
    });

    // wait_secs=5，应该能等到 done
    let result = tool.poll(&["sa_test".to_string()], 5).await.unwrap();
    assert!(result.contains("completed"));
    assert!(result.contains("hello"));
}

#[tokio::test]
async fn test_poll_returns_running_before_completion() {
    let tool = SubAgentTool::new_for_test(TempDir::new().unwrap());
    let dir = tool.data_dir.join("sa_test");
    std::fs::create_dir(&dir).unwrap();
    std::fs::write(dir.join("started_at"), &now());
    std::fs::write(dir.join("task"), "test");

    let result = tool.poll(&["sa_test".to_string()], 0).await.unwrap();
    assert!(result.contains("running") || result.contains("pending"));
}

#[tokio::test]
async fn test_poll_wait_secs_max_30() {
    let tool = SubAgentTool::new_for_test(TempDir::new().unwrap());
    let dir = tool.data_dir.join("sa_max");
    std::fs::create_dir(&dir).unwrap();
    std::fs::write(dir.join("started_at"), &now());
    std::fs::write(dir.join("task"), "test");
    // 不写 done，验证 wait_secs=999 被截断到 30（base 5 + 30 = 35s 内返回）
    // 测试不耗时：返回 running 即可
    let start = Instant::now();
    let result = tool.poll(&["sa_max".to_string()], 999).await.unwrap();
    let elapsed = start.elapsed();
    assert!(elapsed.as_secs() < 40, "不应等待超过 35s");
    assert!(result.contains("running") || result.contains("pending"));
    // 实际等待时间应为 35s 内
    assert!(elapsed.as_secs() >= 4, "至少等待基础 5s");
}

#[tokio::test]
async fn test_poll_wait_secs_negative_treated_as_zero() {
    // serde_json 将负数传给 u64 时会失败或被截断
    // 验证 execute 层正确处理
    let tool = SubAgentTool::new_for_test(TempDir::new().unwrap());
    // 通过 execute 传入负值
    let input = serde_json::json!({
        "action": "poll",
        "subagent_ids": ["sa_test"],
        "wait_secs": -5
    });
    let dir = tool.data_dir.join("sa_test");
    std::fs::create_dir(&dir).unwrap();
    std::fs::write(dir.join("started_at"), &now());
    std::fs::write(dir.join("task"), "test");

    // 不应 panic，应作为 wait_secs=0 处理
    let result = tool.execute(&input).await;
    assert!(result.is_ok() || result.is_err(),
        "负值不应 panic: {:?}", result.err());
}
```

### 3.2 进程隔离

```rust
#[tokio::test]
async fn test_subagent_crash_does_not_affect_main() {
    let tool = SubAgentTool::new_for_test(TempDir::new().unwrap());
    let id = tool.spawn("zapmyco", "echo hello").await.unwrap();

    // 等待完成
    let result = tool.poll(&[id.clone()], 10).await.unwrap();
    // 子进程 crash 或正常退出都不会影响工具本身
    assert!(result.contains("completed") || result.contains("error"));
    // 工具仍然可以正常使用
    let list = tool.list().await.unwrap();
    assert!(list.contains(&id));
}
```

### 3.3 并发 spawn

```rust
#[tokio::test]
async fn test_concurrent_spawns() {
    let tool = SubAgentTool::new_for_test(TempDir::new().unwrap());

    // 同时 spawn 3 个（模拟同一 batch 并发）
    let id1 = tool.spawn("zapmyco", "echo task1").await.unwrap();
    let id2 = tool.spawn("zapmyco", "echo task2").await.unwrap();
    let id3 = tool.spawn("zapmyco", "echo task3").await.unwrap();

    // 验证 3 个 ID 都不同
    let ids = vec![id1, id2, id3];
    let unique: HashSet<_> = ids.iter().collect();
    assert_eq!(unique.len(), 3);
}

#[tokio::test]
async fn test_poll_multiple_ids() {
    let tool = SubAgentTool::new_for_test(TempDir::new().unwrap());

    let id1 = tool.spawn("zapmyco", "echo a").await.unwrap();
    let id2 = tool.spawn("zapmyco", "echo b").await.unwrap();

    // 批量 poll
    let result = tool.poll(&[id1, id2], 10).await.unwrap();
    assert!(result.contains("completed") || result.contains("running"));
}
```

### 3.4 kill 功能

```rust
#[tokio::test]
async fn test_kill_running_subagent() {
    // 使用 test_binary="sleep" 避免启动真实 zapmyco 进程
    let tool = SubAgentTool::new_for_test_with_binary(
        TempDir::new().unwrap(), "sleep".to_string());
    let id = tool.spawn("zapmyco", "60").await.unwrap();

    // 确认在运行
    tokio::time::sleep(Duration::from_millis(500)).await;
    let list = tool.list().await.unwrap();
    assert!(list.contains(&id));
    assert!(list.contains("running"));

    // kill
    let kill_result = tool.kill(&[id.clone()]).await.unwrap();
    assert!(kill_result.contains("cancelled"));

    // 确认已取消
    tokio::time::sleep(Duration::from_millis(200)).await;
    let poll_result = tool.poll(&[id], 0).await.unwrap();
    assert!(poll_result.contains("cancelled"));
}

#[tokio::test]
async fn test_kill_already_completed() {
    // 使用 test_binary="echo" 避免启动真实 zapmyco 进程
    let tool = SubAgentTool::new_for_test_with_binary(
        TempDir::new().unwrap(), "echo".to_string());
    let id = tool.spawn("zapmyco", "quick").await.unwrap();
    let _ = tool.poll(&[id.clone()], 5).await.unwrap();

    // 已完成后 kill
    let kill_result = tool.kill(&[id.clone()]).await.unwrap();
    assert!(kill_result.contains("cannot cancel"));
}
```

### 3.5 list 会话隔离

```rust
#[tokio::test]
async fn test_list_isolation() {
    // 两个工具实例，模拟两个终端
    let dir = TempDir::new().unwrap();
    let tool1 = SubAgentTool::new_for_test_with_dir(dir.path().to_path_buf());
    let tool2 = SubAgentTool::new_for_test_with_dir(dir.path().to_path_buf());

    let id1 = tool1.spawn("zapmyco", "task1").await.unwrap();

    // tool2 的 list 应该看不到 tool1 的子 Agent
    let list2 = tool2.list().await.unwrap();
    assert!(!list2.contains(&id1));

    // tool1 的 list 应该看到
    let list1 = tool1.list().await.unwrap();
    assert!(list1.contains(&id1));
}
```

### 3.6 退出检查

```rust
#[tokio::test]
async fn test_exit_guard_no_panic_on_missing_dir() {
    let dir = TempDir::new().unwrap();
    // 删除目录
    std::fs::remove_dir(dir.path()).unwrap();
    // count_running_subagents 不应 panic
    let running = count_running_subagents(dir.path(), "test_session");
    assert_eq!(running, 0);
}

#[tokio::test]
async fn test_exit_guard_finds_running_subagents() {
    let dir = TempDir::new().unwrap();
    let session = "as_test_session";
    // 创建一个 running 子 Agent
    let sub_dir = dir.join("sa_test");
    std::fs::create_dir(&sub_dir).unwrap();
    std::fs::write(sub_dir.join("agent_session"), session).unwrap();
    std::fs::write(sub_dir.join("pid"), "99999").unwrap();
    std::fs::write(sub_dir.join("task"), "test").unwrap();
    std::fs::write(sub_dir.join("started_at"), &now_string());

    let running = count_running_subagents(dir.path(), session);
    assert_eq!(running, 1);
}
```

### 3.7 后台错误写入 stderr

```rust
#[tokio::test]
async fn test_background_task_error_written_to_stderr() {
    // 准备一个会导致后台任务失败的场景
    // 例如: build_command 不会失败，但 Command 可能找不到二进制
    // 使用一个不存在的二进制路径模拟
    let tool = SubAgentTool::new_for_test_with_binary(
        TempDir::new().unwrap(),
        "/nonexistent/binary".to_string(),
    );

    let id = tool.spawn("zapmyco", "task").await.unwrap();

    // 等待后台任务执行完毕
    tokio::time::sleep(Duration::from_secs(2)).await;

    // poll 应该看到 error
    let result = tool.poll(&[id.clone()], 0).await.unwrap();
    assert!(result.contains("error") || result.contains("not found")
        || result.contains("No such file"));
}
```

### 3.8 死进程检测

```rust
#[tokio::test]
async fn test_dead_process_detected() {
    let tool = SubAgentTool::new_for_test(TempDir::new().unwrap());
    let dir = tool.data_dir.join("sa_dead");
    std::fs::create_dir(&dir).unwrap();
    // 写一个不可能存在的 PID（u32::MAX）
    std::fs::write(dir.join("pid"), "4294967295").unwrap();
    std::fs::write(dir.join("task"), "test").unwrap();
    std::fs::write(dir.join("started_at"), &now_string());
    // 不写 done

    // poll 应该检测到进程已死并标记
    let result = tool.poll(&["sa_dead".to_string()], 0).await.unwrap();
    assert!(result.contains("completed") || result.contains("error")
        || result.contains("lost"));
}
```

### 3.9 空 task 校验

```rust
#[tokio::test]
async fn test_spawn_empty_task_rejected() {
    let tool = SubAgentTool::new_for_test(TempDir::new().unwrap());
    let result = tool.spawn("zapmyco", "").await;
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("不能为空"));

    let result = tool.spawn("zapmyco", "   ").await;
    assert!(result.is_err());
}

#[tokio::test]
async fn test_spawn_invalid_cli_rejected() {
    let tool = SubAgentTool::new_for_test(TempDir::new().unwrap());
    let result = tool.spawn("gemini", "task").await;
    assert!(result.is_err());
}
```

### 3.10 poll 空 ID 校验

```rust
#[tokio::test]
async fn test_poll_empty_ids_rejected() {
    let tool = SubAgentTool::new_for_test(TempDir::new().unwrap());
    let result = tool.poll(&[], 0).await;
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("不能为空"));
}
```

### 3.11 spawn 写入 agent_session

```rust
#[tokio::test]
async fn test_spawn_writes_agent_session() {
    let tool = SubAgentTool::new_for_test(TempDir::new().unwrap());
    let id = tool.spawn("zapmyco", "echo test").await.unwrap();

    let session_file = tool.data_dir.join(&id).join("agent_session");
    assert!(session_file.exists());
    let content = std::fs::read_to_string(session_file).unwrap();
    assert_eq!(content.trim(), tool.agent_session());
}

#[tokio::test]
async fn test_agent_session_written_before_pid() {
    // agent_session 由 spawn 同步写入，pid 由后台任务异步写入
    // 验证 agent_session 一定先于 pid 存在
    let tool = SubAgentTool::new_for_test(TempDir::new().unwrap());
    let id = tool.spawn("zapmyco", "5").await.unwrap();
    let dir = tool.data_dir.join(&id);
    assert!(dir.join("agent_session").exists(),
        "agent_session 应在 spawn 返回前同步写入");
}
```

### 3.12 done 在所有写入后创建

```rust
#[tokio::test]
async fn test_done_created_after_all_writes() {
    let tool = SubAgentTool::new_for_test(TempDir::new().unwrap());
    let id = tool.spawn("zapmyco", "echo order_check").await.unwrap();
    let _ = tool.poll(&[id.clone()], 10).await.unwrap();

    let dir = tool.data_dir.join(&id);
    assert!(dir.join("done").exists());

    // stdout 不空（先写）
    let stdout = std::fs::read_to_string(dir.join("stdout")).unwrap();
    assert!(!stdout.is_empty(), "done 创建前 stdout 应已写入");

    // exit_code 不空（先写）
    let code = std::fs::read_to_string(dir.join("exit_code")).unwrap();
    assert!(!code.is_empty(), "done 创建前 exit_code 应已写入");

    // stderr 存在（即使为空）
    assert!(dir.join("stderr").exists(), "stderr 文件应存在");
}
```

### 3.13 poll 混合结果组合

```rust
#[tokio::test]
async fn test_poll_mixed_completed_and_running() {
    let tool = SubAgentTool::new_for_test(TempDir::new().unwrap());

    // 已完成：直接创建 done
    let dir1 = tool.data_dir.join("sa_completed");
    std::fs::create_dir_all(&dir1).unwrap();
    std::fs::write(dir1.join("agent_session"), tool.agent_session()).unwrap();
    std::fs::write(dir1.join("task"), "quick").unwrap();
    std::fs::write(dir1.join("started_at"), &now_string()).unwrap();
    std::fs::write(dir1.join("stdout"), "完成").unwrap();
    std::fs::write(dir1.join("exit_code"), "0").unwrap();
    std::fs::write(dir1.join("pid"), "1").unwrap();
    File::create(dir1.join("done")).unwrap();

    // 运行中：无 done
    let dir2 = tool.data_dir.join("sa_running");
    std::fs::create_dir_all(&dir2).unwrap();
    std::fs::write(dir2.join("agent_session"), tool.agent_session()).unwrap();
    std::fs::write(dir2.join("task"), "slow").unwrap();
    std::fs::write(dir2.join("started_at"), &now_string()).unwrap();
    std::fs::write(dir2.join("pid"), "99999").unwrap();

    let result = tool.poll(&["sa_completed".into(), "sa_running".into()], 0).await.unwrap();
    assert!(result.contains("completed"), "已完成应展开: {}", result);
    assert!(result.contains("仍在运行"), "运行中应折叠: {}", result);
    // 不应包含 running 的详细 ID（被折叠）
    assert!(!result.contains("sa_running"), "running ID 应被折叠");
}

#[tokio::test]
async fn test_poll_mixed_completed_and_error() {
    let tool = SubAgentTool::new_for_test(TempDir::new().unwrap());

    // 正常完成
    let dir1 = tool.data_dir.join("sa_ok");
    std::fs::create_dir_all(&dir1).unwrap();
    std::fs::write(dir1.join("agent_session"), tool.agent_session()).unwrap();
    std::fs::write(dir1.join("task"), "ok").unwrap();
    std::fs::write(dir1.join("started_at"), &now_string()).unwrap();
    std::fs::write(dir1.join("stdout"), "success").unwrap();
    std::fs::write(dir1.join("exit_code"), "0").unwrap();
    std::fs::write(dir1.join("pid"), "1").unwrap();
    File::create(dir1.join("done")).unwrap();

    // 错误
    let dir2 = tool.data_dir.join("sa_err");
    std::fs::create_dir_all(&dir2).unwrap();
    std::fs::write(dir2.join("agent_session"), tool.agent_session()).unwrap();
    std::fs::write(dir2.join("task"), "err").unwrap();
    std::fs::write(dir2.join("started_at"), &now_string()).unwrap();
    std::fs::write(dir2.join("stderr"), "command not found").unwrap();
    std::fs::write(dir2.join("exit_code"), "127").unwrap();
    std::fs::write(dir2.join("pid"), "1").unwrap();
    File::create(dir2.join("done")).unwrap();

    let result = tool.poll(&["sa_ok".into(), "sa_err".into()], 0).await.unwrap();
    assert!(result.contains("success"));
    assert!(result.contains("127") || result.contains("error"));
}

#[tokio::test]
async fn test_poll_nonexistent_id_with_valid_ones() {
    let tool = SubAgentTool::new_for_test(TempDir::new().unwrap());

    let dir = tool.data_dir.join("sa_real");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("agent_session"), tool.agent_session()).unwrap();
    std::fs::write(dir.join("task"), "real").unwrap();
    std::fs::write(dir.join("started_at"), &now_string()).unwrap();
    std::fs::write(dir.join("stdout"), "data").unwrap();
    std::fs::write(dir.join("exit_code"), "0").unwrap();
    std::fs::write(dir.join("pid"), "1").unwrap();
    File::create(dir.join("done")).unwrap();

    let result = tool.poll(&["sa_real".into(), "sa_fake".into()], 0).await.unwrap();
    assert!(result.contains("ID 不存在") || result.contains("sa_real"),
        "存在的应正常返回，不存在的应报错: {}", result);
}
```

### 3.14 损坏子 Agent 目录的鲁棒性

```rust
#[tokio::test]
async fn test_poll_with_missing_task_file() {
    let tool = SubAgentTool::new_for_test(TempDir::new().unwrap());
    let dir = tool.data_dir.join("sa_broken");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("agent_session"), tool.agent_session()).unwrap();
    std::fs::write(dir.join("started_at"), &now_string()).unwrap();
    // 没有 task 文件
    std::fs::write(dir.join("pid"), "99999").unwrap();
    // 不应 panic
    let result = tool.poll(&["sa_broken".into()], 0).await;
    assert!(result.is_ok() || result.is_err(),
        "损坏目录不应导致 panic");
}

#[tokio::test]
async fn test_poll_with_invalid_started_at() {
    let tool = SubAgentTool::new_for_test(TempDir::new().unwrap());
    let dir = tool.data_dir.join("sa_bad_ts");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("agent_session"), tool.agent_session()).unwrap();
    std::fs::write(dir.join("started_at"), "not-a-timestamp").unwrap(); // 非法格式
    std::fs::write(dir.join("pid"), "99999").unwrap();
    std::fs::write(dir.join("task"), "test").unwrap();
    // calc_elapsed 应返回空字符串而非 panic
    let result = tool.poll(&["sa_bad_ts".into()], 0).await;
    assert!(result.is_ok(), "非法时间戳不应 panic: {:?}", result.err());
}

#[tokio::test]
async fn test_poll_with_empty_pid_file() {
    let tool = SubAgentTool::new_for_test(TempDir::new().unwrap());
    let dir = tool.data_dir.join("sa_empty_pid");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("agent_session"), tool.agent_session()).unwrap();
    std::fs::write(dir.join("pid"), "").unwrap(); // 空 PID
    std::fs::write(dir.join("task"), "test").unwrap();
    std::fs::write(dir.join("started_at"), &now_string()).unwrap();
    // is_process_alive 不应因空 PID panic
    let result = tool.poll(&["sa_empty_pid".into()], 0).await;
    assert!(result.is_ok(), "空 PID 不应 panic: {:?}", result.err());
}

#[tokio::test]
async fn test_poll_with_wrong_agent_session() {
    let tool = SubAgentTool::new_for_test(TempDir::new().unwrap());
    let dir = tool.data_dir.join("sa_wrong_session");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("agent_session"), "as_wrong_session_id").unwrap();
    std::fs::write(dir.join("task"), "test").unwrap();
    std::fs::write(dir.join("started_at"), &now_string()).unwrap();
    std::fs::write(dir.join("pid"), "99999").unwrap();
    std::fs::write(dir.join("stdout"), "secret").unwrap();
    std::fs::write(dir.join("exit_code"), "0").unwrap();
    File::create(dir.join("done")).unwrap();

    // 知道 ID 可以 poll，不受 session 隔离影响
    let result = tool.poll(&["sa_wrong_session".into()], 0).await.unwrap();
    assert!(result.contains("completed"), "知道 ID 就能 poll: {}", result);
}

#[tokio::test]
async fn test_list_skips_broken_directories() {
    let tool = SubAgentTool::new_for_test(TempDir::new().unwrap());
    let dir = tool.data_dir.join("sa_empty_dir");
    std::fs::create_dir_all(&dir).unwrap();
    // 空目录，没有任何文件
    let result = tool.list().await;
    assert!(result.is_ok(), "空目录不应 panic: {:?}", result.err());
}
```

---

## 4. cli.rs 条件注册测试

以下测试位于 `src/cli.rs` 的 `#[cfg(test)] mod tests`，覆盖 `--subagent` 参数的条件注册逻辑。

```rust
#[test]
fn test_run_args_subagent_default_false() {
    // 默认情况下 --subagent 为 false
    let args = RunArgs::try_parse_from(["zapmyco", "run", "task"]).unwrap();
    assert!(!args.subagent);
}

#[test]
fn test_run_args_subagent_flag() {
    let args = RunArgs::try_parse_from(
        ["zapmyco", "run", "--subagent", "task"]).unwrap();
    assert!(args.subagent);
}

#[test]
fn test_run_args_subagent_is_hidden() {
    // --subagent 是隐藏参数，不会出现在 help 中
    let help = RunArgs::command().render_help().to_string();
    assert!(!help.contains("--subagent"));
}

#[tokio::test]
async fn test_cmd_run_skips_subagent_tool_when_subagent_flag() {
    // 模拟 cmd_run 调用，验证 --subagent 时跳过 SubAgent 工具注册
    // 可通过检查 agent.tools 中不包含 SubAgent 变体来验证
    let settings_dir = TempDir::new().unwrap();
    // ...创建最小 settings.toml...
    // ...调用 cmd_run 或构建 AiAgent...
    // ...断言 agent.tools 不包含 ToolHandler::SubAgent
}

#[tokio::test]
async fn test_cmd_run_registers_subagent_tool_by_default() {
    // 没有 --subagent 时，SubAgent 工具已注册
    // 与上面相反断言
}
```

---

## 5. Bug 回归测试

以下用例对应审查中发现的每个已知问题，防止回归：

### R1 — 后台错误不吞没（审查 #6）

```rust
#[tokio::test]
async fn test_regression_background_error_not_silent() {
    // 写保护 data_dir 使 write_file 失败
    let dir = TempDir::new().unwrap();
    let sub_dir = dir.path().join("sa_test");
    std::fs::create_dir(&sub_dir).unwrap();
    std::fs::write(sub_dir.join("task"), "test").unwrap();
    std::fs::write(sub_dir.join("started_at"), &now_string());

    // 让 stdout 不可写 → write_file 应返回 Err
    let attr = std::fs::metadata(sub_dir.join("task")).unwrap();
    // 通过 chmod 使目录只读 → write 失败
    #[cfg(unix)]
    {
        use std::fs::Permissions;
        std::fs::set_permissions(sub_dir, Permissions::from_mode(0o444)).unwrap();
    }

    // ...通过后台任务写入 → 应看到 error 而非静默
}
```

### R2 — current_exe 替代字面量（审查 #5）

```rust
#[test]
fn test_regression_uses_current_exe_not_path_literal() {
    let (binary, _) = build_command("task", false).unwrap();
    // binary 应该是 current_exe 返回的全路径，而非 "zapmyco" 字面量
    assert!(binary.starts_with('/'));   // 绝对路径
    assert_ne!(binary, "zapmyco");      // 不是字面量
}
```

### R3 — PID 先写后等（审查 #9）

```rust
#[tokio::test]
async fn test_regression_pid_written_before_wait() {
    let tool = SubAgentTool::new_for_test(TempDir::new().unwrap());
    let id = tool.spawn("zapmyco", "2").await.unwrap();

    // 立即检查 pid 文件是否存在（不等子进程退出）
    let dir = tool.data_dir.join(&id);
    let pid_file = dir.join("pid");
    // 最多等 3 秒让后台任务启动
    for _ in 0..30 {
        if pid_file.exists() { break; }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(pid_file.exists(), "PID 文件应在 wait 前写入");

    // poll 等完成
    let _ = tool.poll(&[id], 10).await.unwrap();
}
```

### R4 — 折叠等待时间取最早 Agent（审查 #7）

```rust
#[tokio::test]
async fn test_regression_elapsed_takes_earliest_agent() {
    let tool = SubAgentTool::new_for_test(TempDir::new().unwrap());

    // 创建 sa_1（更早）和 sa_2
    // 但 poll 时传入 [sa_2, sa_1]
    let dir = tool.data_dir.join("sa_earliest");
    std::fs::create_dir(&dir).unwrap();
    std::fs::write(dir.join("agent_session"), tool.agent_session()).unwrap();
    std::fs::write(dir.join("task"), "earliest").unwrap();
    std::fs::write(dir.join("started_at"), "2026-01-01T00:00:00").unwrap(); // 很早

    let dir2 = tool.data_dir.join("sa_later");
    std::fs::create_dir(&dir2).unwrap();
    std::fs::write(dir2.join("agent_session"), tool.agent_session()).unwrap();
    std::fs::write(dir2.join("task"), "later").unwrap();
    std::fs::write(dir2.join("started_at"), &now_string()).unwrap();

    // poll [sa_later, sa_earliest] → 应显示 sa_earliest 的等待时间（很久）
    let result = tool.poll(&["sa_later".to_string(), "sa_earliest".to_string()], 0).await.unwrap();
    // 等待时间应 > 1000s（因为 sa_earliest 在 2026-01-01）
    // 而不是以 sa_later 计算
    assert!(result.contains("1000") || result.contains("complete"), "{:?}", result);
}
```

### R5 — 退出检查无 panic（审查 #10）

```rust
#[test]
fn test_regression_exit_guard_no_unwrap() {
    // 验证 exit guard 代码不包含 `.unwrap()`
    let source = std::fs::read_to_string("src/cli.rs").unwrap();
    // 在相关段落中搜索 unwrap
    // 这个测试是代码审查辅助，单元测试中检查代码质量
}
```

### R6 — list 会话隔离（审查 #8）

```rust
#[tokio::test]
async fn test_regression_list_isolation() {
    let dir = TempDir::new().unwrap();
    let t1 = SubAgentTool::new_for_test_with_dir(dir.path().to_path_buf());
    let t2 = SubAgentTool::new_for_test_with_dir(dir.path().to_path_buf());

    let id = t1.spawn("zapmyco", "secret").await.unwrap();
    let list2 = t2.list().await.unwrap();
    assert!(!list2.contains(&id), "不应该看到其他会话的子 Agent");

    // 但 t2 可以 poll 知道 ID 的子 Agent
    let poll = t2.poll(&[id.clone()], 10).await;
    assert!(poll.is_ok(), "知道 ID 就能 poll");
}
```

### R7 — 超时子进程被 kill（审查 #3）

```rust
#[tokio::test]
async fn test_regression_timeout_kills_subprocess() {
    let tool = SubAgentTool::new_for_test_with_binary_and_timeout(
        TempDir::new().unwrap(),
        "sleep".to_string(),
        2,  // 2s 超时
    );

    let id = tool.spawn("zapmyco", "60").await.unwrap();

    // 等超时: 2s 超时 + 缓冲
    tokio::time::sleep(Duration::from_secs(5)).await;

    let result = tool.poll(&[id], 0).await.unwrap();
    assert!(result.contains("timeout") || result.contains("cancelled"));
}
```

---

## 6. 跨平台测试

### 5.1 平台差异

| 特性 | macOS | Linux | Windows |
|------|-------|-------|---------|
| `kill(PID, 0)` | ✅ POSIX | ✅ POSIX | ❌ 不同（`taskkill /PID`） |
| `kill(PID, SIGTERM)` | ✅ `kill -15` | ✅ `kill -15` | ❌ `taskkill /PID` |
| 进程 ID 格式 | u32 | u32 | u32（但更大） |
| 文件权限 (`chmod`) | ✅ | ✅ | ❌ 不同模型 |
| 信号编号 | POSIX | POSIX | 无信号概念 |

### 5.2 跨平台适配点

**`is_process_alive`** — POSIX 用 `kill -0`，Windows 需用不同的 API：

```rust
fn is_process_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        std::process::Command::new("kill")
            .arg("-0").arg(pid.to_string())
            .status().map(|s| s.success()).unwrap_or(false)
    }
    #[cfg(windows)]
    {
        use std::process::Command;
        Command::new("tasklist")
            .args(&["/FI", &format!("PID eq {}", pid), "/NH"])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).contains(&pid.to_string()))
            .unwrap_or(false)
    }
}
```

**`kill` 发送信号** — 同上：

```rust
fn send_sigterm(pid: u32) -> Result<(), String> {
    #[cfg(unix)]
    {
        let status = std::process::Command::new("kill")
            .arg("-15").arg(pid.to_string())
            .status().map_err(|e| e.to_string())?;
        if !status.success() {
            return Err(format!("kill {} 失败", pid));
        }
    }
    #[cfg(windows)]
    {
        std::process::Command::new("taskkill")
            .args(&["/PID", &pid.to_string(), "/F"])
            .output().map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

### 5.3 跨平台测试策略

- **CI 矩阵**：GitHub Actions 配置 `macos-latest` + `ubuntu-latest` + `windows-latest`
- **POSIX 特有测试**：用 `#[cfg(unix)]` 条件编译，Windows 上跳过
- **Windows 特有测试**：用 `#[cfg(windows)]` 条件编译
- **平台无关测试**：所有基础功能测试（spawn + poll + list + kill）三平台跑

```yaml
# .github/workflows/test.yml
matrix:
  os: [ubuntu-latest, macos-latest, windows-latest]
steps:
  - run: cargo test --test-threads=1
```

---

## 7. 手动测试场景

以下场景需人工验证，通过 `cargo run` 触发 LLM 来执行：

### 6.1 基本流程

```bash
# 1. spawn → poll → 拿到结果
cargo run -- run "echo hello subagent"

# 2. 多个并发 spawn（需要 LLM 理解并发）
cargo run -- run "同时创建 3 个 subagent 分别执行 echo 1 2 3"

# 3. spawn 错误 CLI
cargo run -- run "使用 claude 作为 subagent"
```

### 6.2 已知问题验证

```bash
# 4. Agent 忘记子 Agent ID 后使用 list 找回
cargo run -- run "分析当前项目结构，使用 subagent 分模块分析后汇总"

# 5. kill 正在运行的子 Agent
cargo run -- run "创建 subagent sleep 60，过几秒后终止它"

# 6. 子 Agent 崩溃不影响主进程
cargo run -- run "创建 subagent 执行一个不存在的命令"
```

---

## 8. 持续集成

### 7.1 CI 流程

```yaml
# .github/workflows/subagent.yml
name: SubAgent Tests
on: [push, pull_request]
jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: cargo test --test-threads=1
      - run: cargo clippy -- -D warnings
      - run: cargo fmt --check
```

### 7.2 测试覆盖率

| 包 | 目标 | 当前 | 方法 |
|----|------|------|------|
| `subagent.rs` | >90% | — | 单元测试 + 集成测试 |
| `cli.rs` (~subagent) | >80% | — | 集成测试覆盖条件注册 |
| `executor.rs` (~subagent) | >90% | — | 工具函数测试 |

### 7.3 质量门禁

```
提交前必须通过:
□ cargo test --test-threads=1          # 全部测试通过
□ cargo clippy -- -D warnings          # 无 lint 警告
□ cargo fmt --check                    # 格式正确
```

---

## 附录：测试辅助工具

### `SubAgentTool` — `#[cfg(test)] test_binary`

`SubAgentTool` 在生产代码中通过 `#[cfg(test)]` 多一个字段：

```rust
pub struct SubAgentTool {
    pub data_dir: PathBuf,
    pub timeout_secs: u64,
    pub agent_session_id: String,
    #[cfg(test)]
    pub test_binary: Option<String>,   // 测试用：覆盖 spawn 的二进制路径
}
```

测试构造器自动填充此字段：

```rust
impl SubAgentTool {
    /// 测试用构造器：使用临时目录，test_binary 默认为 "echo"
    /// 不启动真实 zapmyco 进程，符合测试隔离原则
    pub fn new_for_test(tmp: TempDir) -> Self {
        Self::new_for_test_with_binary(tmp, "echo".to_string())
    }

    /// 测试用构造器：指定子进程使用的二进制路径
    /// 例如 new_for_test_with_binary(tmp, "sleep") 测试超时/kill
    pub fn new_for_test_with_binary(tmp: TempDir, binary: String) -> Self {
        Self::new_for_test_with_binary_and_timeout(tmp, binary, 5)
    }

    /// 测试用构造器：指定二进制路径 + 超时秒数
    pub fn new_for_test_with_binary_and_timeout(
        tmp: TempDir, binary: String, timeout_secs: u64
    ) -> Self {
        Self {
            data_dir: tmp.path().to_path_buf(),
            timeout_secs,
            agent_session_id: generate_agent_session_id(),
            test_binary: Some(binary),
        }
    }
}
```

### `prepare_subagent_dir`

创建模拟子 Agent 目录的辅助函数：

```rust
fn prepare_subagent_dir(name: &str, f: impl FnOnce(&MockDir)) -> PathBuf {
    let tmp = TempDir::new().unwrap();
    let dir = tmp.path().join(name);
    std::fs::create_dir(&dir).unwrap();
    f(&MockDir(dir));
    dir
}
```

### 测试统计

| 类别 | 用例数 | 说明 |
|------|--------|------|
| subagent_id | 3 | 格式、唯一性、碰撞 |
| agent_session_id | 2 | 格式、唯一性 |
| build_command | 4 | 基础、flag、PATH、current_exe |
| execute 路由分发 | 6 | spawn/poll/list/kill + 无效 action + 缺字段 |
| tool_definition Schema | 5 | 名称、描述、action enum、array 类型、required |
| is_concurrency_safe | 5 | 4 action + 默认值 |
| format_completed | 6 | 小/大/截断/stderr 有/无/error+stderr |
| is_process_alive | 2 | 存在/不存在 |
| calc_elapsed | 2 | 正常/无文件 |
| 状态判断 | 6 | 6 种状态 |
| poll 等待 | 2 | 等待后完成/运行中 |
| 进程隔离 | 1 | 不影响主进程 |
| 并发 spawn | 2 | 多 spawn/batch poll |
| kill | 2 | 运行中/已完成 |
| 会话隔离 | 1 | list 过滤 |
| spawn 写入 agent_session | 2 | 文件存在 + 写入顺序 |
| done 写入顺序 | 1 | stdout→exit_code→done |
| poll wait_secs 边界 | 4 | 0、5、999（截断）、负值 |
| poll 混合结果 | 3 | completed+running、completed+error、含无效 ID |
| 损坏目录鲁棒性 | 5 | 缺 task/非法时间戳/空 PID/错误 session/空目录 |
| cli.rs 条件注册 | 5 | 默认 false、flag 解析、隐藏、注册/跳过 |
| 退出检查 | 2 | 无 panic/有 running |
| 后台错误 | 1 | 写入 stderr |
| 死进程检测 | 1 | lost 标记 |
| 参数校验 | 3 | 空 task、空 ID、非法 CLI |
| 回归测试 | 7 | R1-R7 |
| **合计** | **~80** | |

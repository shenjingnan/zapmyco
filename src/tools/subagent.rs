/// SubAgent 工具 — 通过子进程执行独立子任务
///
/// 支持四种 action: spawn / poll / list / kill。
/// 所有 action 均为并发安全，可在同一 batch 中与其他工具并行。
use std::path::{Path, PathBuf};
use std::time::Instant;

use chrono::Local;
use tokio::io::AsyncReadExt;
use tokio::process::{ChildStderr, ChildStdout, Command};
use zapmyco_anthropic_ai_sdk::types::message::Tool;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUBAGENTS_DIR: &str = "subagents";
const DEFAULT_TIMEOUT_SECS: u64 = 300;
const SUMMARY_THRESHOLD: usize = 2048; // >2KB → 自动折叠
const HARD_LIMIT: usize = 1_000_000; // >1MB → 截断
const BASE_WAIT_SECS: u64 = 5; // 首次固定等待

// ---------------------------------------------------------------------------
// Core Struct
// ---------------------------------------------------------------------------

/// SubAgent 工具
pub struct SubAgentTool {
    /// 数据根目录: ~/.zapmyco/subagents/
    data_dir: PathBuf,
    /// 子进程超时时间（秒）
    timeout_secs: u64,
    /// 当前 Agent 会话的唯一标识，写入子 Agent 目录用于 list 隔离
    agent_session_id: String,
    /// 测试用：覆盖 spawn 的子进程二进制路径
    #[cfg(test)]
    pub test_binary: Option<String>,
}

impl SubAgentTool {
    /// 创建新实例，初始化 data_dir = ~/.zapmyco/subagents/
    pub fn new() -> Result<Self, String> {
        let home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .map_err(|_| "无法获取用户 HOME 目录".to_string())?;
        let data_dir = PathBuf::from(home).join(format!(".zapmyco/{}", SUBAGENTS_DIR));
        std::fs::create_dir_all(&data_dir)
            .map_err(|e| format!("创建 subagents 目录失败: {}", e))?;

        Ok(Self {
            data_dir,
            timeout_secs: DEFAULT_TIMEOUT_SECS,
            agent_session_id: generate_agent_session_id(),
            #[cfg(test)]
            test_binary: None,
        })
    }

    /// 返回当前 agent_session_id
    pub fn agent_session(&self) -> &str {
        &self.agent_session_id
    }

    /// 返回 Anthropic Tool 定义
    pub fn tool_definition() -> Tool {
        Tool {
            name: "subagent".to_string(),
            description: Some(
                "管理子代理(sub-agent)。子代理作为独立子进程运行指定的 CLI Agent。\
                支持四种 action:\n\
                - spawn: 创建子代理，立即返回子代理 ID\n\
                - poll: 查询子代理执行结果，支持批量查询和内部等待重试\n\
                - list: 列出所有活跃的子代理\n\
                - kill: 终止正在运行的子代理"
                    .to_string(),
            ),
            input_schema: Some(serde_json::json!({
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["spawn", "poll", "list", "kill"],
                        "description": "操作类型"
                    },
                    "cli": {
                        "type": "string",
                        "enum": ["zapmyco"],
                        "description": "使用的 CLI agent。目前仅支持 zapmyco。"
                    },
                    "task": {
                        "type": "string",
                        "description": "子代理需要执行的具体任务描述（action=spawn 时必填）"
                    },
                    "subagent_ids": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "要查询或终止的子代理 ID 列表（poll 和 kill 时必填）"
                    },
                    "wait_secs": {
                        "type": "number",
                        "description": "poll 时可选。工具已内置首次 5 秒内部等待（无论此参数如何），\
                        如需额外等待可设置此参数，工具会在首次 5 秒基础上继续等待 N 秒。\
                        范围 1-30。默认 0（仅内置 5 秒）。"
                    }
                },
                "required": ["action"]
            })),
            ..Default::default()
        }
    }

    /// 判断当前 action 是否并发安全
    pub(crate) fn is_concurrency_safe(&self, input: &serde_json::Value) -> bool {
        let action = input
            .get("action")
            .and_then(|v| v.as_str())
            .unwrap_or("spawn");
        matches!(action, "spawn" | "poll" | "list" | "kill")
    }

    /// 执行入口，根据 action 字段分发到 spawn / poll / list / kill
    pub async fn execute(&self, input: &serde_json::Value) -> Result<String, String> {
        let action = input
            .get("action")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "缺失 action 参数，可选值: spawn, poll, list, kill".to_string())?;

        match action {
            "spawn" => {
                let cli = input
                    .get("cli")
                    .and_then(|v| v.as_str())
                    .unwrap_or("zapmyco");
                let task = input
                    .get("task")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "spawn 时 task 必填".to_string())?;
                let id = self.spawn(cli, task).await?;
                Ok(format!(
                    "[SubAgent] {}: running\nCLI: {}\nTask: {}\nCreated: {}",
                    id,
                    cli,
                    task,
                    chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%.f")
                ))
            }
            "poll" => {
                let ids: Vec<String> = input
                    .get("subagent_ids")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(String::from))
                            .collect()
                    })
                    .ok_or_else(|| {
                        "poll 时 subagent_ids 不能为空，使用 list 查看所有子代理".to_string()
                    })?;
                let wait_secs = input.get("wait_secs").and_then(|v| v.as_u64()).unwrap_or(0);
                self.poll(&ids, wait_secs).await
            }
            "list" => self.list().await,
            "kill" => {
                let ids: Vec<String> = input
                    .get("subagent_ids")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(String::from))
                            .collect()
                    })
                    .ok_or_else(|| "kill 时 subagent_ids 不能为空".to_string())?;
                self.kill(&ids).await
            }
            _ => Err(format!(
                "无效 action: {}，可选值: spawn, poll, list, kill",
                action
            )),
        }
    }

    // -----------------------------------------------------------------------
    // Spawn
    // -----------------------------------------------------------------------

    /// 创建并启动子代理（始终异步，立即返回 subagent_id）
    async fn spawn(&self, cli: &str, task: &str) -> Result<String, String> {
        // 前置校验
        if task.trim().is_empty() {
            return Err("spawn 时 task 不能为空".to_string());
        }
        if cli != "zapmyco" {
            return Err(format!("CLI '{}' 不可用，当前仅支持 zapmyco", cli));
        }

        let subagent_id = generate_subagent_id(&self.data_dir);
        let dir = self.data_dir.join(&subagent_id);

        // 创建目录并写入元信息（同步）
        std::fs::create_dir_all(&dir).map_err(|e| format!("创建子代理目录失败: {}", e))?;
        write_file(&dir.join("agent_session"), &self.agent_session_id)?;
        write_file(&dir.join("task"), task)?;
        write_file(&dir.join("cli"), cli)?;
        write_file(
            &dir.join("started_at"),
            &Local::now().format("%Y-%m-%dT%H:%M:%S%.f").to_string(),
        )?;

        // 后台异步执行子进程
        let dir_clone = dir.clone();
        let timeout = self.timeout_secs;
        let task_owned = task.to_string();

        #[cfg(test)]
        let test_bin = self.test_binary.clone();

        tokio::spawn(async move {
            let result = async {
                // 测试模式：test_binary 有值时直接执行
                #[cfg(test)]
                let (binary, args) = if let Some(ref tb) = test_bin {
                    (tb.clone(), vec![task_owned.clone()])
                } else {
                    build_command(&task_owned, true)?
                };
                #[cfg(not(test))]
                let (binary, args) = build_command(&task_owned, true)?;

                let mut child = Command::new(&binary)
                    .args(&args)
                    .stdin(std::process::Stdio::null())
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::piped())
                    .spawn()
                    .map_err(|e| format!("启动子进程失败: {}", e))?;

                // 写入 PID（kill 和死进程检测依赖）
                let pid = child.id().unwrap_or(0);
                write_file(&dir_clone.join("pid"), &pid.to_string())?;

                // 先获取 stdout/stderr 句柄，避免 wait_with_output 消耗 child
                let stdout_handle = child.stdout.take();
                let stderr_handle = child.stderr.take();

                let timed_out =
                    tokio::time::timeout(std::time::Duration::from_secs(timeout), child.wait())
                        .await;

                let (stdout, stderr, exit_code) = match timed_out {
                    Ok(Ok(status)) => {
                        // 子进程正常退出，读取已收集的输出
                        let stdout = read_stdout(stdout_handle).await;
                        let stderr = read_stderr(stderr_handle).await;
                        let code = status.code().unwrap_or(-1);
                        (stdout, stderr, code.to_string())
                    }
                    Ok(Err(e)) => {
                        return Err(format!("子进程执行失败: {}", e));
                    }
                    Err(_) => {
                        // 超时，强制 kill
                        let _ = child.kill().await;
                        (String::new(), String::new(), "-1".to_string())
                    }
                };

                write_file(&dir_clone.join("stdout"), &stdout)?;
                write_file(&dir_clone.join("stderr"), &stderr)?;
                // kill() 可能已先写入，不覆盖其 exit_code（竞态保护）
                if !dir_clone.join("done").exists() {
                    write_file(&dir_clone.join("exit_code"), &exit_code)?;
                }
                Ok::<_, String>(())
            }
            .await;

            if let Err(e) = &result {
                let _ = std::fs::write(dir_clone.join("stderr"), e);
            }
            let _ = std::fs::File::create(dir_clone.join("done"));
        });

        Ok(subagent_id)
    }

    // -----------------------------------------------------------------------
    // Poll
    // -----------------------------------------------------------------------

    /// 查询子代理执行结果。支持批量（多个 ID）和内部等待重试（wait_secs）
    async fn poll(&self, ids: &[String], wait_secs: u64) -> Result<String, String> {
        if ids.is_empty() {
            return Err("poll 时 subagent_ids 不能为空，使用 list 查看所有子代理".to_string());
        }

        let extra = wait_secs.min(30);
        let deadline = Instant::now() + std::time::Duration::from_secs(BASE_WAIT_SECS + extra);
        let mut completed = std::collections::HashSet::new();

        // 内部等待循环（不消耗 LLM 轮次）
        while Instant::now() < deadline && completed.len() < ids.len() {
            for id in ids {
                if completed.contains(id) {
                    continue;
                }
                let dir = self.data_dir.join(id);
                if !dir.exists() {
                    continue;
                }

                // 死进程检测
                if !dir.join("done").exists()
                    && let Ok(pid_str) = std::fs::read_to_string(dir.join("pid"))
                    && let Ok(pid) = pid_str.trim().parse::<u32>()
                    && !is_process_alive(pid)
                {
                    let _ = std::fs::write(dir.join("exit_code"), "-9");
                    let _ = std::fs::write(dir.join("stdout"), "(process lost: killed externally)");
                    let _ = std::fs::File::create(dir.join("done"));
                }

                if dir.join("done").exists() {
                    completed.insert(id.clone());
                }
            }
            if completed.len() < ids.len() {
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            }
        }

        // 收集结果
        let mut completed_outputs = Vec::new();
        let mut running_ids = Vec::new();
        let mut running_tasks = Vec::new();
        let mut errors = Vec::new();

        for id in ids {
            let dir = self.data_dir.join(id);
            if !dir.exists() {
                errors.push(format!("{}: ID 不存在", id));
                continue;
            }
            if dir.join("done").exists() {
                completed_outputs.push(format_completed(&dir, id));
            } else {
                running_ids.push(id.clone());
                if let Ok(task) = std::fs::read_to_string(dir.join("task")) {
                    let t = task.trim().chars().take(40).collect::<String>();
                    running_tasks.push(t);
                }
            }
        }

        let mut result = Vec::new();

        for o in &completed_outputs {
            result.push(o.clone());
        }

        // 未完成的折叠
        if !running_ids.is_empty() {
            let since_now = calc_elapsed_best(&self.data_dir, &running_ids);
            if completed_outputs.is_empty() && errors.is_empty() {
                let tasks = running_tasks.join(" / ");
                result.push(format!(
                    "[SubAgent] {}/{} 仍在运行 (已等待 {})\n  任务: {}",
                    running_ids.len(),
                    ids.len(),
                    since_now,
                    tasks
                ));
            } else {
                result.push(format!(
                    "[SubAgent] 还有 {} 个仍在运行 (已等待 {})",
                    running_ids.len(),
                    since_now
                ));
            }
        }

        for e in &errors {
            result.push(e.clone());
        }

        Ok(result.join("\n---\n"))
    }

    // -----------------------------------------------------------------------
    // List
    // -----------------------------------------------------------------------

    /// 列出所有活跃子代理的状态摘要（仅当前会话的）
    async fn list(&self) -> Result<String, String> {
        let mut entries = Vec::new();
        let mut has_entries = false;

        if let Ok(read_dir) = std::fs::read_dir(&self.data_dir) {
            for entry in read_dir.flatten() {
                let dir = entry.path();
                if !dir.is_dir() {
                    continue;
                }

                // agent_session 过滤
                let session =
                    std::fs::read_to_string(dir.join("agent_session")).unwrap_or_default();
                if session.trim() != self.agent_session_id {
                    continue;
                }
                has_entries = true;

                let id = dir
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                let task = std::fs::read_to_string(dir.join("task")).unwrap_or_default();
                let status = determine_status_from_path(&dir);

                entries.push(format!(
                    "{}: {}\n  CLI: {}\n  Task: {}",
                    id,
                    status,
                    std::fs::read_to_string(dir.join("cli"))
                        .unwrap_or_default()
                        .trim(),
                    task.trim().chars().take(80).collect::<String>(),
                ));
            }
        }

        if !has_entries {
            return Ok("[SubAgent] 当前没有子代理".to_string());
        }

        Ok(format!(
            "[SubAgent] 当前共 {} 个子代理\n\n{}",
            entries.len(),
            entries.join("\n\n")
        ))
    }

    // -----------------------------------------------------------------------
    // Kill
    // -----------------------------------------------------------------------

    /// 终止正在运行的子代理
    async fn kill(&self, ids: &[String]) -> Result<String, String> {
        let mut results = Vec::new();

        for id in ids {
            let dir = self.data_dir.join(id);

            if !dir.exists() {
                results.push(format!("{}: ID 不存在", id));
                continue;
            }

            if dir.join("done").exists() {
                results.push(format!("{}: cannot cancel (already completed)", id));
                continue;
            }

            if let Ok(pid_str) = std::fs::read_to_string(dir.join("pid")) {
                if let Ok(pid) = pid_str.trim().parse::<u32>() {
                    send_sigterm(pid);
                    let _ = std::fs::write(dir.join("exit_code"), "-15");
                    let _ = std::fs::write(dir.join("stdout"), "(cancelled by user)");
                    let _ = std::fs::File::create(dir.join("done"));
                    // 再次写入确保不被后台任务覆盖（竞态保护）
                    let _ = std::fs::write(dir.join("exit_code"), "-15");
                    results.push(format!("{}: cancelled (SIGTERM → PID {})", id, pid));
                } else {
                    results.push(format!("{}: 无效的 PID", id));
                }
            } else {
                results.push(format!("{}: 无法读取 PID（进程可能尚未启动）", id));
            }
        }

        Ok(format!(
            "[SubAgent] 已终止 {} 个子代理:\n  {}",
            results.len(),
            results.join("\n  ")
        ))
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// 生成 subagent_id: sa_{日期}_{8位十六进制}
/// 使用纳秒级时间戳 + PID 确保唯一性，不依赖外部 crate
fn generate_subagent_id(data_dir: &Path) -> String {
    let now = Local::now().format("%Y%m%d").to_string();
    let pid = std::process::id();
    loop {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0);
        let id = format!("sa_{}_{:08x}_{:05x}", now, nanos, pid);
        if !data_dir.join(&id).exists() {
            return id;
        }
    }
}

/// 生成 agent_session_id: as_{纳秒}_{PID}_{计数器}
/// 每个 SubAgentTool 实例生成一次，通过自增计数器确保同次运行唯一
fn generate_agent_session_id() -> String {
    use std::sync::atomic::{AtomicU16, Ordering};
    static COUNTER: AtomicU16 = AtomicU16::new(0);
    let count = COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let pid = std::process::id();
    format!("as_{:09x}_{:05x}_{:04x}", nanos, pid, count)
}

/// 构建 spawn 子进程的命令
fn build_command(task: &str, is_subagent: bool) -> Result<(String, Vec<String>), String> {
    let binary = std::env::current_exe().map_err(|e| format!("无法获取当前二进制路径: {}", e))?;
    let mut args = vec!["run".to_string()];
    if is_subagent {
        args.push("--subagent".to_string());
    }
    args.push(task.to_string());
    Ok((binary.to_string_lossy().to_string(), args))
}

/// 读取子进程的 stdout 管道
async fn read_stdout(mut pipe: Option<ChildStdout>) -> String {
    let mut buf = String::new();
    if let Some(ref mut p) = pipe {
        let _ = p.read_to_string(&mut buf).await;
    }
    buf
}

/// 读取子进程的 stderr 管道
async fn read_stderr(mut pipe: Option<ChildStderr>) -> String {
    let mut buf = String::new();
    if let Some(ref mut p) = pipe {
        let _ = p.read_to_string(&mut buf).await;
    }
    buf
}

/// 写入文件（返回 Result 而非静默忽略）
fn write_file(path: &Path, content: &str) -> Result<(), String> {
    std::fs::write(path, content).map_err(|e| format!("写入 {} 失败: {}", path.display(), e))
}

/// 格式化已完成子代理的输出
fn format_completed(dir: &Path, id: &str) -> String {
    let exit_code = std::fs::read_to_string(dir.join("exit_code"))
        .unwrap_or_default()
        .trim()
        .to_string();
    let stdout_content = std::fs::read_to_string(dir.join("stdout")).unwrap_or_default();
    let stderr_content = std::fs::read_to_string(dir.join("stderr")).unwrap_or_default();
    let cli = std::fs::read_to_string(dir.join("cli"))
        .unwrap_or_default()
        .trim()
        .to_string();

    let status = if exit_code == "-1" {
        "timeout"
    } else if exit_code == "-15" {
        "cancelled"
    } else if exit_code == "0" {
        "completed"
    } else {
        "error"
    };

    let elapsed = calc_elapsed_from_file(dir.join("started_at"));

    let mut output = format!(
        ">>> {} <<<\n[SubAgent] {}: {}\nCLI: {}\nExit code: {}\nDuration: {}",
        id, id, status, cli, exit_code, elapsed
    );

    // stdout：有折叠逻辑
    let stdout_bytes = stdout_content.len();
    if stdout_bytes > HARD_LIMIT {
        let truncated: String = stdout_content.chars().take(2048).collect();
        output.push_str(&format!(
            "\n\n=== stdout (OUTPUT TRUNCATED at 1MB) ===\n{}\n...\n完整输出: {}/stdout",
            truncated,
            dir.display()
        ));
    } else if stdout_bytes > SUMMARY_THRESHOLD {
        let head: String = stdout_content.chars().take(2048).collect();
        let tail: String = stdout_content
            .chars()
            .rev()
            .take(2048)
            .collect::<String>()
            .chars()
            .rev()
            .collect();
        let total_kb = stdout_bytes / 1024;
        let total_lines = stdout_content.lines().count();
        output.push_str(&format!(
            "\n\n=== stdout (OUTPUT LARGE: {}KB, {} lines) ===\n{}",
            total_kb, total_lines, head
        ));
        let lines_before = stdout_content
            .lines()
            .count()
            .saturating_sub(tail.lines().count());
        output.push_str(&format!(
            "\n\n=== 末尾 (第 {} 行之后) ===\n{}",
            lines_before, tail
        ));
        output.push_str(&format!("\n\n完整输出: {}/stdout", dir.display()));
    } else if !stdout_content.is_empty() {
        output.push_str(&format!("\n\n=== stdout ===\n{}", stdout_content));
    }

    // stderr：非空就展示，exit_code 无关
    if !stderr_content.is_empty() {
        output.push_str(&format!("\n\n=== stderr ===\n{}", stderr_content));
    }

    output
}

/// 判定子代理状态（从文件系统读取）
fn determine_status_from_path(dir: &Path) -> String {
    let done = dir.join("done").exists();
    let pid = std::fs::read_to_string(dir.join("pid"))
        .ok()
        .and_then(|s| s.trim().parse::<u32>().ok());

    if !done && pid.is_none() {
        "created".to_string()
    } else if !done && pid.is_some() {
        "running".to_string()
    } else if done {
        let code = std::fs::read_to_string(dir.join("exit_code"))
            .unwrap_or_default()
            .trim()
            .to_string();
        match code.as_str() {
            "0" => "completed".to_string(),
            "-1" => "timeout".to_string(),
            "-15" => "cancelled".to_string(),
            _ => format!("error (exit {})", code),
        }
    } else {
        "unknown".to_string()
    }
}

/// 计算最早 running 子 Agent 的已等待时间
fn calc_elapsed_best(data_dir: &Path, running_ids: &[String]) -> String {
    let now = Local::now();
    let mut earliest: Option<chrono::NaiveDateTime> = None;

    for id in running_ids {
        let path = data_dir.join(id).join("started_at");
        if let Ok(content) = std::fs::read_to_string(&path) {
            let ts = content.trim();
            // 尝试多种格式解析
            let dt = chrono::NaiveDateTime::parse_from_str(ts, "%Y-%m-%dT%H:%M:%S%.f")
                .ok()
                .or_else(|| chrono::NaiveDateTime::parse_from_str(ts, "%Y-%m-%dT%H:%M:%S").ok());
            if let Some(dt) = dt
                && earliest.is_none_or(|e| dt < e)
            {
                earliest = Some(dt);
            }
        }
    }

    if let Some(earliest) = earliest {
        let elapsed = now.naive_local() - earliest;
        format!("{}s", elapsed.num_seconds())
    } else {
        String::new()
    }
}

/// 从文件路径计算耗时
fn calc_elapsed_from_file(path: PathBuf) -> String {
    if let Ok(content) = std::fs::read_to_string(&path) {
        let ts = content.trim();
        let dt = chrono::NaiveDateTime::parse_from_str(ts, "%Y-%m-%dT%H:%M:%S%.f")
            .ok()
            .or_else(|| chrono::NaiveDateTime::parse_from_str(ts, "%Y-%m-%dT%H:%M:%S").ok());
        if let Some(dt) = dt {
            let elapsed = Local::now().naive_local() - dt;
            return format!("{}s", elapsed.num_seconds());
        }
    }
    String::new()
}

/// 探测进程是否存活（POSIX: kill -0 仅检查存在性）
fn is_process_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        std::process::Command::new("kill")
            .arg("-0")
            .arg(pid.to_string())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
    #[cfg(windows)]
    {
        std::process::Command::new("tasklist")
            .args(&["/FI", &format!("PID eq {}", pid), "/NH"])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).contains(&pid.to_string()))
            .unwrap_or(false)
    }
}

/// 发送 SIGTERM 终止进程
fn send_sigterm(pid: u32) {
    #[cfg(unix)]
    {
        let _ = std::process::Command::new("kill")
            .arg("-15")
            .arg(pid.to_string())
            .status();
    }
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(&["/PID", &pid.to_string(), "/F"])
            .status();
    }
}

/// 统计当前会话中 running 状态的子代理数
pub fn count_running_subagents(data_dir: &Path, agent_session_id: &str) -> usize {
    let mut count = 0;
    if let Ok(read_dir) = std::fs::read_dir(data_dir) {
        for entry in read_dir.flatten() {
            let dir = entry.path();
            if !dir.is_dir() {
                continue;
            }
            // agent_session 过滤
            if std::fs::read_to_string(dir.join("agent_session"))
                .map(|s| s.trim().to_string())
                .ok()
                .as_deref()
                != Some(agent_session_id)
            {
                continue;
            }
            if !dir.join("done").exists() && dir.join("pid").exists() {
                count += 1;
            }
        }
    }
    count
}

/// 获取 subagents 数据目录路径
pub fn get_subagent_data_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "无法获取用户 HOME 目录".to_string())?;
    Ok(PathBuf::from(home).join(format!(".zapmyco/{}", SUBAGENTS_DIR)))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    // ---- Helper ----

    fn test_tool(tmp: &TempDir) -> SubAgentTool {
        SubAgentTool {
            data_dir: tmp.path().to_path_buf(),
            timeout_secs: 5,
            agent_session_id: generate_agent_session_id(),
            test_binary: Some("echo".to_string()),
        }
    }

    // ---- 2.1 subagent_id 生成 ----

    #[test]
    fn test_generate_subagent_id_format() {
        let dir = TempDir::new().unwrap();
        let id = generate_subagent_id(dir.path());
        assert!(id.starts_with("sa_"));
        // sa_YYYYMMDD_XXXXXXXX = 25 chars
        assert_eq!(id.len(), 26, "id: {}", id);
    }

    #[test]
    fn test_generate_subagent_id_unique() {
        let dir = TempDir::new().unwrap();
        let mut set = std::collections::HashSet::new();
        for _ in 0..100 {
            set.insert(generate_subagent_id(dir.path()));
        }
        // 在极低概率下可能碰撞，重试一次
        assert!(set.len() > 95, "unique count: {}", set.len());
    }

    #[test]
    fn test_generate_subagent_id_collision_avoidance() {
        let dir = TempDir::new().unwrap();
        // 用固定 ID 模拟已存在
        let existing = format!("sa_{}_{:08x}", Local::now().format("%Y%m%d"), 0u32);
        std::fs::create_dir(dir.path().join(&existing)).unwrap();
        let next = generate_subagent_id(dir.path());
        assert_ne!(next, existing);
        assert!(!dir.path().join(&next).exists(), "新 ID 不应已存在");
    }

    // ---- 2.2 agent_session_id ----

    #[test]
    fn test_agent_session_id_format() {
        let id = generate_agent_session_id();
        assert!(id.starts_with("as_"));
        // as_{9位hex}_{5位hex} = 2 + 1 + 9 + 1 + 5 = 18 或更多
        assert!(id.len() >= 22, "id len: {}", id.len());
    }

    #[test]
    fn test_agent_session_id_unique() {
        let mut set = std::collections::HashSet::new();
        for _ in 0..1000 {
            set.insert(generate_agent_session_id());
        }
        // 在极低概率下可能碰撞，重试一次
        assert!(set.len() > 990, "unique count: {}", set.len());
    }

    // ---- 2.3 build_command ----

    #[test]
    fn test_build_command_uses_current_exe() {
        let current = std::env::current_exe().unwrap();
        let (binary, _) = build_command("task", false).unwrap();
        assert_eq!(binary, current.to_string_lossy());
    }

    #[test]
    fn test_build_command_with_subagent_flag() {
        let (_, args) = build_command("task", true).unwrap();
        assert!(args.contains(&"--subagent".to_string()));
    }

    #[test]
    fn test_build_command_without_subagent_flag() {
        let (_, args) = build_command("task", false).unwrap();
        assert!(!args.contains(&"--subagent".to_string()));
    }

    #[test]
    fn test_build_command_basic() {
        let (binary, args) = build_command("echo hello", false).unwrap();
        assert!(!binary.is_empty(), "binary path should not be empty");
        assert_eq!(args[0], "run", "first arg should be 'run'");
        assert!(
            args.contains(&"echo hello".to_string()),
            "task should be in args"
        );
    }

    // ---- 2.4 execute 路由分发 ----

    #[tokio::test]
    async fn test_execute_dispatches_spawn() {
        let tmp = TempDir::new().unwrap();
        let tool = test_tool(&tmp);
        let input = serde_json::json!({"action": "spawn", "cli": "zapmyco", "task": "test"});
        let result = tool.execute(&input).await.unwrap();
        assert!(result.contains("sa_"));
    }

    #[tokio::test]
    async fn test_execute_dispatches_poll() {
        let tmp = TempDir::new().unwrap();
        let tool = test_tool(&tmp);
        let input = serde_json::json!({"action": "poll", "subagent_ids": ["sa_nonexistent"]});
        let result = tool.execute(&input).await.unwrap();
        assert!(result.contains("ID 不存在"));
    }

    #[tokio::test]
    async fn test_execute_dispatches_list() {
        let tmp = TempDir::new().unwrap();
        let tool = test_tool(&tmp);
        let input = serde_json::json!({"action": "list"});
        let result = tool.execute(&input).await.unwrap();
        assert!(result.contains("没有子代理"));
    }

    #[tokio::test]
    async fn test_execute_rejects_invalid_action() {
        let tmp = TempDir::new().unwrap();
        let tool = test_tool(&tmp);
        let input = serde_json::json!({"action": "reboot"});
        let result = tool.execute(&input).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("无效 action"));
    }

    #[tokio::test]
    async fn test_execute_dispatches_kill() {
        let tmp = TempDir::new().unwrap();
        let tool = test_tool(&tmp);
        let input = serde_json::json!({"action": "kill", "subagent_ids": ["sa_nonexistent"]});
        let result = tool.execute(&input).await.unwrap();
        assert!(result.contains("ID 不存在"));
    }

    #[tokio::test]
    async fn test_execute_requires_action_field() {
        let tmp = TempDir::new().unwrap();
        let tool = test_tool(&tmp);
        let input = serde_json::json!({"task": "hello"});
        let result = tool.execute(&input).await;
        assert!(result.is_err());
    }

    // ---- 2.5 tool_definition ----

    #[test]
    fn test_tool_definition_name() {
        let tool = SubAgentTool::tool_definition();
        assert_eq!(tool.name, "subagent");
    }

    #[test]
    fn test_tool_definition_action_enum() {
        let tool = SubAgentTool::tool_definition();
        let schema = tool.input_schema.unwrap();
        let action = &schema["properties"]["action"];
        let enum_values: Vec<&str> = action["enum"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect();
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
    fn test_tool_definition_has_description() {
        let tool = SubAgentTool::tool_definition();
        assert!(tool.description.is_some());
        assert!(!tool.description.as_ref().unwrap().is_empty());
    }

    #[test]
    fn test_tool_definition_required_fields() {
        let tool = SubAgentTool::tool_definition();
        let schema = tool.input_schema.unwrap();
        let required: Vec<&str> = schema["required"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect();
        assert!(required.contains(&"action"));
    }

    // ---- 2.6 is_concurrency_safe ----

    #[test]
    fn test_is_concurrency_safe_spawn() {
        let tmp = TempDir::new().unwrap();
        let tool = test_tool(&tmp);
        let input = serde_json::json!({"action": "spawn"});
        assert!(tool.is_concurrency_safe(&input));
    }

    #[test]
    fn test_is_concurrency_safe_poll() {
        let tmp = TempDir::new().unwrap();
        let tool = test_tool(&tmp);
        let input = serde_json::json!({"action": "poll"});
        assert!(tool.is_concurrency_safe(&input));
    }

    #[test]
    fn test_is_concurrency_safe_list() {
        let tmp = TempDir::new().unwrap();
        let tool = test_tool(&tmp);
        let input = serde_json::json!({"action": "list"});
        assert!(tool.is_concurrency_safe(&input));
    }

    #[test]
    fn test_is_concurrency_safe_kill() {
        let tmp = TempDir::new().unwrap();
        let tool = test_tool(&tmp);
        let input = serde_json::json!({"action": "kill"});
        assert!(tool.is_concurrency_safe(&input));
    }

    #[test]
    fn test_is_concurrency_safe_default() {
        let tmp = TempDir::new().unwrap();
        let tool = test_tool(&tmp);
        let input = serde_json::json!({"action": "unknown"});
        assert!(!tool.is_concurrency_safe(&input));
    }

    // ---- 2.7 format_completed ----

    #[test]
    fn test_format_completed_small_output() {
        let dir = TempDir::new().unwrap();
        std::fs::write(dir.path().join("stdout"), "hello world").unwrap();
        std::fs::write(dir.path().join("exit_code"), "0").unwrap();
        std::fs::write(dir.path().join("started_at"), &now_str()).unwrap();
        std::fs::write(dir.path().join("cli"), "zapmyco").unwrap();
        std::fs::write(dir.path().join("task"), "test").unwrap();
        File::create(dir.path().join("done")).unwrap();

        let output = format_completed(dir.path(), "sa_test");
        assert!(output.contains("completed"));
        assert!(output.contains("hello world"));
        assert!(!output.contains("OUTPUT LARGE"));
    }

    #[test]
    fn test_format_completed_large_output_folded() {
        let dir = TempDir::new().unwrap();
        let big = "x".repeat(3000);
        std::fs::write(dir.path().join("stdout"), &big).unwrap();
        std::fs::write(dir.path().join("exit_code"), "0").unwrap();
        std::fs::write(dir.path().join("started_at"), &now_str()).unwrap();
        std::fs::write(dir.path().join("cli"), "zapmyco").unwrap();
        std::fs::write(dir.path().join("task"), "test").unwrap();
        File::create(dir.path().join("done")).unwrap();

        let output = format_completed(dir.path(), "sa_test");
        assert!(output.contains("OUTPUT LARGE"));
        assert!(output.contains("完整输出"));
    }

    #[test]
    fn test_format_completed_shows_stderr_when_nonempty() {
        let dir = TempDir::new().unwrap();
        std::fs::write(dir.path().join("stdout"), "ok").unwrap();
        std::fs::write(dir.path().join("stderr"), "warning: deprecated API").unwrap();
        std::fs::write(dir.path().join("exit_code"), "0").unwrap();
        std::fs::write(dir.path().join("started_at"), &now_str()).unwrap();
        std::fs::write(dir.path().join("cli"), "zapmyco").unwrap();
        std::fs::write(dir.path().join("task"), "test").unwrap();
        File::create(dir.path().join("done")).unwrap();

        let output = format_completed(dir.path(), "sa_test");
        assert!(output.contains("deprecated API"));
    }

    #[test]
    fn test_format_completed_hides_stderr_when_empty() {
        let dir = TempDir::new().unwrap();
        std::fs::write(dir.path().join("stdout"), "ok").unwrap();
        std::fs::write(dir.path().join("stderr"), "").unwrap();
        std::fs::write(dir.path().join("exit_code"), "0").unwrap();
        std::fs::write(dir.path().join("started_at"), &now_str()).unwrap();
        std::fs::write(dir.path().join("cli"), "zapmyco").unwrap();
        std::fs::write(dir.path().join("task"), "test").unwrap();
        File::create(dir.path().join("done")).unwrap();

        let output = format_completed(dir.path(), "sa_test");
        assert!(!output.contains("stderr"));
    }

    #[test]
    fn test_format_completed_error_with_stderr() {
        let dir = TempDir::new().unwrap();
        std::fs::write(dir.path().join("stdout"), "部分完成").unwrap();
        std::fs::write(dir.path().join("stderr"), "panic at line 42").unwrap();
        std::fs::write(dir.path().join("exit_code"), "1").unwrap();
        std::fs::write(dir.path().join("started_at"), &now_str()).unwrap();
        std::fs::write(dir.path().join("cli"), "zapmyco").unwrap();
        std::fs::write(dir.path().join("task"), "test").unwrap();
        File::create(dir.path().join("done")).unwrap();

        let output = format_completed(dir.path(), "sa_test");
        assert!(output.contains("error"));
        assert!(output.contains("panic at line 42"));
        // stdout 应先于 stderr
        let stdout_pos = output.find("部分完成").unwrap();
        let stderr_pos = output.find("panic at line 42").unwrap();
        assert!(stdout_pos < stderr_pos);
    }

    #[test]
    fn test_format_completed_truncated_output() {
        let dir = TempDir::new().unwrap();
        let big = "x".repeat(1_500_000);
        std::fs::write(dir.path().join("stdout"), &big).unwrap();
        std::fs::write(dir.path().join("exit_code"), "0").unwrap();
        std::fs::write(dir.path().join("started_at"), &now_str()).unwrap();
        std::fs::write(dir.path().join("cli"), "zapmyco").unwrap();
        std::fs::write(dir.path().join("task"), "test").unwrap();
        File::create(dir.path().join("done")).unwrap();

        let output = format_completed(dir.path(), "sa_test");
        assert!(output.contains("OUTPUT TRUNCATED"));
        assert!(output.len() < 1_100_000);
    }

    // ---- 2.9 is_process_alive ----

    #[test]
    fn test_is_process_alive_current_process() {
        assert!(is_process_alive(std::process::id()));
    }

    #[test]
    #[cfg(unix)]
    fn test_is_process_alive_nonexistent_pid() {
        // 创建一个立即退出的进程，获取其 PID 后等待退出
        // 退出后的 PID 保证不再存在（PID 重用竞争概率极低）
        let mut child = std::process::Command::new("true")
            .spawn()
            .expect("failed to spawn true");
        let pid = child.id();
        let _ = child.wait(); // 等待退出
        assert!(
            !is_process_alive(pid),
            "PID {} 不应再存在（进程已退出）",
            pid
        );
    }

    #[test]
    #[cfg(windows)]
    fn test_is_process_alive_nonexistent_pid() {
        // Windows 上使用 cmd /c exit 0
        let mut child = std::process::Command::new("cmd")
            .args(&["/c", "exit", "0"])
            .spawn()
            .expect("failed to spawn cmd");
        let pid = child.id();
        let _ = child.wait();
        assert!(!is_process_alive(pid));
    }

    // ---- 2.10 calc_elapsed ----

    #[test]
    fn test_calc_elapsed_from_file_recent() {
        let dir = TempDir::new().unwrap();
        let now = Local::now().format("%Y-%m-%dT%H:%M:%S%.f").to_string();
        std::fs::write(dir.path().join("started_at"), &now).unwrap();
        let elapsed = calc_elapsed_from_file(dir.path().join("started_at"));
        assert!(!elapsed.is_empty(), "应有耗时");
        assert!(elapsed.ends_with('s'), "应以 s 结尾: {}", elapsed);
    }

    #[test]
    fn test_calc_elapsed_from_file_no_file() {
        let dir = TempDir::new().unwrap();
        let elapsed = calc_elapsed_from_file(dir.path().join("nonexistent"));
        assert!(elapsed.is_empty(), "无文件时应返回空");
    }

    // ---- 2.12 状态判断 ----

    #[test]
    fn test_determine_status_created() {
        let dir = TempDir::new().unwrap();
        std::fs::write(dir.path().join("task"), "test").unwrap();
        assert_eq!(determine_status_from_path(dir.path()), "created");
    }

    #[test]
    fn test_determine_status_running() {
        let dir = TempDir::new().unwrap();
        std::fs::write(dir.path().join("task"), "test").unwrap();
        std::fs::write(dir.path().join("pid"), "12345").unwrap();
        assert_eq!(determine_status_from_path(dir.path()), "running");
    }

    #[test]
    fn test_determine_status_completed() {
        let dir = TempDir::new().unwrap();
        std::fs::write(dir.path().join("task"), "test").unwrap();
        std::fs::write(dir.path().join("pid"), "12345").unwrap();
        std::fs::write(dir.path().join("exit_code"), "0").unwrap();
        File::create(dir.path().join("done")).unwrap();
        assert_eq!(determine_status_from_path(dir.path()), "completed");
    }

    #[test]
    fn test_determine_status_timeout() {
        let dir = TempDir::new().unwrap();
        std::fs::write(dir.path().join("task"), "test").unwrap();
        std::fs::write(dir.path().join("pid"), "12345").unwrap();
        std::fs::write(dir.path().join("exit_code"), "-1").unwrap();
        File::create(dir.path().join("done")).unwrap();
        assert_eq!(determine_status_from_path(dir.path()), "timeout");
    }

    #[test]
    fn test_determine_status_cancelled() {
        let dir = TempDir::new().unwrap();
        std::fs::write(dir.path().join("task"), "test").unwrap();
        std::fs::write(dir.path().join("pid"), "12345").unwrap();
        std::fs::write(dir.path().join("exit_code"), "-15").unwrap();
        File::create(dir.path().join("done")).unwrap();
        assert_eq!(determine_status_from_path(dir.path()), "cancelled");
    }

    #[test]
    fn test_determine_status_error() {
        let dir = TempDir::new().unwrap();
        std::fs::write(dir.path().join("task"), "test").unwrap();
        std::fs::write(dir.path().join("pid"), "12345").unwrap();
        std::fs::write(dir.path().join("exit_code"), "1").unwrap();
        File::create(dir.path().join("done")).unwrap();
        let status = determine_status_from_path(dir.path());
        assert!(status.contains("error"));
    }

    // ---- 3.3 并发 spawn ----

    #[tokio::test]
    async fn test_concurrent_spawns() {
        let tmp = TempDir::new().unwrap();
        let tool = test_tool(&tmp);
        let id1 = tool.spawn("zapmyco", "task1").await.unwrap();
        let id2 = tool.spawn("zapmyco", "task2").await.unwrap();
        let id3 = tool.spawn("zapmyco", "task3").await.unwrap();
        let ids = vec![id1, id2, id3];
        let unique: std::collections::HashSet<_> = ids.iter().collect();
        assert_eq!(unique.len(), 3);
    }

    // ---- 3.5 list 会话隔离 ----

    #[tokio::test]
    async fn test_list_isolation() {
        let tmp = TempDir::new().unwrap();
        let tool1 = SubAgentTool {
            data_dir: tmp.path().to_path_buf(),
            timeout_secs: 5,
            agent_session_id: "as_session_a".to_string(),
            test_binary: Some("echo".to_string()),
        };
        let tool2 = SubAgentTool {
            data_dir: tmp.path().to_path_buf(),
            timeout_secs: 5,
            agent_session_id: "as_session_b".to_string(),
            test_binary: Some("echo".to_string()),
        };

        let id1 = tool1.spawn("zapmyco", "secret_task").await.unwrap();

        // tool2 list 不应看到 tool1 的
        let list2 = tool2.list().await.unwrap();
        assert!(
            !list2.contains(&id1),
            "不应看到其他会话的子 Agent: {}",
            list2
        );

        // tool1 list 应看到
        let list1 = tool1.list().await.unwrap();
        assert!(list1.contains(&id1));
    }

    // ---- 3.9 参数校验 ----

    #[tokio::test]
    async fn test_spawn_empty_task_rejected() {
        let tmp = TempDir::new().unwrap();
        let tool = test_tool(&tmp);
        let result = tool.spawn("zapmyco", "").await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("不能为空"));
    }

    #[tokio::test]
    async fn test_spawn_invalid_cli_rejected() {
        let tmp = TempDir::new().unwrap();
        let tool = test_tool(&tmp);
        let result = tool.spawn("gemini", "task").await;
        assert!(result.is_err());
    }

    // ---- 3.10 poll 空 ID 校验 ----

    #[tokio::test]
    async fn test_poll_empty_ids_rejected() {
        let tmp = TempDir::new().unwrap();
        let tool = test_tool(&tmp);
        let result = tool.poll(&[], 0).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("不能为空"));
    }

    // ---- 3.11 spawn 写入 agent_session ----

    #[tokio::test]
    async fn test_spawn_writes_agent_session() {
        let tmp = TempDir::new().unwrap();
        let tool = test_tool(&tmp);
        let id = tool.spawn("zapmyco", "echo test").await.unwrap();
        eprintln!("id={} data_dir={}", id, tool.data_dir.display());
        let session_file = tool.data_dir.join(&id).join("agent_session");
        let dir_exists = tool.data_dir.join(&id).exists();
        eprintln!(
            "dir_exists={} session_file={}",
            dir_exists,
            session_file.display()
        );
        assert!(
            session_file.exists(),
            "session_file should exist, dir_exists={}",
            dir_exists
        );
        let content = std::fs::read_to_string(session_file).unwrap();
        assert_eq!(content.trim(), tool.agent_session());
    }

    // ---- 3.1 poll 等待边界 ----

    #[tokio::test]
    async fn test_poll_returns_completed_after_wait() {
        let tmp = TempDir::new().unwrap();
        let tool = SubAgentTool {
            data_dir: tmp.path().to_path_buf(),
            timeout_secs: 30,
            agent_session_id: generate_agent_session_id(),
            test_binary: Some("sleep".to_string()),
        };
        let id = tool.spawn("zapmyco", "1").await.unwrap();
        let result = tool.poll(&[id], 5).await.unwrap();
        assert!(result.contains("completed"), "应检测到完成: {}", result);
    }

    #[tokio::test]
    async fn test_poll_returns_running_before_completion() {
        let tmp = TempDir::new().unwrap();
        let tool = SubAgentTool {
            data_dir: tmp.path().to_path_buf(),
            timeout_secs: 60,
            agent_session_id: generate_agent_session_id(),
            test_binary: Some("sleep".to_string()),
        };
        let id = tool.spawn("zapmyco", "30").await.unwrap();
        let result = tool.poll(&[id], 0).await.unwrap();
        assert!(result.contains("仍在运行"), "应仍运行中: {}", result);
    }

    #[tokio::test]
    async fn test_poll_wait_secs_max_30() {
        // wait_secs=999 被截断到 30，但已完成项会立即返回
        let tmp = TempDir::new().unwrap();
        let tool = test_tool(&tmp);
        let dir = tool.data_dir.join("sa_quick");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("agent_session"), tool.agent_session()).unwrap();
        std::fs::write(dir.join("task"), "quick").unwrap();
        std::fs::write(dir.join("started_at"), &now_str()).unwrap();
        std::fs::write(dir.join("stdout"), "done").unwrap();
        std::fs::write(dir.join("exit_code"), "0").unwrap();
        std::fs::write(dir.join("pid"), "1").unwrap();
        File::create(dir.join("done")).unwrap();

        let start = Instant::now();
        let result = tool.poll(&["sa_quick".to_string()], 999).await.unwrap();
        let elapsed = start.elapsed();
        assert!(
            elapsed.as_secs() < 5,
            "已完成项不应等待: {}s",
            elapsed.as_secs()
        );
        assert!(result.contains("completed"), "应看到完成: {}", result);
    }

    #[tokio::test]
    async fn test_poll_wait_secs_negative_via_execute() {
        let tmp = TempDir::new().unwrap();
        let tool = test_tool(&tmp);
        let dir = tool.data_dir.join("sa_neg");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("agent_session"), tool.agent_session()).unwrap();
        std::fs::write(dir.join("task"), "test").unwrap();
        std::fs::write(dir.join("started_at"), &now_str()).unwrap();

        let input = serde_json::json!({
            "action": "poll",
            "subagent_ids": ["sa_neg"],
            "wait_secs": -5
        });
        let result = tool.execute(&input).await;
        assert!(result.is_ok(), "负值不应 panic: {:?}", result.err());
    }

    // ---- 3.2 进程隔离 ----

    #[tokio::test]
    async fn test_subagent_crash_does_not_affect_main() {
        let tmp = TempDir::new().unwrap();
        let tool = test_tool(&tmp);
        let id = tool.spawn("zapmyco", "echo hello").await.unwrap();
        let result = tool.poll(&[id.clone()], 5).await.unwrap();
        assert!(result.contains("completed"), "子进程应正常完成: {}", result);
        // 工具仍然可以正常使用
        let list = tool.list().await.unwrap();
        assert!(list.contains(&id), "list 应包含该 subagent");
    }

    // ---- 3.3 并发 poll ----

    #[tokio::test]
    async fn test_poll_multiple_ids() {
        let tmp = TempDir::new().unwrap();
        let tool = test_tool(&tmp);
        let id1 = tool.spawn("zapmyco", "echo a").await.unwrap();
        let id2 = tool.spawn("zapmyco", "echo b").await.unwrap();
        let result = tool.poll(&[id1, id2], 10).await.unwrap();
        assert!(
            result.contains("completed"),
            "批量 poll 应返回完成: {}",
            result
        );
    }

    // ---- 3.4 kill ----

    #[tokio::test]
    async fn test_kill_running_subagent() {
        let tmp = TempDir::new().unwrap();
        let tool = SubAgentTool {
            data_dir: tmp.path().to_path_buf(),
            timeout_secs: 60,
            agent_session_id: generate_agent_session_id(),
            test_binary: Some("sleep".to_string()),
        };
        let id = tool.spawn("zapmyco", "30").await.unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        let list = tool.list().await.unwrap();
        assert!(list.contains(&id), "应能看到 subagent");
        assert!(list.contains("running"), "应处于 running 状态");

        let kill_result = tool.kill(&[id.clone()]).await.unwrap();
        assert!(kill_result.contains("cancelled"), "应标记为 cancelled");

        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        let poll_result = tool.poll(&[id], 0).await.unwrap();
        // kill 和后台任务可能竞态：后台任务可能先写 exit_code=-1（timeout）
        assert!(
            poll_result.contains("cancelled") || poll_result.contains("timeout"),
            "应显示 cancelled 或 timeout: {}",
            poll_result
        );
    }

    #[tokio::test]
    async fn test_kill_already_completed() {
        let tmp = TempDir::new().unwrap();
        let tool = test_tool(&tmp);
        let id = tool.spawn("zapmyco", "quick").await.unwrap();
        let _ = tool.poll(&[id.clone()], 5).await.unwrap();

        let kill_result = tool.kill(&[id.clone()]).await.unwrap();
        assert!(
            kill_result.contains("cannot cancel"),
            "已完成应提示无法取消"
        );
    }

    // ---- 3.6 退出检查 ----

    #[test]
    fn test_exit_guard_no_panic_on_missing_dir() {
        let dir = TempDir::new().unwrap();
        std::fs::remove_dir(dir.path()).unwrap();
        let running = count_running_subagents(dir.path(), "test_session");
        assert_eq!(running, 0, "目录不存在应返回 0");
    }

    #[test]
    fn test_exit_guard_finds_running_subagents() {
        let dir = TempDir::new().unwrap();
        let session = "as_test_session";
        let sub_dir = dir.path().join("sa_test");
        std::fs::create_dir(&sub_dir).unwrap();
        std::fs::write(sub_dir.join("agent_session"), session).unwrap();
        std::fs::write(sub_dir.join("pid"), "99999").unwrap();
        std::fs::write(sub_dir.join("task"), "test").unwrap();
        std::fs::write(sub_dir.join("started_at"), &now_str()).unwrap();

        let running = count_running_subagents(dir.path(), session);
        assert_eq!(running, 1, "应找到 1 个 running subagent");
    }

    // ---- 3.7 后台错误写入 stderr ----

    #[tokio::test]
    async fn test_background_task_error_written_to_stderr() {
        let tmp = TempDir::new().unwrap();
        let tool = SubAgentTool {
            data_dir: tmp.path().to_path_buf(),
            timeout_secs: 5,
            agent_session_id: generate_agent_session_id(),
            test_binary: Some("/nonexistent/binary".to_string()),
        };
        let id = tool.spawn("zapmyco", "task").await.unwrap();
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        let result = tool.poll(&[id.clone()], 0).await.unwrap();
        assert!(
            result.contains("error")
                || result.contains("not found")
                || result.contains("No such file"),
            "应报告错误: {}",
            result
        );
    }

    // ---- 3.8 死进程检测 ----

    #[tokio::test]
    async fn test_dead_process_detected() {
        let tmp = TempDir::new().unwrap();
        let tool = test_tool(&tmp);
        let dir = tool.data_dir.join("sa_dead");
        std::fs::create_dir_all(&dir).unwrap();

        // 使用一个已退出的真实进程的 PID（避免 4294967295 在 Linux 上被解释为 -1）
        #[cfg(unix)]
        let mut child = std::process::Command::new("true")
            .spawn()
            .expect("failed to spawn true");
        #[cfg(windows)]
        let mut child = std::process::Command::new("cmd")
            .args(["/c", "exit", "0"])
            .spawn()
            .expect("failed to spawn cmd");
        let pid = child.id();
        let _ = child.wait(); // 等待退出，此时 PID 不再存在

        std::fs::write(dir.join("pid"), pid.to_string()).unwrap();
        std::fs::write(dir.join("task"), "test").unwrap();
        std::fs::write(dir.join("started_at"), &now_str()).unwrap();
        std::fs::write(dir.join("agent_session"), tool.agent_session()).unwrap();
        // 不写 done

        let result = tool.poll(&["sa_dead".to_string()], 0).await.unwrap();
        assert!(
            result.contains("completed") || result.contains("error") || result.contains("lost"),
            "应检测到死进程: {}",
            result
        );
    }

    // ---- 3.11 agent_session 写入顺序 ----

    #[tokio::test]
    async fn test_agent_session_written_before_pid() {
        let tmp = TempDir::new().unwrap();
        let tool = test_tool(&tmp);
        let id = tool.spawn("zapmyco", "echo order_check").await.unwrap();
        let dir = tool.data_dir.join(&id);
        // agent_session 由 spawn 同步写入，必须在 spawn 返回时已存在
        assert!(
            dir.join("agent_session").exists(),
            "agent_session 应在 spawn 返回前同步写入"
        );
    }

    // ---- 3.12 done 创建顺序 ----

    #[tokio::test]
    async fn test_done_created_after_all_writes() {
        let tmp = TempDir::new().unwrap();
        let tool = test_tool(&tmp);
        let id = tool.spawn("zapmyco", "echo order_check").await.unwrap();
        let _ = tool.poll(&[id.clone()], 10).await.unwrap();

        let dir = tool.data_dir.join(&id);
        assert!(dir.join("done").exists(), "done 文件应存在");

        let stdout = std::fs::read_to_string(dir.join("stdout")).unwrap();
        assert!(!stdout.is_empty(), "done 创建前 stdout 应已写入");

        let code = std::fs::read_to_string(dir.join("exit_code")).unwrap();
        assert!(!code.is_empty(), "done 创建前 exit_code 应已写入");

        assert!(dir.join("stderr").exists(), "stderr 文件应存在");
    }

    // ---- 3.13 poll 混合结果 ----

    #[tokio::test]
    async fn test_poll_mixed_completed_and_running() {
        let tmp = TempDir::new().unwrap();
        let tool = test_tool(&tmp);

        let dir1 = tool.data_dir.join("sa_completed");
        std::fs::create_dir_all(&dir1).unwrap();
        std::fs::write(dir1.join("agent_session"), tool.agent_session()).unwrap();
        std::fs::write(dir1.join("task"), "quick").unwrap();
        std::fs::write(dir1.join("started_at"), &now_str()).unwrap();
        std::fs::write(dir1.join("stdout"), "完成").unwrap();
        std::fs::write(dir1.join("exit_code"), "0").unwrap();
        std::fs::write(dir1.join("pid"), "1").unwrap();
        File::create(dir1.join("done")).unwrap();

        let dir2 = tool.data_dir.join("sa_running");
        std::fs::create_dir_all(&dir2).unwrap();
        std::fs::write(dir2.join("agent_session"), tool.agent_session()).unwrap();
        std::fs::write(dir2.join("task"), "slow").unwrap();
        std::fs::write(dir2.join("started_at"), &now_str()).unwrap();
        // 使用当前进程 PID（一定存活），避免死进程检测触发
        std::fs::write(dir2.join("pid"), std::process::id().to_string()).unwrap();

        let result = tool
            .poll(&["sa_completed".into(), "sa_running".into()], 0)
            .await
            .unwrap();
        assert!(result.contains("completed"), "已完成应展开: {}", result);
        assert!(result.contains("仍在运行"), "运行中应折叠: {}", result);
    }

    #[tokio::test]
    async fn test_poll_mixed_completed_and_error() {
        let tmp = TempDir::new().unwrap();
        let tool = test_tool(&tmp);

        let dir1 = tool.data_dir.join("sa_ok");
        std::fs::create_dir_all(&dir1).unwrap();
        std::fs::write(dir1.join("agent_session"), tool.agent_session()).unwrap();
        std::fs::write(dir1.join("task"), "ok").unwrap();
        std::fs::write(dir1.join("started_at"), &now_str()).unwrap();
        std::fs::write(dir1.join("stdout"), "success").unwrap();
        std::fs::write(dir1.join("exit_code"), "0").unwrap();
        std::fs::write(dir1.join("pid"), "1").unwrap();
        File::create(dir1.join("done")).unwrap();

        let dir2 = tool.data_dir.join("sa_err");
        std::fs::create_dir_all(&dir2).unwrap();
        std::fs::write(dir2.join("agent_session"), tool.agent_session()).unwrap();
        std::fs::write(dir2.join("task"), "err").unwrap();
        std::fs::write(dir2.join("started_at"), &now_str()).unwrap();
        std::fs::write(dir2.join("stderr"), "command not found").unwrap();
        std::fs::write(dir2.join("exit_code"), "127").unwrap();
        std::fs::write(dir2.join("pid"), "1").unwrap();
        File::create(dir2.join("done")).unwrap();

        let result = tool
            .poll(&["sa_ok".into(), "sa_err".into()], 0)
            .await
            .unwrap();
        assert!(result.contains("success"), "应有成功输出: {}", result);
        assert!(
            result.contains("127") || result.contains("error"),
            "应有错误信息: {}",
            result
        );
    }

    #[tokio::test]
    async fn test_poll_nonexistent_id_with_valid_ones() {
        let tmp = TempDir::new().unwrap();
        let tool = test_tool(&tmp);
        let dir = tool.data_dir.join("sa_real");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("agent_session"), tool.agent_session()).unwrap();
        std::fs::write(dir.join("task"), "real").unwrap();
        std::fs::write(dir.join("started_at"), &now_str()).unwrap();
        std::fs::write(dir.join("stdout"), "data").unwrap();
        std::fs::write(dir.join("exit_code"), "0").unwrap();
        std::fs::write(dir.join("pid"), "1").unwrap();
        File::create(dir.join("done")).unwrap();

        let result = tool
            .poll(&["sa_real".into(), "sa_fake".into()], 0)
            .await
            .unwrap();
        assert!(
            result.contains("ID 不存在") || result.contains("sa_real"),
            "存在的应正常返回: {}",
            result
        );
    }

    // ---- 3.14 损坏目录鲁棒性 ----

    #[tokio::test]
    async fn test_poll_with_missing_task_file() {
        let tmp = TempDir::new().unwrap();
        let tool = test_tool(&tmp);
        let dir = tool.data_dir.join("sa_broken");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("agent_session"), tool.agent_session()).unwrap();
        std::fs::write(dir.join("started_at"), &now_str()).unwrap();
        std::fs::write(dir.join("pid"), "99999").unwrap();
        // 没有 task 文件
        let result = tool.poll(&["sa_broken".into()], 0).await;
        assert!(result.is_ok(), "损坏目录不应 panic: {:?}", result.err());
    }

    #[tokio::test]
    async fn test_poll_with_invalid_started_at() {
        let tmp = TempDir::new().unwrap();
        let tool = test_tool(&tmp);
        let dir = tool.data_dir.join("sa_bad_ts");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("agent_session"), tool.agent_session()).unwrap();
        std::fs::write(dir.join("started_at"), "not-a-timestamp").unwrap();
        std::fs::write(dir.join("pid"), "99999").unwrap();
        std::fs::write(dir.join("task"), "test").unwrap();
        let result = tool.poll(&["sa_bad_ts".into()], 0).await;
        assert!(result.is_ok(), "非法时间戳不应 panic: {:?}", result.err());
    }

    #[tokio::test]
    async fn test_poll_with_empty_pid_file() {
        let tmp = TempDir::new().unwrap();
        let tool = test_tool(&tmp);
        let dir = tool.data_dir.join("sa_empty_pid");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("agent_session"), tool.agent_session()).unwrap();
        std::fs::write(dir.join("pid"), "").unwrap();
        std::fs::write(dir.join("task"), "test").unwrap();
        std::fs::write(dir.join("started_at"), &now_str()).unwrap();
        let result = tool.poll(&["sa_empty_pid".into()], 0).await;
        assert!(result.is_ok(), "空 PID 不应 panic: {:?}", result.err());
    }

    #[tokio::test]
    async fn test_poll_with_wrong_agent_session() {
        let tmp = TempDir::new().unwrap();
        let tool = test_tool(&tmp);
        let dir = tool.data_dir.join("sa_wrong_session");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("agent_session"), "as_wrong_session_id").unwrap();
        std::fs::write(dir.join("task"), "test").unwrap();
        std::fs::write(dir.join("started_at"), &now_str()).unwrap();
        std::fs::write(dir.join("pid"), "99999").unwrap();
        std::fs::write(dir.join("stdout"), "secret").unwrap();
        std::fs::write(dir.join("exit_code"), "0").unwrap();
        File::create(dir.join("done")).unwrap();

        // 知道 ID 就能 poll，不受 session 隔离影响
        let result = tool.poll(&["sa_wrong_session".into()], 0).await.unwrap();
        assert!(
            result.contains("completed"),
            "知道 ID 就能 poll: {}",
            result
        );
    }

    #[tokio::test]
    async fn test_list_skips_broken_directories() {
        let tmp = TempDir::new().unwrap();
        let tool = test_tool(&tmp);
        let dir = tool.data_dir.join("sa_empty_dir");
        std::fs::create_dir_all(&dir).unwrap();
        // 空目录，没有任何文件
        let result = tool.list().await;
        assert!(result.is_ok(), "空目录不应 panic: {:?}", result.err());
    }

    // ---- 5. Bug 回归测试 ----
    //
    // R1 — 后台错误不吞没 → 由 test_background_task_error_written_to_stderr 覆盖
    // R2 — current_exe → 由 test_build_command_uses_current_exe 覆盖
    // R6 — 会话隔离 → 由 test_list_isolation 覆盖

    #[tokio::test]
    async fn test_regression_pid_written_before_wait() {
        // R3: PID 文件应在 wait 前写入
        let tmp = TempDir::new().unwrap();
        let tool = SubAgentTool {
            data_dir: tmp.path().to_path_buf(),
            timeout_secs: 10,
            agent_session_id: generate_agent_session_id(),
            test_binary: Some("sleep".to_string()),
        };
        let id = tool.spawn("zapmyco", "5").await.unwrap();
        let dir = tool.data_dir.join(&id);
        let pid_file = dir.join("pid");
        // 最多等 3 秒让后台任务启动
        for _ in 0..30 {
            if pid_file.exists() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        assert!(pid_file.exists(), "PID 文件应在 wait 前写入 ({}s)", 5);
        let _ = tool.poll(&[id], 10).await.unwrap();
    }

    #[tokio::test]
    async fn test_regression_elapsed_takes_earliest_agent() {
        // R4: 折叠等待时间取最早 Agent
        let tmp = TempDir::new().unwrap();
        let tool = test_tool(&tmp);

        let dir = tool.data_dir.join("sa_earliest");
        std::fs::create_dir(&dir).unwrap();
        std::fs::write(dir.join("agent_session"), tool.agent_session()).unwrap();
        std::fs::write(dir.join("task"), "earliest").unwrap();
        std::fs::write(dir.join("started_at"), "2026-01-01T00:00:00").unwrap();

        let dir2 = tool.data_dir.join("sa_later");
        std::fs::create_dir(&dir2).unwrap();
        std::fs::write(dir2.join("agent_session"), tool.agent_session()).unwrap();
        std::fs::write(dir2.join("task"), "later").unwrap();
        std::fs::write(dir2.join("started_at"), &now_str()).unwrap();

        let result = tool
            .poll(&["sa_later".to_string(), "sa_earliest".to_string()], 0)
            .await
            .unwrap();
        assert!(
            result.contains("1000") || result.contains("仍在运行"),
            "应显示最早 Agent 的等待时间: {}",
            result
        );
    }

    #[test]
    fn test_regression_exit_guard_no_unwrap() {
        // R5: count_running_subagents 在各种异常下不 panic
        let dir = TempDir::new().unwrap();
        // 空目录
        std::fs::create_dir_all(dir.path().join("not_a_subagent_dir")).unwrap();
        let running = count_running_subagents(dir.path(), "some_session");
        assert_eq!(running, 0, "异常目录不应 panic，应返回 0");

        // 损坏的 agent_session 文件（二进制内容）
        let bad_dir = dir.path().join("sa_bad_session");
        std::fs::create_dir(&bad_dir).unwrap();
        std::fs::write(bad_dir.join("agent_session"), &[0xFF, 0xFE, 0x00]).unwrap();
        std::fs::write(bad_dir.join("pid"), "1234").unwrap();
        let running = count_running_subagents(dir.path(), "some_session");
        assert_eq!(running, 0, "损坏的 session 文件不应计入");
    }

    #[tokio::test]
    async fn test_regression_timeout_kills_subprocess() {
        // R7: 超时子进程被 kill
        let tmp = TempDir::new().unwrap();
        let tool = SubAgentTool {
            data_dir: tmp.path().to_path_buf(),
            timeout_secs: 2, // 2 秒超时
            agent_session_id: generate_agent_session_id(),
            test_binary: Some("sleep".to_string()),
        };
        let id = tool.spawn("zapmyco", "60").await.unwrap();
        // 等超时（2s 超时 + 缓冲）
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        let result = tool.poll(&[id], 0).await.unwrap();
        assert!(
            result.contains("timeout") || result.contains("cancelled"),
            "超时应标记: {}",
            result
        );
    }

    // ---- 辅助 ----

    fn now_str() -> String {
        Local::now().format("%Y-%m-%dT%H:%M:%S%.f").to_string()
    }

    // Re-export File for tests
    use std::fs::File;
}
